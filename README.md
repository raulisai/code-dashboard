# Codex Manager

Entorno de desarrollo del VPS, disponible en https://codex-dashboard.devdj.lat.
Permite crear proyectos, trabajar con Claude Code o Codex, editar archivos,
usar una terminal, revisar Git y logs, y desplegar desde el celular.

La revisión de controles, pruebas y riesgos conocidos está en [SEGURIDAD.md](SEGURIDAD.md).
El panel permite administración real del VPS; no es un entorno aislado para
usuarios o repositorios sin confianza. Las alertas del sistema base pendientes
de parche se documentan expresamente en ese informe.

## Uso

Inicia sesión con las credenciales de `.env` y el código de tu app autenticadora.

La primera vez se abre **Configura tu autenticador**. Escanea el QR en Google
Authenticator, Microsoft Authenticator u otra app TOTP compatible. Si estás en el
mismo celular, copia la clave y añádela manualmente como clave basada en tiempo,
o prueba **Abrir en autenticador**. Confirma con el código de seis dígitos y guarda
los diez códigos de recuperación: solo se muestran en ese momento. Hasta confirmar
el código, la sesión provisional no permite acceder a proyectos ni ejecutar acciones.

Marca **Recordar este dispositivo durante 180 días** solo en tu equipo personal.
El plazo es absoluto desde el inicio de sesión; la renovación automática de la
credencial no lo amplía. Sin marcar, la cookie dura lo que el navegador mantenga
su sesión y el servidor la limita a 12 horas. Borrar cookies o cerrar esa sesión
obliga a volver a verificar contraseña y código. Tras esta actualización debes
entrar una vez más: las cookies antiguas dejan de admitirse.

En **Ajustes → Seguridad y sesiones** puedes cerrar dispositivos a distancia,
cambiar el autenticador y renovar los códigos de recuperación. Estas dos últimas
acciones exigen la contraseña y un código actual o de recuperación y cierran las
otras sesiones. Para recuperar el acceso, en la pantalla del código pulsa
**He perdido el autenticador** y usa uno de tus códigos guardados junto con la
contraseña. Después puedes vincular un nuevo autenticador desde Ajustes.

Las sesiones se revocan en el servidor al salir; la terminal web comprueba la
revocación cada cinco segundos sin detener los procesos de tmux del proyecto.
Las cookies son `Secure`, `HttpOnly`, `SameSite=Strict` y usan el prefijo `__Host-`.
La credencial se renueva cada 24 horas con 60 segundos para peticiones concurrentes.
Basic Auth ya no se admite: los scripts deben completar el mismo login con segundo
factor. Cambiar `MONITOR_PASSWORD` y reconstruir también invalida las sesiones.

El QR se genera localmente, sin enviar la clave a servicios externos. El secreto
TOTP se guarda cifrado con una clave derivada de `.cm-secret`; la base de datos
`web-auth.sqlite3` tiene permisos 0600 y almacena hashes de sesiones y códigos de
recuperación. Respalda ambos archivos juntos, sin publicarlos. Los códigos TOTP
tienen ventana de ±30 segundos y no pueden reutilizarse. Los límites de intentos
se guardan en SQLite y sobreviven a los reinicios.

**Inicio** muestra el resumen general: total de proyectos, proyectos en línea,
peticiones en curso y en cola, consumo de CPU/RAM/disco, contenedores y solicitudes
de aprobación. Las tareas activas indican el proyecto y el agente que trabaja.

**Proyectos** muestra un proyecto a la vez con su ilustración y toda su información:
servicios, herramientas y actividad reciente. Cambia con las flechas, deslizando
la ilustración o tocando los puntos. Usa el buscador para filtrar por nombre o
descripción y **Nuevo proyecto** para abrir la creación. **Más** permite abrir
vista previa, Git, consola, destacados y eliminación.

La barra flotante del celular tiene **Inicio · Proyectos · Crear (esfera) · Cola ·
Servidor**.
**Ajustes** se abre desde el menú superior; en escritorio también está en la barra
lateral. La esfera abre el formulario existente: el futuro modo de creación/agente
se desarrollará después. Las ilustraciones de esta versión también se guardan
en la caché de la PWA al visitarlas.

En **Crear**, describe una idea,
elige tecnología y agente y crea el proyecto. Se genera un repositorio con su
primer commit, Dockerfile, Compose, healthcheck y límites de recursos. El scaffold
publica únicamente `public/`, no los archivos de configuración del proyecto.

Arriba se elige el origen: **Nuevo desde cero** o **Desde un repo Git**.

- **Desde un repo Git**: pega la URL (`https://github.com/usuario/repo`,
  `git@github.com:usuario/repo.git`, `usuario/repo` u otro servidor https/ssh). Se
  valida al dejar de escribir (`git ls-remote` en el host con la llave SSH del VPS,
  así que los privados de esa cuenta funcionan) y se elige rama si hay varias. Se
  clona con todo el historial y ramas (quedan en Versiones); GitHub se guarda como
  `origin` por SSH. No se despliega a ciegas: el agente lo adapta al patrón del
  servidor (Dockerfile/compose con Traefik, healthcheck, límites) y lo publica. Un
  repo vacío recibe el scaffold como un proyecto nuevo.
- **Nuevo desde cero**: «Crear también el repositorio en GitHub (privado)» viene
  marcado cuando GitHub está conectado en **Ajustes → GitHub** (token fine-grained
  con *Administration: Read and write*, o clásico con `repo`; se guarda cifrado en
  `/config/github.json`). Crea el repo, lo enlaza como `origin` y sube el primer
  commit. Si falla, el proyecto local se crea igual y se informa el motivo.
- El repo Git local se crea siempre. Después no hay push automático: se mantiene la
  política del servidor (push bloqueado por defecto).

Las operaciones remotas las ejecuta `bin/cm-repo.py` en el host (vía tmux): solo
https/ssh, sin pedir contraseñas (`GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL`),
sin hooks ni submódulos, y solo dentro de `/srv/projects`.

Cada proyecto tiene agente, vista previa, archivos, terminal, consola,
despliegues y Git. En móvil las herramientas adicionales están en **Más**;
en escritorio hay una vista previa lateral. Los mensajes admiten código,
saltos de línea, adjuntos con miniaturas y dictado cuando el navegador lo permite.

La terminal comprueba el acceso antes de abrir y muestra los errores de conexión.
Si se corta, reintenta con espera progresiva hasta cinco veces; **Reconectar**
permite volver a intentarlo manualmente. Al leer el historial aparece
**Volver al directo**. Enviar un comando desde la línea móvil sale del historial
antes de escribirlo. Hay un máximo de cuatro conexiones por sesión web y doce
globales; cerrar una pestaña desconecta su cliente y conserva la sesión tmux.
Las consultas y commits de Git desde el panel no ejecutan hooks, fsmonitor,
firmas ni conversores definidos por el repositorio; ejecútalos desde la terminal
si necesitas esas tareas de confianza.

Puedes instalar la PWA desde **Ajustes** o el menú del navegador. En iPhone,
usa Safari → Compartir → Añadir a pantalla de inicio. La interfaz y los paneles
ya visitados pueden abrirse sin conexión; ejecutar acciones requiere conexión.

## Pedir cambios hablando

El botón **Hablar** está en el chat del proyecto y en los formularios de creación.
Pulsa una vez, permite el micrófono, habla y elige **Terminar y transcribir**.
Puedes pausar, continuar, escuchar o descargar la grabación y corregir el texto.
Después usa **Insertar texto** o **Enviar a Claude/Codex**. El texto que ya habías
escrito se conserva. En escritorio también puedes usar Alt+Espacio.

La transcripción usa Whisper multilingual small con faster-whisper y cálculo int8
en un servicio privado del VPS. **No requiere API key, suscripción ni pago por
minuto**, y el audio no se envía a un proveedor de IA. No depende de SpeechRecognition
del navegador ni del cupo de Claude/Codex. El reconocimiento se realiza al terminar
la grabación; no es una conversación de audio en tiempo real. En este VPS, una
grabación de unos 13 segundos tarda aproximadamente 13–16 segundos en transcribirse;
el tiempo depende de la carga y la duración.

Se admiten hasta 3 minutos y 12 MB por grabación. Español es el idioma predeterminado;
puedes cambiarlo, añadir vocabulario del proyecto y activar el fin automático tras
6 segundos de silencio. El formato hablado de «nueva línea» / «nuevo párrafo» es
opcional y no se activa por defecto. Si falla la conexión, el audio permanece en
memoria en esa pestaña y puedes reintentarlo. Cancelar, cerrar o recargar la pestaña
descarta ese audio. Al ocultar la app se detiene la captura para no seguir grabando.

Se elige el formato que admite el navegador: WebM/Opus o MP4/AAC, entre otros.
Los errores de permiso o micrófono ocupado muestran indicaciones para recuperarse.
La grabación y transcripción siguen necesitando un micrófono permitido y conexión
con el VPS; la instalación PWA no elimina esas restricciones del sistema operativo.

## Eliminar y recuperar un proyecto

Pulsa la papelera de su tarjeta o **Eliminar proyecto** dentro del espacio de
trabajo (en celular: **Más**). Se comprueban los agentes y despliegues activos y
se pide escribir el nombre exacto. El propio dashboard está protegido.

Al confirmar, se cancelan las peticiones pendientes, se cierran las terminales
del proyecto y se retiran exclusivamente sus contenedores y redes Compose vacías.
No se ejecuta el Compose del proyecto para hacer esta operación. No se eliminan
imágenes ni volúmenes Docker, y los archivos pasan a
`/srv/projects/.cm-trash/<id>/project`. La web queda apagada y desaparece del catálogo.

En **Ajustes → Papelera de proyectos → Restaurar** puedes recuperar los archivos.
Después pulsa **Desplegar** para publicar de nuevo. No se reanudan automáticamente
peticiones antiguas. La papelera no vacía archivos de forma automática: los datos
siguen ocupando disco mientras se conserven. La operación del host tiene logs como
cualquier despliegue y continúa si se cierra el navegador.

En **Ajustes → Avisos → Activar** se suscribe este dispositivo a Web Push:
aprobaciones y resultados llegan también con la app cerrada. Requiere permiso
del navegador y, en iOS, la app instalada. Se pueden desactivar por dispositivo;
cerrar sesión también elimina su suscripción. No requiere un servicio de pago.

## Ejecución y permisos

Cada mensaje se ejecuta como un proceso independiente en el host:

- Claude: `claude -p --output-format stream-json --verbose`.
- Codex: `codex exec --json`; los siguientes mensajes usan `exec resume <id>`.

En **Agente**, el selector **Chat** permite tener conversaciones independientes
para diseño, errores u otras tareas. **+ Nuevo chat** crea una sesión con nombre;
el botón de lápiz permite renombrarla y la papelera la elimina (pide confirmación,
cancela sus mensajes en cola y no toca los archivos del proyecto; no se permite con
una petición en curso). En **Chat principal** la papelera lo **vacía**: oculta su
historial y Claude y Codex empiezan de cero. **Chat principal** conserva las conversaciones
anteriores. La selección, los borradores, adjuntos y el proveedor elegido se
recuerdan por chat en este navegador. El historial y los contextos se guardan en
el servidor. Los enlaces de la cola y avisos abren el chat correspondiente.

Los chats pueden trabajar al mismo tiempo, pero **comparten los archivos del
proyecto**: no son ramas ni entornos aislados. Evita cambios simultáneos en el
mismo archivo. Permisos y reglas «Siempre» siguen siendo del proyecto.

**Claude y Codex comparten el contexto de cada chat**: se puede cambiar de agente en
cualquier mensaje y el trabajo continúa. Cada proveedor mantiene su propia sesión
(`--resume` / `exec resume`) y, al cambiar, el panel antepone al mensaje un resumen
de las peticiones del chat que ese agente no vio (petición, respuesta final,
archivos modificados y versión guardada; hasta 12 peticiones / ~14 000 caracteres).
Si el agente no tiene sesión propia recibe todo el chat desde el último reinicio.
La interfaz muestra «retoma el chat» y el historial enseña solo el mensaje del
usuario (`request.txt`); lo enviado realmente queda en `prompt.txt`.
El panel normaliza los eventos para mostrar respuestas, herramientas, planes y resultados.
La cola despierta al recibir cambios y se reconcilia cada dos segundos:
despacha todos los pares proyecto/chat libres, **un mensaje a la vez por chat**
aunque cambie de agente (el siguiente necesita el resultado anterior); chats
distintos trabajan en paralelo. La salida real del proceso determina cuándo termina una tarea.
Los procesos perdidos se marcan como error y liberan la cola.

En este servidor el usuario autorizó operación autónoma: Claude está configurado
con **Auto**, sin prompts interactivos; su clasificador puede rechazar acciones.
Las nuevas ejecuciones usan ese ajuste. El modo **Aprobar desde la web** sigue
siendo seleccionable en Ajustes cuando se quiera revisión manual. No se usa
`bypassPermissions`.

Codex conserva por defecto el acceso completo autorizado por el usuario.
También se pueden seleccionar los sandboxes de proyecto o solo lectura.

**Detener** solicita SIGINT al grupo del proceso, después SIGTERM y SIGKILL si
no termina. El historial se conserva y la siguiente petición puede continuar
la conversación. **Reiniciar** reinicia el contexto del chat para Claude y Codex,
sin borrar el historial visible y únicamente cuando no tiene mensajes activos ni en cola.
**Reintentar** devuelve una tarea fallida a la cola. Si el proveedor agota su
cupo, se muestra el error; para Claude también se muestra la fecha de reposición
que informa su CLI. El límite no deja la cola bloqueada.

## Archivos, Git y despliegue

El explorador permite leer, editar, crear, mover, borrar y subir archivos.
Las rutas y enlaces se confinan al proyecto. Los guardados verifican una versión
opaca del archivo para detectar cambios del agente y evitar sobrescrituras.
Los archivos recortados por tamaño se muestran en modo de solo lectura.

### Versiones (Git)

La herramienta **Versiones** (Más → Versiones en el celular) convierte Git en un
versionador. **Cada acción queda como un commit propio**: cada respuesta de
Claude/Codex (con lo pendiente de antes guardado aparte), cada guardado del
editor, crear/mover/borrar/subir archivos y cada despliegue. Los commits llevan
trailers `Codex-Manager-Action/Provider/Run/Restores/Reverts` para mostrar quién
hizo cada cambio. Si un proyecto no tenía repositorio, la primera acción lo crea.
Se desactiva en Ajustes → Versiones (Git).

- **Historial**: línea de tiempo con autor (Claude, Codex, editor…), archivos y
  líneas, versión actual y **En producción** (último despliegue desde el panel).
  El detalle muestra los archivos cambiados, sus diferencias y **Comparar con la
  actual** (lo que cambiaría al restaurar).
- **Deshacer último cambio** (rollback rápido): vuelve a la versión anterior y
  se puede repetir para seguir retrocediendo. Con cambios sin guardar, primero
  deshace esos cambios (quedan guardados en el historial).
- **Restaurar esta versión**: deja todos los archivos como en esa versión con un
  commit nuevo; nada se borra del historial, así que siempre se puede volver.
- **Deshacer solo este cambio**: `git revert` de una versión concreta conservando
  lo posterior. También desde el chat: «Deshacer estos cambios» bajo cada respuesta.
- **Ramas**: alternativas del proyecto. Crear (desde la actual o desde cualquier
  versión), ver su historial (marca lo exclusivo de cada una), cambiar, integrar
  (merge sin fast-forward; con conflicto no se integra nada) y eliminar (queda
  archivada en `refs/codex-manager/archivadas/`).
- Restaurar, deshacer, cambiar o integrar ofrecen **… y publicar** para desplegar
  a la vez. Se bloquean mientras un agente trabaja o hay un despliegue en curso.

Seguridad: antes de cambiar archivos se confirma lo pendiente; los archivos
ignorados que otra versión sobrescribiría (p. ej. `.env`) se copian en
`.git/codex-manager/respaldos/`. `.git/info/exclude` evita versionar `.env*`,
claves, `node_modules`, adjuntos del chat y archivos de más de 50 MB, sin tocar
el `.gitignore` del proyecto. Panel y runner del host se coordinan con un flock
en `.git/codex-manager.lock`. Código: `cm/vcs.py` (núcleo) y `cm/gitops.py`.

El panel no hace push. Los trabajos de despliegue muestran su salida en vivo y
continúan aunque se cierre el navegador o se reinicie el contenedor del panel.
Los contenedores se asocian por la etiqueta de proyecto Compose; Traefik y la
infraestructura ajena no tienen controles. El dashboard protege su propio apagado.

## Instalación y operación

Requiere Docker Compose, la red externa `proxy`, Traefik con el resolver
`letsencrypt`, Git y tmux en el host, y las CLIs autenticadas de Claude y Codex.
El usuario operativo es `dv1` (UID 1002). Copia `.env.example` a `.env` y configura
una contraseña larga. No publiques `.env` ni las credenciales de las CLIs.

El servicio `deploy/codex-tmux.service` mantiene vivo el servidor tmux del host.
Está instalado y habilitado en este VPS. Los agentes y trabajos usan sesiones
internas `cmr-*` y `cmj-*`; las terminales interactivas permanecen al desconectar
el navegador. Reiniciar el dashboard no destruye estas sesiones.

```bash
docker compose build
docker run --rm codex-dashboard-dashboard python -c 'import app'
docker run --rm -v /srv/projects/codex-dashboard:/src:ro -w /src \
  codex-dashboard-dashboard python -m unittest discover -s tests
docker compose up -d --wait --wait-timeout 40
docker compose ps
curl --fail https://codex-dashboard.devdj.lat/health
```

La imagen construye React/Vite con Node sobre Debian para las dependencias nativas
GNU del lockfile. El servidor aiohttp corre sin root, con init, healthcheck,
384 MB de RAM, una CPU y 256 procesos como máximo.

El servicio privado `speech` usa `Dockerfile.speech`: modelo small multilingüe
fijado por revisión, CPU int8, dos hilos de inferencia, límite de 1.5 CPU, 2 GB y
96 procesos. Solo está conectado a la red interna, tiene el sistema de archivos
de solo lectura y no monta los proyectos ni credenciales. El modelo se descarga
al construir la imagen, no durante una grabación. El primer build descarga varios
cientos de MB. Su `/health` comprueba que el modelo esté cargado. Al arrancar por
primera vez conviene esperar hasta 90 segundos: `docker compose up -d --wait --wait-timeout 90`.

El contenedor monta los proyectos, Docker y el socket de tmux; es una herramienta
administrativa del VPS. La API exige autenticación y verifica Origin en cambios
y WebSocket para aislarla de otras webs del mismo dominio. Los archivos servidos
desde proyectos tienen una política de contenido que bloquea scripts.

## Datos persistentes y comprobaciones

`/home/dv1/.config/codex-automation/`, montado como `/config`, conserva:

- `tasks.tsv`: cola compatible con las herramientas anteriores; 14 columnas con escapes (la última es `chat_id`; filas anteriores pertenecen a `main`).
- `chats.json`: nombres e identificadores de los chats de cada proyecto.
- `chats-archive.json`: chats eliminados y vaciados del principal (fecha, contextos
  anteriores y mensajes cancelados). Sus ejecuciones siguen en `runs/`.
- `runs/`, `jobs/`: metadatos, eventos, logs, aprobaciones y códigos de salida.
- `agent-sessions.json`, `settings.json`, `approval-rules.json`.
- `.cm-secret`: firma de sesiones; cambiar la contraseña invalida las cookies.
- `.push-vapid.pem`, `push-subscriptions.json`: identidad y suscripciones push.
- `project-operations/`: seguimiento de las eliminaciones del host.

No borres las claves al reconstruir: se perderían las sesiones o los avisos.
Respalda este directorio junto con el código y los proyectos.

Las pruebas automáticas cubren cola, procesos, eventos de ambos proveedores,
MCP, permisos, archivos, autenticación, HTTP, Docker y Web Push.
También se prueban el proxy de voz y las protecciones de eliminación/restauración;
el frontend tiene pruebas de formatos, permisos e inserción (`cd frontend && npm test`).
`tools/verify_voice_browser.cjs` usa micrófono virtual, MediaRecorder y Whisper real,
y elimina/restaura únicamente el proyecto reservado `cm-voice-check-20261017`.
`tools/verify_runner.py <directorio-evidencias> [claude|codex|all]` comprueba las
CLIs reales con tareas acotadas y Codex solo lectura; consume el cupo de la cuenta.
`tools/verify_live.py` crea un proyecto temporal para comprobar el sistema publicado.
`tools/verify_browser.cjs` verifica móvil, escritorio, editor, terminal y PWA con
Playwright 1.55.0. Estas dos últimas pruebas usan `MONITOR_USER` y
`MONITOR_PASSWORD` y el proyecto reservado `cm-smoke-20261017`; no son pruebas
que deban ejecutarse indiscriminadamente contra producción.

Los scripts de validación con login requieren además `CM_AUTH_CODE` (un código
actual o de recuperación). Las pruebas de varios navegadores admiten
`CM_AUTH_CODES` separados por comas, uno distinto por inicio de sesión. No leen
el secreto TOTP del servidor ni evitan el segundo factor. No configuran un
autenticador automáticamente en producción.

`tools/verify_auth_browser.cjs` valida el alta, QR/clave manual, login TOTP,
recuperación, duración, cambio de factor y cierre de sesiones. Solo acepta una
URL HTTPS local en `CM_AUTH_TEST_URL`; requiere una instancia desechable con
usuario `tester` y contraseña de prueba `isolated-auth-browser-test`, sin montajes
de proyectos, datos ni credenciales reales. Su configuración inicial debe estar
vacía. Las pruebas Python de autenticación también usan directorios temporales.
La implementación sigue las guías de [PyOTP](https://pyauth.github.io/pyotp/) y
[gestión de sesiones OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

Consulta `SEMILLA.md` antes de trabajar y actualízalo al terminar.

### Respaldo del servidor autónomo

`codex-dashboard-backup.timer` guarda una copia diaria privada de código pendiente,
historial Git y configuración (SQLite consistente), con sumas SHA256 y retención
de 14 copias completas en `/srv/platform/backups/codex-dashboard-auto/`.
Copia adicional antes de cambios delicados:
`python3 /srv/platform/bin/backup-codex-dashboard.py`.
Ver recuperación en SEMILLA.md. Los respaldos contienen secretos: no publicarlos.
