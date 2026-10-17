"""Transporte de terminal acotado. Desconectar un cliente no mata la sesión tmux."""
import asyncio
import fcntl
import json
import os
import signal
import struct
import subprocess
import termios
import time
from aiohttp import web, WSMsgType
from . import auth, config, tmux, websecurity

CLIENTS = web.AppKey('terminal_clients', dict)
PER_SESSION = 4
TOTAL = 12


def capacity(request):
    counts = request.app[CLIENTS]
    return counts.get(request[websecurity.SESSION_KEY]['id'], 0) < PER_SESSION and sum(counts.values()) < TOTAL


def size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', max(5, min(500, rows)), max(10, min(500, cols)), 0, 0))


def payload(text):
    value = json.loads(text)
    if not isinstance(value, dict): raise ValueError('Mensaje inválido')
    kind = value.get('t')
    if kind == 'i':
        if not isinstance(value.get('d'), str) or len(value['d'].encode()) > 32768: raise ValueError('Entrada inválida')
    elif kind == 'r':
        if any(not isinstance(value.get(key), int) or isinstance(value.get(key), bool) for key in ('c', 'r')):
            raise ValueError('Tamaño inválido')
    else:
        raise ValueError('Mensaje inválido')
    return value


async def connect(request, name, blocking):
    sid = request[websecurity.SESSION_KEY]['id']
    if not capacity(request):
        raise web.HTTPTooManyRequests(reason='Demasiadas terminales abiertas. Cierra otra pestaña o dispositivo.')
    counts = request.app[CLIENTS]
    counts[sid] = counts.get(sid, 0) + 1
    master = slave = None
    process = None
    sender = watcher = None
    loop = asyncio.get_running_loop()
    ws = web.WebSocketResponse(heartbeat=25, max_msg_size=65536, compress=False)
    try:
        master, slave = os.openpty()
        try: cols, rows = int(request.query.get('cols', 80)), int(request.query.get('rows', 24))
        except ValueError: cols, rows = 80, 24
        size(master, cols, rows)
        env = {'TERM': 'xterm-256color', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
               'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': os.environ.get('HOME', '/tmp')}
        process = subprocess.Popen(['setsid', '-c', 'tmux', '-u', '-S', config.TMUX_SOCKET, 'attach-session', '-t', f'={name}'],
                                   stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True)
        os.close(slave); slave = None
        os.set_blocking(master, False)
        await ws.prepare(request)
        outgoing = asyncio.Queue(maxsize=32)
        state = {'paused': False, 'eof': False}

        def readable():
            if outgoing.full():
                loop.remove_reader(master); state['paused'] = True
                return
            try: data = os.read(master, 65536)
            except BlockingIOError: return
            except OSError: data = b''
            outgoing.put_nowait(data)
            if not data:
                state['eof'] = True; loop.remove_reader(master)

        async def pump():
            while not ws.closed:
                data = await outgoing.get()
                if not data: break
                if state['paused'] and not state['eof']:
                    state['paused'] = False; loop.add_reader(master, readable)
                try: await ws.send_bytes(data)
                except ConnectionError: break
            if not ws.closed: await ws.close()

        async def watch():
            last_mode = None
            try:
                while not ws.closed:
                    if not await blocking(auth.session_active, sid):
                        await ws.close(code=1008, message=b'Sesion cerrada'); break
                    info = await blocking(tmux.pane_state, name)
                    mode = info.get('copy_mode', False)
                    if mode != last_mode:
                        await ws.send_json({'t': 'mode', 'copy': mode})
                        last_mode = mode
                    await asyncio.sleep(5)
            except Exception:
                if not ws.closed: await ws.close(code=1011, message=b'No se pudo verificar la sesion')

        loop.add_reader(master, readable)
        sender = asyncio.create_task(pump())
        watcher = asyncio.create_task(watch())
        await ws.send_json({'t': 'ready', 'session': name})
        credits, stamp = 200.0, time.monotonic()
        async for message in ws:
            now = time.monotonic(); credits = min(200, credits + (now - stamp) * 100); stamp = now
            if credits < 1:
                await ws.close(code=1008, message=b'Limite de mensajes'); break
            credits -= 1
            if message.type in (WSMsgType.ERROR, WSMsgType.CLOSE): break
            if message.type != WSMsgType.TEXT:
                await ws.close(code=1003, message=b'Solo JSON de texto'); break
            try: value = payload(message.data)
            except (ValueError, UnicodeError):
                await ws.close(code=1007, message=b'Mensaje invalido'); break
            if value['t'] == 'r':
                size(master, value['c'], value['r'])
                if process.poll() is None: process.send_signal(signal.SIGWINCH)
            else:
                data = value['d'].encode()
                offset = 0
                while offset < len(data) and not ws.closed:
                    try: offset += os.write(master, data[offset:])
                    except BlockingIOError:
                        ready = loop.create_future()
                        def writable():
                            if not ready.done(): ready.set_result(None)
                        loop.add_writer(master, writable)
                        try: await asyncio.wait_for(ready, 5)
                        finally: loop.remove_writer(master)
                    except OSError:
                        await ws.close(); break
    except (OSError, asyncio.TimeoutError):
        if ws.prepared:
            if not ws.closed:
                await ws.send_json({'t': 'error', 'd': 'No se pudo conectar con tmux. Pulsa Reconectar.'})
                await ws.close(code=1011)
        else:
            raise web.HTTPServiceUnavailable(reason='No se pudo abrir la terminal del servidor')
    finally:
        async def cleanup():
            if master is not None:
                loop.remove_reader(master); loop.remove_writer(master)
            for task in (sender, watcher):
                if task: task.cancel()
            if process and process.poll() is None: process.terminate()
            try:
                await asyncio.gather(*(task for task in (sender, watcher) if task), return_exceptions=True)
                if process:
                    def reap():
                        try: process.wait(timeout=3)
                        except subprocess.TimeoutExpired: process.kill(); process.wait()
                    await blocking(reap)
            finally:
                if slave is not None: os.close(slave)
                if master is not None: os.close(master)
                counts[sid] -= 1
                if not counts[sid]: counts.pop(sid, None)
        cleanup_task = asyncio.create_task(cleanup())
        try:
            await asyncio.shield(cleanup_task)
        except asyncio.CancelledError:
            await cleanup_task
            raise

    return ws
