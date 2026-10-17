"""Regresiones de seguridad con repositorios, sesiones y tmux desechables."""
import asyncio
import json
import os
import subprocess
import unittest
from unittest.mock import patch
from aiohttp import WSMsgType
from cm import auth, config, dockerapi, gitops, projects, push, terminal, tmux
from test_core import IsolatedConfig
from http_support import start_client, login_client


class HardeningTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_catalog_rejects_external_symlinks_and_reserved_names(self):
        (config.PROJECTS / 'outside').symlink_to(config.CONFIG, target_is_directory=True)
        (config.PROJECTS / 'invalid name').mkdir()
        (config.PROJECTS / 'cmr-internal').mkdir()
        self.assertEqual(projects.project_names(), {'alpha', 'beta'})
        (config.PROJECTS / 'alpha' / 'README.md').symlink_to(config.CONFIG / 'private.txt')
        (config.CONFIG / 'private.txt').write_text('SECRET_README')
        self.assertEqual(projects.readme_summary(config.PROJECTS / 'alpha'), '')
        (config.PROJECTS / 'alpha' / 'README.md').unlink()
        (config.PROJECTS / 'alpha' / 'README.md').write_text('# heading\n'+'x'*1000000)
        self.assertEqual(len(projects.readme_summary(config.PROJECTS / 'alpha')), 180)

    def test_git_read_and_commit_do_not_execute_repo_programs(self):
        root = config.PROJECTS / 'alpha'
        def git(*args):
            return subprocess.run(['git','-C',str(root),*args],check=True,capture_output=True)
        git('init','-q','-b','main');git('config','user.name','Test');git('config','user.email','test@localhost')
        (root / 'readme.txt').write_text('before\n'); git('add','-A');git('commit','-qm','initial')
        script=root/'evil.sh'; marker=root/'executed'
        script.write_text('#!/bin/sh\ntouch "'+str(marker)+'"\n');script.chmod(0o700)
        git('config','core.fsmonitor',str(script));git('config','diff.external',str(script))
        git('config','diff.spy.textconv',str(script));git('config','core.hooksPath',str(root/'hooks'))
        (root/'hooks').mkdir();(root/'hooks/pre-commit').symlink_to(script)
        (root/'.gitattributes').write_text('*.txt diff=spy\n')
        (root/'readme.txt').write_text('after\n')
        self.assertTrue(gitops.status('alpha')['repo'])
        self.assertIn('+after',gitops.diff('alpha','readme.txt')['diff'])
        self.assertTrue(gitops.commit('alpha','safe commit')[0])
        self.assertFalse(marker.exists(),'El repositorio ejecutó código desde una lectura/commit web')

    def test_websocket_payload_has_type_and_size_limits(self):
        for message in ['[]','null','false','{"t":"i","d":[]}','{"t":"r","c":true,"r":2}', '{"t":"r","c":"80","r":2}',json.dumps({'t':'i','d':'x'*32769})]:
            with self.subTest(message=message[:50]), self.assertRaises(ValueError): terminal.payload(message)
        self.assertEqual(terminal.payload('{"t":"i","d":"hello"}')['d'],'hello')

    def test_docker_cannot_fill_memory_with_an_oversized_log_response(self):
        with patch.object(dockerapi.socket, 'socket') as factory, patch.object(dockerapi, 'MAX_RESPONSE', 4096):
            connection = factory.return_value
            connection.recv.side_effect = [b'x' * 1024] * 5
            with self.assertRaisesRegex(OSError, 'límite'):
                dockerapi.docker_call('GET', '/containers/example/logs')
            connection.close.assert_called_once()


class SecurityHeadersTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate(); self.client = await start_client(self)

    async def test_security_headers_also_cover_auth_origin_and_method_errors(self):
        responses=[await self.client.get('/'),await self.client.get('/api/state'),
                   await self.client.post('/api/login',json={},headers={'Origin':'https://evil.test'}),
                   await self.client.get('/api/login')]
        for response in responses:
            self.assertEqual(response.headers['X-Frame-Options'],'DENY')
            self.assertEqual(response.headers['Referrer-Policy'],'no-referrer')
            self.assertIn("script-src 'self'",response.headers['Content-Security-Policy'])
            self.assertIn("frame-ancestors 'none'",response.headers['Content-Security-Policy'])
        self.assertEqual(responses[1].headers['Cache-Control'],'no-store')

    async def test_login_size_and_content_type_cannot_bypass_limits(self):
        response=await self.client.post('/api/login',json={'password':'x'*5000})
        self.assertEqual(response.status,413)
        response=await self.client.post('/api/login',data='{"user":"tester","password":"unit-password"}',headers={'Content-Type':'text/plain'})
        self.assertEqual(response.status,415)
        response=await self.client.post('/api/login',data='null',headers={'Content-Type':'application/json'})
        self.assertEqual(response.status,400)

    async def test_server_origin_cannot_be_changed_by_untrusted_forwarded_scheme(self):
        with patch.object(config,'PUBLIC_ORIGIN','https://codex-dashboard.devdj.lat'):
            bad=await self.client.post('/api/login',json={},headers={'Origin':'http://'+self.client.server.host,'X-Forwarded-Proto':'http'})
            self.assertEqual(bad.status,403)
            good=await self.client.post('/api/login',json={'user':'tester','password':'unit-password'},headers={'Origin':'https://codex-dashboard.devdj.lat'})
            self.assertEqual(good.status,200)
            self.assertEqual(good.headers['Strict-Transport-Security'],'max-age=31536000')

    async def test_raw_svg_keeps_sandbox_and_upload_type_is_checked(self):
        await login_client(self)
        (config.PROJECTS/'alpha'/'attack.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
        response=await self.client.get('/api/files/raw?project=alpha&path=attack.svg')
        self.assertEqual(response.status,200)
        self.assertTrue(response.headers['Content-Security-Policy'].startswith('sandbox;'))
        self.assertNotIn('allow-scripts',response.headers['Content-Security-Policy'])
        self.assertEqual((await self.client.post('/api/files/upload?project=alpha',data=b'bad')).status,415)


class TerminalTransportTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate(); self.client=await start_client(self)
        self.socket=str(config.CONFIG/'isolated-tmux.sock')
        self.patchers=[patch.object(config,'TMUX_SOCKET',self.socket),patch.object(config,'HOST_PROJECTS',str(config.PROJECTS))]
        for patcher in self.patchers:patcher.start();self.addCleanup(patcher.stop)
        env={'HOME':str(config.CONFIG),'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8'}
        subprocess.run(['tmux','-S',self.socket,'new-session','-d','-s','cm-keepalive','/bin/sh'],env=env,check=True,capture_output=True)
        self.addCleanup(lambda:subprocess.run(['tmux','-S',self.socket,'kill-server'],capture_output=True))
        await login_client(self)
        self.origin=str(self.client.make_url('/')).rstrip('/')

    async def ws(self):
        return await self.client.ws_connect('/api/term?project=alpha&kind=shell',headers={'Origin':self.origin})

    async def output(self,ws,expected):
        result=b''
        for _ in range(100):
            message=await ws.receive(timeout=7)
            if message.type==WSMsgType.BINARY:
                result+=message.data
                if expected.encode() in result:return result
            elif message.type in (WSMsgType.CLOSE,WSMsgType.CLOSED,WSMsgType.ERROR):self.fail('Terminal desconectada antes de recibir salida')
        self.fail('No llegó la salida')

    async def test_real_shell_output_copy_mode_and_reconnect_preserve_session(self):
        ws=await self.ws()
        self.assertNotIn('Sec-WebSocket-Extensions',ws._response.headers)
        await ws.send_json({'t':'i','d':"printf 'CM_TERM_%s\\n' 'OK'\r"})
        await self.output(ws,'CM_TERM_OK')
        await ws.send_json({'t':'i','d':"printf 'line\\n%.0s' {1..120}; printf 'CM_HISTORY_%s\\n' 'READY'\r"})
        await self.output(ws,'CM_HISTORY_READY')
        response=await self.client.post('/api/term/scroll',json={'session':'alpha-shell','direction':'up'})
        self.assertEqual(response.status,200);self.assertTrue(tmux.pane_state('alpha-shell')['copy_mode'])
        await self.client.post('/api/term/scroll',json={'session':'alpha-shell','direction':'exit'})
        self.assertFalse(tmux.pane_state('alpha-shell')['copy_mode'])
        await ws.close()
        self.assertTrue(tmux.has_session('alpha-shell'))
        other=await self.ws()
        await other.send_json({'t':'i','d':"printf 'CM_AGAIN_%s\\n' 'OK'\r"})
        await self.output(other,'CM_AGAIN_OK');await other.close()

    async def test_origin_and_connection_limits_are_enforced(self):
        self.assertEqual((await self.client.get('/api/term?project=alpha')).status,403)
        sockets=[]
        try:
            for _ in range(4):sockets.append(await self.ws())
            response=await self.client.get('/api/term/status?project=alpha&kind=shell')
            self.assertEqual(response.status,429)
            response=await self.client.get('/api/term?project=alpha&kind=shell',headers={'Origin':self.origin})
            self.assertEqual(response.status,429)
        finally:
            for ws in sockets:await ws.close()

    async def test_malformed_messages_close_connection_without_killing_tmux(self):
        ws=await self.ws();await ws.send_str('[]')
        for _ in range(50):
            message=await ws.receive(timeout=5)
            if message.type==WSMsgType.CLOSE:
                self.assertEqual(message.data,1007);break
        else:self.fail('No cerró el mensaje inválido')
        self.assertTrue(tmux.has_session('alpha-shell'));await ws.close()

    async def test_logout_closes_live_websocket_but_keeps_shell(self):
        ws=await self.ws()
        await ws.send_json({'t':'i','d':"printf 'CM_OPEN_%s\\n' 'OK'\r"})
        await self.output(ws,'CM_OPEN_OK')
        await self.client.post('/api/logout')
        for _ in range(50):
            message=await ws.receive(timeout=7)
            if message.type==WSMsgType.CLOSE:
                self.assertEqual(message.data,1008);break
        else:self.fail('La sesión revocada mantiene el WebSocket')
        self.assertTrue(tmux.has_session('alpha-shell'));await ws.close()
