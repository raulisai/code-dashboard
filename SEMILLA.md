# SEMILLA — estado del trabajo en codex-dashboard

> Leer antes de trabajar. Actualizar las secciones 0, 4 y 5 al terminar.

Última actualización: 2026-10-17, 19:15 Europe/Berlin. Autor: Codex.

## 0. Estado en una línea

**Última ampliación: varios chats independientes por proyecto.** Agente incluye
selector de chat, creación con nombre, renombrado, indicadores de actividad y
borradores/adjuntos/proveedor recordados por chat. El historial anterior permanece
en «Chat principal». Contextos de Claude/Codex y cola separados por chat; varios
chats pueden trabajar simultáneamente sobre los mismos archivos del proyecto.
**103 pruebas Python + 5 Node OK**. Chromium comprobado a 360/390/768/1440 px
con API de prueba interceptada (sin enviar tareas reales ni gastar cuota).
Publicado en https://codex-dashboard.devdj.lat; dashboard y speech saludables,
`/health` HTTPS 200 y API de chats sin sesión 401. La comprobación final del
navegador se repitió después del último despliegue y terminó correctamente.

**Última sesión: autenticador TOTP y sesiones revocables de hasta 180 días
implementados, probados y publicados.** El usuario eligió contraseña + app
autenticadora. Al entrar por primera vez debe vincular su app y confirmar un
código; antes de hacerlo no se permite acceder a proyectos ni ejecutar acciones.
**Pendiente del usuario: completar esa vinculación y guardar los diez códigos de
recuperación.** A las 19:05 todavía no había un TOTP vinculado en producción.
Marcar «Recordar este dispositivo durante 180 días» para el plazo largo; sin
marcar, cookie de navegador con máximo 12 horas. Cookies antiguas invalidadas y
Basic Auth retirado. **93 pruebas Python + 5 Node OK**, navegador real aislado a
360/390/1440 px y login público real comprobado. HTTPS Inicio/Ajustes/health 200,
API sin sesión 401 y Origin ajeno 403; ambos contenedores healthy.

**Sesión anterior: Inicio es el resumen general y Proyectos es el carrusel individual,
publicado en https://codex-dashboard.devdj.lat.** Se corrigió la organización según
el usuario: Inicio muestra total/en línea, peticiones trabajando/pendientes,
CPU/RAM/disco, Docker/agentes, contenedores y aprobaciones. `/projects` contiene
la vista 3D uno a uno con búsqueda por nombre/descripción y **Nuevo proyecto**.
Se conserva el estilo neón y las herramientas existentes. La esfera sigue abriendo
`/new`; el futuro modo creación/agente está pendiente por decisión del usuario.
Vite y 5 pruebas Node OK; revisión Playwright real a 360/390/768/1440 px, incluyendo
estado vacío, filtro sin resultados y PWA offline. Los 77 tests Python son de la
sesión anterior y no se repitieron por este cambio de interfaz.

**La versión nueva está implementada, probada y publicada en
https://codex-dashboard.devdj.lat; el contenedor está healthy.**
La interfaz móvil/escritorio, Codex, conversación continua, cola, detención,
reintento, terminal, archivos, Git, despliegue, PWA offline, adjuntos y Web Push
están implementados. Pasan **64 pruebas**. La web se comprobó con Playwright real.

**Ampliación actual:** dictado por audio con Whisper local y eliminación/restauración
de proyectos implementados y publicados. Hay **77 pruebas Python + 5 de frontend**.
Dos servicios saludables: `dashboard` y `speech`. El micrófono ya no depende de
SpeechRecognition del navegador ni de cuotas de Claude/Codex. Ver detalles al
principio de la sección 5; el bloque de 64 pruebas anterior es el hito previo.

**Limitación externa:** la cuenta de Claude agotó su cupo de cinco horas hasta
el **17 de octubre de 2026 a las 14:50 Europe/Berlin** (`resetsAt: 1792241400`).
Claude arranca, conecta el MCP del panel y termina con error de cuota sin bloquear
la cola. No fue posible verificar un turno real de Claude que use Bash por ese
límite. Sí se verificaron por separado el MCP real y la API web, incluyendo
Permitir, Denegar y Siempre. No presentar esto como una respuesta real del modelo.

No cambiar el agente predeterminado sin autorización: se conservan los ajustes.
Codex sí respondió, reanudó contexto y se detuvo/reintentó desde la web.

## 1. Qué pidió el usuario

1. Desbloquear las peticiones a Claude Code / Codex que se quedaban colgadas.
2. Un entorno tipo Replit por proyecto: agente, vista previa, archivos, terminal,
   logs, Git y despliegue.
3. Usarlo desde el celular como PWA, sin SSH para el trabajo habitual.
4. Retomar lo dejado por el agente anterior, implementar lo pendiente y mejorar
   lo necesario para dejarlo funcionando.
5. Mejorar al máximo el dictado para pedir cambios hablando, parecido a Wispr Flow,
   con buen uso desde celular y opción económica, y permitir eliminar proyectos.
6. Aplicar estilo neón de la imagen; Inicio debe ser un resumen general y Proyectos
   la vista uno a uno con buscador y opción de crear un nuevo proyecto.

## 2. Causas del sistema anterior

Se escribían peticiones en la TUI con `tmux send-keys` antes de que el agente
estuviera listo. El fin dependía de un archivo `.done` creado por el propio agente;
si faltaba, la tarea bloqueaba la cola indefinidamente. Claude no podía recibir
aprobaciones desde la web. La cola revisaba cada 60 s, despachaba una tarea por
vuelta y bloqueaba el estado. El límite de PIDs era insuficiente y no había
recuperación del servidor tmux del host. Todo eso se sustituyó.

## 3. Decisiones del usuario (conservar)

- Claude: ediciones del proyecto aceptadas automáticamente y otras acciones
  aprobadas desde la web. **No usar `bypassPermissions`.** El modo habitual es `ask`.
- Codex: conservar acceso completo, equivalente a `codex --yolo`.
- Está autorizado e instalado el servicio systemd que mantiene tmux en el host.
- Para pruebas acotadas: Claude con aprobación web o sin herramientas;
  Codex con `read-only`. No lanzar agentes con bypass para sortear restricciones.
- No modificar la cuenta de recuperación `rootai` ni su SSH.
- Autenticación web: el usuario eligió **contraseña + app autenticadora TOTP** y
  recordar dispositivos hasta seis meses. Mantener el segundo factor obligatorio,
  las sesiones revocables y los códigos de recuperación. No habilitar Basic Auth
  ni vincular automáticamente un autenticador de pruebas a su cuenta real.

## 4. Pendientes y límites de validación

### Chats por proyecto (sesión actual)

- Implementación terminada. Se crean desde **Agente → + Nuevo chat** y se cambian
  con el selector **Chat**. El lápiz renombra los chats adicionales; el principal
  conserva su nombre. No se añade borrado de chats: el historial se conserva.
- Cada chat/proveedor tiene contexto propio y procesa sus mensajes en orden;
  chats distintos pueden ejecutar tareas en paralelo. **Los archivos, despliegues
  y reglas Siempre son compartidos por proyecto**; no se han creado worktrees ni
  sandboxes independientes. Evitar cambios simultáneos en el mismo archivo.
- Verificación de aislamiento/reanudación/planificador mediante pruebas automáticas;
  no se lanzaron turnos reales de modelos ni se tocaron proyectos ajenos. Navegador
  real sobre la web desplegada con todas las API interceptadas por fixtures aisladas.
  No se dispone del móvil físico del usuario ni se repitió la transcripción real.
- Se conservaron los cambios de autenticación TOTP/180 días de la sesión contigua.
  No vincular un autenticador de pruebas a la cuenta del usuario para verificar chats.

### Autenticador y sesiones de seis meses (última sesión)

- Implementación terminada y desplegada. **El usuario debe recargar la web,
  iniciar sesión, generar el QR/clave, vincular su app TOTP, confirmar un código y
  guardar los códigos de recuperación.** Para los seis meses debe marcar la opción
  de recordar dispositivo en la vinculación o en un login posterior. No se generó
  ni vinculó un secreto TOTP real por cuenta del usuario. El alta es obligatoria
  para acceder al panel; la sesión provisional dura diez minutos y solo sirve
  para configurarlo. Las cookies anteriores ya no funcionan.
- No se ha usado su teléfono físico: QR, copia manual, descarga de códigos y flujo
  completo se verificaron con Chromium real en una instancia local desechable.
  Los enlaces `otpauth://` dependen de la app instalada; la clave manual sigue
  disponible para completar el alta desde el mismo celular.
- Scripts de validación anteriores adaptados para pedir `CM_AUTH_CODE` o, en los
  de varios navegadores, `CM_AUTH_CODES` separados por comas. Solo se revisó su
  sintaxis; no se lanzaron sus operaciones sobre proyectos, voz ni agentes. Un
  código ya usado no se puede reutilizar ni siquiera en otro navegador.
- Respaldo: `/srv/platform/backups/codex-dashboard-before-auth-20261017-185317/source.tgz`
  (directorio 0700, incluye `.env`) e imagen `codex-dashboard:before-auth-20261017`.
  Conservar `.cm-secret` y `web-auth.sqlite3` juntos. El archivo
  `agent-sessions.json` sigue siendo conversaciones de agentes, no sesiones web.

### Organización de Inicio y Proyectos (última sesión)

- Solicitud atendida y publicada: **Inicio = resumen general**; **Proyectos =
  uno a uno con toda la vista anterior, búsqueda y Nuevo proyecto**. Mantener
  esta separación en próximos cambios.
- La esfera central continúa abriendo la creación actual; implementar el modo
  creación/agente nuevo sigue aplazado expresamente por el usuario.
- La comprobación de navegador no muta el servidor. Los casos sin proyectos,
  peticiones en cola y aprobaciones se simularon únicamente interceptando la API
  en el navegador; las capturas habituales usan datos reales del servidor.
- El script de voz se adaptó al nuevo menú de eliminación: buscar el proyecto,
  Opciones → Eliminar. Solo se verificó su sintaxis; no se repitieron operaciones
  destructivas ni la transcripción real por una reorganización de interfaz.


### IU neón (sesión anterior)

- Adaptación visual terminada y publicada. Referencia:
  `.codex-manager/uploads/Neon Project Dashboard Triptych.png`.
- **Pendiente solicitado explícitamente:** desarrollar después el nuevo modo
  creación/agente del botón central. Por ahora se muestra la esfera y abre `/new`
  con las funciones existentes; no se añadió un agente global ni otro flujo de IA.
- El usuario debe valorar la semejanza y comodidad en su celular. Se comprobó
  navegador real en varios tamaños, sin disponer de su dispositivo físico.
- Los iconos bajo el arte son herramientas reales del proyecto; no se inventan
  tecnologías instaladas ni tareas de ejemplo. Los resúmenes usan la API actual.
- La selección del carrusel se guarda por dispositivo; las flechas, puntos y el
  gesto horizontal cambian de proyecto. Los proyectos se gestionan en `/projects`.
- El formulario y el chat conservan el dictado. Se adaptaron los selectores de
  `verify_voice_browser.cjs` a `/new`, `.create textarea` y `/projects` (eliminación).
  Solo se comprobó su sintaxis; no se repitió la transcripción ni el borrado real.
  No ejecutarla sin preparar su proyecto temporal: es una prueba que muta datos.


### Dictado y papelera (sesión anterior)

- Implementación completa y desplegada. El audio WebM/Opus y MP4/AAC se ha
  transcrito con el motor real en español. Se probó captura MediaRecorder con
  micrófono virtual, pausa/continuación, revisión, inserción sin borrar borrador,
  audio recuperable ante fallo de red y envío al proyecto/agente elegido.
- WebKit comprobado para UI y recuperación de permiso denegado mediante mock.
  **No se dispone del micrófono físico del usuario ni de un iPhone físico**:
  hace falta su prueba de comodidad, acento, ruido y permisos del sistema.
- Whisper small int8 es la elección local equilibrada para este VPS de 4 CPU/8 GB.
  No se ha prometido latencia instantánea ni exactitud perfecta: revisar antes de
  enviar. La muestra sintética de 13 s tarda ~13–16 s y puede confundir palabras.
  No usar resultados de voz robótica como medida de precisión con voz humana.
- Cada captura admite 3 min / 12 MB. Timeout de transcripción 300 s (cliente 305 s)
  para admitir dictados largos en CPU. Una transcripción a la vez; un segundo
  cliente recibe error recuperable. Solo hay inferencia al transcribir, no consumo
  continuo de CPU en reposo. No hay API de pago ni claves nuevas.
- No se encontró un proyecto llamado Wispr/Whisper entre los proyectos del VPS.
  Se avanzó con esta implementación independiente. Se preguntó opcionalmente qué
  significaba «Econo»; se cubrieron economía y experiencia del botón, sin esperar
  una respuesta para hacer el trabajo.
- La prueba de eliminación/restauración usa exclusivamente `cm-voice-check-20261017`.
  Sus artefactos se archivan en el respaldo de voz indicado en sección 6. No tocar
  proyectos reales para repetir pruebas destructivas.

No quedan pasos de implementación del traspaso anterior pendientes. Tampoco quedan
el proyecto ni los contenedores de prueba publicados.

1. **Cuando Claude recupere cupo**, verificar el turno completo del modelo con
   Bash → permiso web → respuesta. El puente MCP se ve `connected` en el evento
   de inicio de la CLI, y sus extremos MCP/HTTP ya están probados.
   Para repetir la prueba del host con evidencias en una carpeta NUEVA:
   `python3 tools/verify_runner.py /srv/platform/backups/cm-validation-<fecha-nueva> claude`.
   Prueba permitir `echo`, reanudar y denegar otro `echo`, y detener `sleep 60`.
   No reutilizar el directorio de la prueba de cuota: el script evita sobrescribirlo.
2. **Avisos push en un celular físico:** implementación y receptor comprobados,
   pero falta que el usuario active Ajustes → Avisos en su dispositivo. En iOS
   requiere instalar la PWA. No hay suscripciones de prueba persistentes ni se
   enviaron notificaciones a dispositivos ajenos. El transporte externo se probó
   con mocks; el evento push y la notificación se probaron realmente en Chromium.
3. Hay usuarios trabajando en otros proyectos desde el panel. Durante la validación
   aparecieron terminales de `mapachanel`/`poleana-game` y una ejecución de Codex
   para `poleana-game`. **No detener ni limpiar sesiones o tareas que no sean las
   pruebas propias.** La limpieza realizada filtró exactamente `cm-smoke-20261017`.

Los scripts `verify_live.py`, `verify_controls.py` y `verify_browser.cjs` utilizan
el nombre reservado `cm-smoke-20261017`. Son pruebas que mutan un proyecto temporal,
no comandos de diagnóstico que deban lanzarse sin preparar y limpiar ese proyecto.

## 5. Implementación y verificaciones completadas

### Conversaciones múltiples por proyecto

- `cm/chats.py`: catálogo privado/atómico `chats.json`, hasta 100 chats adicionales
  por proyecto, identificadores aleatorios, títulos editables y contadores reales.
  Creación/renombrado serializados con la cola y borrado de proyectos.
- API autenticada `GET|POST /api/agent/chats`; agente/send/reset reciben `chat_id`.
  Se valida pertenencia al proyecto, sin permitir enviar a identificadores inventados.
  Rutas sujetas a las mismas protecciones de sesión, TOTP y Origin existentes.
- TSV ampliado con columna 14 `chat_id`; filas antiguas van a `main`. Se mantiene
  decodificación de escapes de filas de 13 columnas, sin romper mensajes previos.
  Metadatos de runs incluyen chat; el historial filtra antes de aplicar su límite.
- `agent-sessions.json` conserva proveedores del principal y agrega `_chats` para
  los nuevos. Reanudación, finalización y reinicio afectan solo al chat/proveedor.
  El planificador ahora reserva proyecto/chat/proveedor. Reiniciar se bloquea con
  mensajes activos o pendientes para no cambiarles el contexto inesperadamente.
- Interfaz conserva dictado y adjuntos; compositor montado por identidad de chat,
  borradores y adjuntos locales separados, contexto visible y aviso de archivos
  compartidos. Chat seleccionado persistente y enlazable mediante `?chat=<id>`.
  Cola y avisos push enlazan al chat correcto, incluyendo explícitamente `main`.
- Eliminar proyecto archiva también catálogo/contextos y limpia todos los IDs de
  conversación. Restaurar recupera nombres/historial, nunca sesiones ejecutables,
  permisos anteriores ni tareas canceladas.
- `tests/test_chats.py`: compatibilidad, concurrencia de escrituras, reanudación
  por proveedor, finalización de threads, historial/cola separados, reset seguro,
  borrado/restauración y HTTP autenticado/Origin/pertenencia. Suite: **103 Python OK**.
- `tools/verify_chats_browser.cjs`: UI real con API aislada, crear/renombrar,
  cambiar chats, separar borradores/adjuntos/colas, enviar al chat correcto,
  recargar y conservar selección/borrador, micrófono visible y sin desbordamientos
  a 360/390/768/1440 px. **CHATS_BROWSER_OK** sobre HTTPS publicado. Capturas:
  `artifacts/chats-20261017/`. Build Vite y 5 tests Node OK.
- Respaldo previo de fuente sin secretos: `/srv/platform/backups/codex-dashboard-before-chats-20261017/source.tgz`;
  imagen `codex-dashboard:before-chats-20261017`. Solo se reconstruye/recrea
  `dashboard`; se mantienen speech, Traefik y ejecuciones de agentes del host.

### Autenticador TOTP y sesiones revocables (última sesión)

- `cm/auth.py`: sesiones opacas de 256 bits, verificadores SHA-256 en SQLite,
  plazo absoluto y renovación cada 24 horas con gracia de 60 segundos para
  peticiones concurrentes. Cambiar la contraseña invalida sesiones y verificaciones
  pendientes. Logout revoca en servidor; lista y cierre individual/de las otras
  sesiones en Ajustes. Terminales web revisan revocación cada cinco segundos y
  desconectan solo su cliente, sin matar el tmux/proceso del proyecto.
- `app.py`: Basic Auth retirado y cookies antiguas ignoradas. Cookie
  `__Host-cm_session`, Secure siempre, HttpOnly, SameSite Strict, sin Domain y
  Path `/`. Verificación de Origin compara esquema y host exactos. API JSON
  responde no-store incluso al rechazar autenticación/origen.
- Login en dos pasos: contraseña válida genera challenge de cinco minutos,
  ligado a navegador y versión de credenciales. TOTP de seis dígitos, ventana de
  ±30 segundos y contador consumido atómicamente para impedir repetición.
  Alternativa de recuperación de un solo uso requiere igualmente contraseña.
  Límites persistentes: seis fallos por IP y treinta de factor por cuenta en diez
  minutos, además de seis intentos por challenge/configuración.
- Alta obligatoria con QR generado en el servidor localmente, clave copiable y
  enlace `otpauth://`. Estado inicial solo permite `/api/me` y configurar TOTP;
  no da acceso al estado/proyectos/agentes/archivos/terminal. Confirmar un código
  activa el factor, invalida sesiones/challenges anteriores y muestra diez códigos
  de recuperación de 80 bits, solo una vez. Se descargan localmente y se pide
  confirmar que se guardaron. No se guardan en localStorage ni logs.
- Cambiar el autenticador o renovar recuperación exige contraseña + factor
  actual/código de recuperación; al cambiar, el factor anterior sigue activo
  hasta confirmar el nuevo. Se revocan las otras sesiones y los códigos previos.
  `web-auth.sqlite3` tiene permisos 0600 y secreto TOTP cifrado con Fernet,
  clave derivada de `.cm-secret`. Las transacciones serializan consumos concurrentes.
- `SESSION_DAYS=180` en `.env` y ejemplo; máximo permitido 180. Recordar es una
  elección explícita del dispositivo; sin marcar, cookie no persistente y límite
  de doce horas. `Security.jsx`, Login, App y Ajustes integran el flujo en español
  y estilo existente; service worker pasa a v5. Dependencias fijadas: PyOTP 2.9.0,
  qrcode 8.2 y cryptography 50.0.2 (esta última ya estaba transitivamente instalada).
- Nuevas pruebas de alta restringida, dos factores, repetición y consumo
  concurrente, revocación/logout con cookie copiada, rotación con gracia y plazo
  absoluto, sesiones temporales, sustitución de factor, recuperación, cifrado y
  permisos, ventana de reloj, vencimiento de challenge y bloqueo de Basic/Origin.
  **93 tests Python OK**, **5 Node OK** y build Vite OK.
- `tools/verify_auth_browser.cjs`: **AUTH_BROWSER_OK**, flujo real en HTTPS local,
  QR y copia al portapapeles, código inválido y válido, login TOTP independiente,
  duración de cookie persistente y temporal, descargar/guardar recuperación,
  revocar otro navegador, recuperar, renovar códigos, cambiar factor y probar una
  cookie copiada tras logout. Capturas a 360/390/1440 px, sin desbordamientos ni
  errores JavaScript. Instancia sin montajes de proyectos o credenciales reales;
  contenedor temporal retirado al terminar. No se autenticó ni configuró el
  usuario real durante estas pruebas.
- Publicado con `docker compose up -d --build --wait --wait-timeout 90`.
  `dashboard` y `speech` healthy. Curl HTTPS Inicio/Ajustes/health 200;
  `/api/state` sin cookie 401 y login con Origin ajeno 403. Configuración efectiva
  180 y SQLite 0600 comprobados. **LIVE_LOGIN_OK**: pantalla nueva visible en la
  URL real sin iniciar sesión ni crear un factor. Logs del dashboard sin errores.
- Evidencia: `artifacts/auth-20261017/`, con deploy.log, pruebas y capturas; copia
  privada de logs en `/srv/platform/backups/codex-dashboard-auth-validation-20261017/`.
  Pruebas antiguas usan helpers `tools/auth_client.py` y `browser_auth.cjs` para
  completar MFA con código aportado, sin leer el secreto ni eludir la protección.
  README documenta alta, recuperación, sesiones, almacenamiento y operación.

### Diagnóstico de autenticación y opciones (sesión anterior)

- Leídos `cm/auth.py`, `cm/config.py`, middleware y handlers de `app.py`, formulario
  Login, Compose y pruebas existentes de auth/HTTP. Duración efectiva en el servicio:
  `SESSION_DAYS=30`. Cookie HMAC con vencimiento absoluto y nonce, HttpOnly,
  SameSite Strict y Secure cuando la petición se reconoce como HTTPS. Cambiar la
  contraseña invalida los tokens por su firma. Hay control de Origin para mutaciones
  y terminal, y límite en memoria de seis fallos por IP en diez minutos.
- No hay passkeys, TOTP, renovación, persistencia de sesiones web ni revocación
  en servidor al salir. Basic Auth sigue admitido por todas las API protegidas.
  Se explicó el problema del logout al usuario; no se probaron ataques en producción.
- Consultadas las guías primarias OWASP de Session Management, Authentication y
  Multifactor Authentication: renovación y vencimiento en servidor, revocación al
  salir, reautenticación sensible y passkeys con verificación de usuario.
- Comprobación de disponibilidad sin autenticar: curl HTTPS `/health` respondió
  `ok` con estado 200. No se repitieron suites porque no cambió código de la app.

### Inicio general y Proyectos individuales (última sesión)

- `Home.jsx` ahora muestra el estado global con cuatro indicadores: todos los
  proyectos, proyectos con contenedores activos, peticiones trabajando y en cola.
  Datos de `/api/state`, actualización automática existente. Incluye CPU/RAM/disco,
  estado Docker/tmux, contenedores, aprobaciones y enlaces al agente/proyecto de
  cada petición en curso. Sin datos de ejemplo ni cambios de backend.
- `Projects.jsx` aloja el carrusel que antes estaba en Inicio. Conserva selección
  persistente, flechas, puntos, gesto horizontal, arte 3D, herramientas, actividad,
  destacados, eliminación y menú de ajustes. Buscador visible por nombre o
  descripción, ignora espacios en extremos y muestra vacío cuando no coincide.
  El botón **Nuevo proyecto** abre `/new`, incluso sin proyectos o sin resultados.
- `App.jsx` importa las vistas por separado. `neon.css` adapta las dos pantallas
  a celular/tableta/escritorio manteniendo barra flotante y tema. Las ilustraciones
  existentes se reutilizan; no se generaron imágenes nuevas.
- README actualizado y selectores de `verify_voice_browser.cjs` adaptados a la
  eliminación desde el carrusel. No se ejecutó ese script que muta proyectos.
- Build Vite y 5 tests Node OK. `verify_neon_browser.cjs` actualizado: resumen
  general contrastado con datos de la API, carrusel en `/projects`, búsqueda con
  espacios, un resultado, ningún resultado, limpiar filtro, crear desde búsqueda,
  ajustes, cinco accesos, archivos/agente/vista previa/consola/Git/despliegue,
  dictado visible, casos simulados de pendientes/aprobaciones/sin proyectos y PWA
  offline tanto en Inicio como en Proyectos. Chromium en 360/390/768/1440 px.
- Publicado con `docker compose up -d --build`. `/`, `/projects` y `/health`
  HTTPS 200; servicios `dashboard` y `speech` saludables. Sin tareas enviadas,
  reinicios globales ni operaciones sobre proyectos ajenos.
- Evidencias: `artifacts/overview-20261017/` (capturas de ambas vistas y deploy.log).
  Respaldo de archivos: `/srv/platform/backups/codex-dashboard-before-overview-20261017/frontend.tgz`;
  imagen: `codex-dashboard:before-overview-20261017`.


### IU neón y navegación (sesión anterior)

- `frontend/src/neon.css`: fondo negro, superficies de cristal, bordes suaves,
  acentos azules, esfera animada CSS, respeto de movimiento reducido y zonas
  seguras del celular. Tema compartido por creación, ajustes y workspace.
- `Home.jsx`: carrusel de proyectos con selección persistente, flechas, puntos,
  gesto horizontal, resumen, contadores de contenedores y tres peticiones reales.
  Abre herramientas existentes y menú con destacados, web, ajustes y eliminación.
- `/projects`: tarjetas con miniaturas, búsqueda, orden, destacados y eliminación.
  Enlaces y botones separados, sin controles interactivos anidados dentro de enlaces.
- `App.jsx`: cinco accesos móviles en el orden de la imagen y Proyectos en
  escritorio; Ajustes continúa en menú y lateral. `Queue.jsx` admite filtro
  `?project=` desde la actividad. No se alteraron backend ni permisos de agentes.
- Tres ilustraciones producidas con la herramienta integrada `image_gen` y la
  habilidad imagegen. Finales: `frontend/public/art/{server,game,media}-neon.webp`.
  Optimización con ffmpeg a 960×640, ~42–49 kB cada una. PNG originales y prompts
  completos en `artifacts/neon-20261017/`, especialmente `image-prompts.json`.
- `sw.js` v4 cachea arte además de JS/CSS; colores del manifest y HTML ajustados.
  README documenta los nuevos accesos. `/new` mantiene la creación ya existente.
- Compilación Vite y **5 tests Node OK**. `tools/verify_neon_browser.cjs` verifica
  solo lectura sobre la URL real: carrusel, contador cotejado con la API, cinco
  accesos, búsqueda, menú de ajustes, paneles de archivos/agente/vista previa/
  consola/Git/despliegue, dictado visible y PWA offline con arte visible.
  **NEON_BROWSER_OK** en Chromium a 360/390/768/1440 px, sin desbordamiento ni
  errores JavaScript. No crea proyectos, no modifica archivos desde la web ni
  envía mensajes a modelos; no ejecuta acciones de despliegue o de eliminación.
- Publicación mediante `docker compose up -d --build`. HTTPS `/` y `/health` 200,
  WebP 200 y ambos servicios saludables. No se reiniciaron Docker, Traefik ni
  proyectos de terceros. Capturas y log: `artifacts/neon-20261017/`.
- Respaldo anterior: `/srv/platform/backups/codex-dashboard-before-neon-20261017/frontend.tgz`;
  imagen `codex-dashboard:before-neon-20261017`.
- La primera revisión de navegador coincidió con la reconstrucción y falló al
  descargar un arte. Repetida después del despliegue, completó todos los pasos.


### Voz y eliminación de proyectos (última sesión)

- `frontend/src/VoiceInput.jsx` y `voice.js`: botón Hablar visible, captura de
  micrófono con reducción de ruido/eco cuando el navegador lo admite, selección
  de formato compatible, onda de nivel, contador, pausa/continuación y límite de
  3 min. Parada opcional tras 6 s de silencio y vocabulario por dispositivo.
  Idiomas es/en/pt/fr/de/it y autodetección; español predeterminado.
- La captura pasa a revisión editable. Se puede escuchar/descargar/reintentar el
  mismo audio; el borrador anterior se conserva al insertar o enviar. Enviar solo
  ocurre tras el clic explícito, con el proveedor/proyecto de ese compositor.
  Se liberan tracks, AudioContext, URLs y wake lock al terminar/cancelar/salir.
  Al ocultar la app se detiene la grabación. El diálogo usa portal para que sus
  botones no envíen accidentalmente el formulario del chat; incluye foco atrapado,
  Escape, bloqueo de scroll y atajo Alt+Espacio. Sin reescritura automática de intención.
- `speech/server.py`, `speech/requirements.txt`, `Dockerfile.speech` y servicio
  Compose `speech`: faster-whisper **1.2.1**, modelo Systran/faster-whisper-small
  con revisión **536b0662742c02347bc0e980a01041f333bce120** incluido en la imagen.
  CPU int8 con 2 hilos, límite 1.5 CPU / 2 GB / 96 PIDs, FS de solo lectura,
  tmpfs de 64 MB y solo red interna. Sin montajes de proyectos o credenciales.
  Modelo listo en healthcheck; sin descarga durante una petición.
- Audio privado en memoria: decodificación acotada con PyAV, VAD y sin guardar
  audio/transcripción en el servidor de voz. Rechaza formato/tamaño/duración
  inválidos. El servicio solo acepta una inferencia simultánea.
- `cm/speech.py`: proxy autenticado `GET /api/voice`, `POST /api/voice/transcribe`,
  protegido por Origin; limita audio y fija la URL interna. El audio no sale a
  proveedores externos. Reintento explícito si falta red o el motor está ocupado.
- `cm/lifecycle.py`, `bin/cm-project-delete.py`, `frontend/src/ProjectDelete.jsx`:
  eliminar desde tarjeta o workspace (Más en móvil), confirmación escribiendo el
  nombre exacto, bloqueo con agentes/jobs activos y protección del propio panel.
  Se reserva la operación, se cancelan solo pendientes de ese proyecto y se limpian
  sesiones de conversación/reglas Siempre para no heredarlas al reutilizar el nombre.
  Las reglas anteriores y tareas quedan en metadatos de recuperación.
- El trabajo de eliminación corre en el host y sobrevive a reinicios del panel.
  Comprueba pertenencia antes de parar/retirar contenedores y redes Compose vacías;
  no ejecuta código Compose del proyecto, no toca `proxy`, imágenes ni volúmenes.
  Cierra solo terminales conocidas y mueve la carpeta a `.cm-trash/<job-id>/project`.
  Los nombres internos de tmux están reservados. El planificador y la API no
  aceptan nuevo trabajo para un proyecto que se está eliminando.
- `GET /api/projects/delete-preview`, `GET /api/projects/trash`, acciones `delete`
  y `restore` de `POST /api/projects`. Ajustes muestra la papelera. Restaurar no
  despliega ni reanuda tareas antiguas. El archivo se conserva sin purga automática.
- Pruebas añadidas: `tests/test_lifecycle.py`, `tests/test_speech.py`, HTTP de borrado
  y `frontend/tests/voice.test.mjs`. **77 Python + 5 Node OK**.
  `tools/verify_voice_browser.cjs` recorre captura real con audio de prueba,
  transcripción HTTPS, fallo de red, envío interceptado para no crear trabajo de IA,
  eliminación de contenedor real y restauración de un archivo marcador.
- La última ejecución completa terminó con `VOICE_BROWSER_OK` y
  `WEBKIT_VOICE_UI_OK`. Ambas imágenes y el endpoint de voz se comprobaron en vivo:
  `voice_ready=true`, proyecto temporal ausente y dashboard protegido. Los permisos
  originales siguen `claude_permission=ask` / `codex_sandbox=full`.
- `tools/archive_voice_validation.py` archivó únicamente papelera/jobs/operación
  de `cm-voice-check-20261017`. No quedan sus contenedores, carpeta ni entradas de
  papelera de prueba en la interfaz. Las capturas pertenecen a dv1 y los logs del
  dashboard están limpios. No se reinició Docker, Traefik ni proyectos ajenos.
- WebKit headless requirió mock de `navigator.mediaDevices` completo para probar
  permiso denegado: reemplazar solo el método no es fiable en ese entorno.
- Instalado `espeak-ng` para generar la muestra sintética de prueba; no se usa en
  producción. Capturas y audio: `artifacts/voice-20261017/` (excluidos de Git/Docker).
- Respaldos de código/imagen previos a voz y archivo recuperable de las pruebas
  indicados en sección 6. README documenta uso, límites, privacidad y papelera.

### Arquitectura y host

- Backend aiohttp en `app.py` + `cm/`; React 19/Vite 8 en `frontend/`.
- Cada tarea se ejecuta en el host mediante `bin/cm-runner.py`, en `cmr-<id>`.
  Escribe `events.jsonl`, `stderr.log`, `pid.json` y `exit.json`. Los jobs usan
  `cmj-<id>` y `output.log`. El runner escala SIGINT → SIGTERM → SIGKILL al detener.
- `deploy/codex-tmux.service` y `bin/cm-tmux-keepalive` instalados y activos.
  Una reconstrucción del dashboard no termina las sesiones del host.
- Planificador por eventos y reconciliación cada 2 s; una tarea por proyecto/agente,
  todas las combinaciones libres se despachan en la misma vuelta. Recupera tareas
  antiguas y procesos perdidos, aplica timeout y reconcilia también jobs perdidos.
- Sesiones persistentes de Claude/Codex; actualizaciones de sesiones y reglas
  protegidas contra escrituras simultáneas. No se reinicia contexto con tarea activa.
- Claude pide explícitamente permiso para Bash/web/Agent/Skill aun si su modo
  acceptEdits habría permitido un comando habitual. El modo solo ediciones excluye
  herramientas de comandos y los MCP externos. Nunca se usa bypass de Claude.
- Las reglas Siempre recuerdan el comando COMPLETO o dominio WebFetch, por proyecto.
  No recuerdan intérpretes, comandos peligrosos ni operadores de shell. Se rechazan
  aprobaciones duplicadas, posteriores al cierre o a una petición de detención.

### Correcciones y mejoras de esta sesión

- Frontend compilado; Docker corregido: Node Debian para los binarios GNU del
  lockfile y `COPY --chown=1002:1002` para evitar archivos privados ilegibles al
  usuario del contenedor. Se comprobó importar `app` desde la imagen sin volúmenes.
- Editor con token de versión de texto (mtime/ctime/inodo/tamaño): evita la pérdida
  de precisión de JavaScript y detecta incluso guardados atómicos con igual fecha.
  Los archivos recortados por tamaño son de solo lectura.
- Cargas con límite durante la lectura, nombres exclusivos sin sobrescritura ni
  seguimiento de enlaces rotos. Se distingue la raíz del explorador del directorio
  de adjuntos `.codex-manager/uploads`. Borrar un enlace interno conserva su destino.
- Scaffolds web y node con healthcheck en Dockerfile y Compose, commit inicial
  comprobado, identidad Git local de respaldo y publicación de `public/` exclusivamente.
- Jobs del dashboard protegidos contra `compose down` del propio panel.
- Historial de errores de cuota de Claude localizado y con fecha de reposición.
- Logout limpia el estado cacheado; no se muestra durante la comprobación de sesión.
  El polling evita llamadas solapadas y la API responde no-store / 404 apropiados.
- Miniaturas de imágenes adjuntas en el compositor y en el historial.
- Corregidas colisiones CSS entre el contenedor y los mensajes del agente, y entre
  las ejecuciones del chat y el botón Desplegar. Revisado con capturas en móvil.
- **Web Push completo:** `cm/push.py`, clave VAPID y suscripciones privadas en `/config`,
  entrega independiente de la cola, deduplicación, reintentos y baja de endpoints
  vencidos. Solo se admiten endpoints HTTPS de proveedores push reconocidos.
  API `GET|POST /api/push`, activar/desactivar por dispositivo en Ajustes y receptor
  push/notificationclick en `sw.js` v3. Dependencia fijada `pywebpush==2.5.0`.
- README reemplazado por instrucciones del sistema actual.

### Evidencia de pruebas

- `docker run --rm -v /srv/projects/codex-dashboard:/src:ro -w /src codex-dashboard-dashboard python -m unittest discover -s tests`:
  **64 pruebas OK** (`test_core.py`, `test_http.py`, `test_host.py`, `test_push.py`).
  Cubren TSV nuevo/antiguo, eventos, cola, recuperación/timeouts, permisos, procesos
  reales MCP/runner, archivos, rutas, auth, HTTP, Docker y notificaciones.
- Host: Codex en solo lectura respondió y reanudó recordando `CM_RESUME_742`.
  Claude conectó MCP, pero respondió error de cupo hasta 14:50 Berlín.
- HTTPS real: login/cookie, estado, crear proyecto, job de despliegue y certificado,
  leer/escribir archivos, estado/diff/commit Git y terminal WS con salida real.
- Codex desde la web: dos mensajes con continuidad `CM_WEB_185`; detener/reintentar
  una tarea real comprobado dos veces.
- MCP real conectado a la API publicada: Permitir, Siempre (sin segunda solicitud)
  y Denegar comprobados. Prueba sintética del protocolo, sin invocar modelo Claude.
- Playwright 1.55.0/Chromium: móvil 390 y 360 px, escritorio 1440 px, rutas y paneles,
  guardado en CodeMirror, terminal, receptor push mediante CDP con notificación real,
  service worker y recarga offline; sin errores de aplicación detectados.
- Capturas: `artifacts/validation-20261017/` (excluido de Git/Docker). Pertenecen a dv1.
- `docker compose ps`: healthy; `/health` HTTPS devuelve 200; logs del dashboard limpios.
- Proyecto temporal apagado con compose down y ARCHIVADO, no borrado permanentemente.
  Sus tareas se retiraron de la cola por API; runs/jobs/reglas/terminales de prueba
  se limpiaron sin tocar otros proyectos.

## 6. Rutas, respaldos y operación

- Respaldo anterior al dictado: `/srv/platform/backups/codex-dashboard-before-voice-20261017.tgz`
  e imagen `codex-dashboard:before-voice-20261017`.
- Evidencias de la sesión de voz: `/srv/platform/backups/codex-dashboard-voice-validation-20261017/`.
- Papelera de usuarios: `/srv/projects/.cm-trash/` (no purgar automáticamente).
  Operaciones: `/home/dv1/.config/codex-automation/project-operations/`.
- Para desplegar ambos servicios: `docker compose build` y
  `docker compose up -d --wait --wait-timeout 90` (speech necesita cargar el modelo).
  El dashboard conserva sus límites y el sistema de agentes anterior.

- Código: `/srv/projects/codex-dashboard` (no es un repositorio Git).
- Datos: `/home/dv1/.config/codex-automation/` ↔ `/config`.
- Proyectos: `/srv/projects` ↔ `/projects`.
- tmux: `/tmp/tmux-1002/default` ↔ `/tmux/default`; keepalive `cm-keepalive`.
  `<proyecto>` = Codex interactivo; `<proyecto>-claude`, `<proyecto>-shell`.
- CLIs verificadas: Claude Code 2.1.302 y codex-cli **0.163.0**, en `~/.local/bin`.
  Codex autenticado con ChatGPT; no imprimir archivos de credenciales.
- Backups originales del agente anterior:
  `/srv/platform/backups/codex-dashboard-original-20261017.tgz` y
  `/srv/platform/backups/codex-dashboard-tasks-20261017.tsv`.
- Antes de esta sesión:
  `/srv/platform/backups/codex-dashboard-before-completion-20261017.tgz`,
  `/srv/platform/backups/codex-dashboard-tasks-before-completion-20261017.tsv`,
  imagen `codex-dashboard:rollback-20261017`.
- Evidencias y proyecto de prueba recuperable:
  `/srv/platform/backups/codex-dashboard-validation-20261017/`.
  Incluye `cm-smoke-20261017/`, `test-tasks.json`, `web-runs/`, `web-jobs/` y
  las ejecuciones directas del host en `runs/`.
- Recompilar: `docker compose build`; probar imagen y suite; después
  `docker compose up -d --wait --wait-timeout 40`. No reiniciar Traefik ni Docker global.
- No borrar `.cm-secret`, `.push-vapid.pem` ni suscripciones al reconstruir.

Referencias de integración consultadas:
[Codex no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode),
[permisos Claude](https://code.claude.com/docs/en/permissions),
[pywebpush](https://github.com/web-push-libs/pywebpush).
