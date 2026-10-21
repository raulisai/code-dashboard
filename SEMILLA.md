# SEMILLA — estado del trabajo en codex-dashboard

Actualización: 21 de octubre de 2026. Claude: Wear OS 0.3 con interfaz minimalista (agente general primero, cuota y avisos, gesto de deslizar para volver); sin commit, backend y reloj físico pendientes.

Actualización anterior: 20 de octubre de 2026, America/Mexico_City. Codex: Wear OS 0.2 ampliado con Inicio, Proyectos, Configuración y herramientas nativas; backend y Firebase pendientes de activación.

> Leer antes de trabajar. Actualizar las secciones 0, 4 y 5 al terminar.

Última actualización anterior: 2026-10-18, Europe/Berlin. Autor: Claude (agente general: respuestas breves por voz y texto solo bajo demanda).

Última actualización: 2026-10-18, 08:50 Europe/Berlin. Autor: Claude (agente general: interfaz viva y más animaciones).

## 0. Estado en una línea

**Wear OS 0.3: interfaz minimalista y gesto de volver (21 octubre, Claude).** Pedido del
usuario: lo primero que muestra el reloj es el agente principal (hablar + estado de sus agentes
de código: cuánto tienen y últimas notificaciones), todo muy visual, con iconos, y con el gesto
nativo de Wear OS (deslizar de izquierda a derecha) para volver. Hecho en la rama
`claude/waros-ui-minimalist-redesign-784ff3` (parte de la punta de `Wear-OS`; **sin commit ni
push**, el usuario no lo ha pedido). Primera pantalla = esfera (tocar = hablar) + estado real +
dos anillos de cuota (Claude y Codex, ventana de 5 h) + el aviso más reciente o la última
respuesta; al desplazar: avisos, cuatro iconos (Proyectos, Aprobaciones, Servidor, Ajustes) y
atajos. **Todas** las pantallas, incluidas las herramientas y la revisión de una acción, se
cierran deslizando a la derecha viendo la pantalla anterior bajo el dedo; la tecla Atrás hace
lo mismo. Esto sustituye la decisión de 0.2 de abrir en un Inicio-dashboard. Backend:
`view=home` añade `recent` y `approvals` (aditivo). APK **0.3.0** probada en el emulador e
**instalada en el Watch 7 físico** (SM-L300, `install -r`, datos conservados; confirmado
versionCode 3 y la app abre sin fallos). El backend del reloj sigue sin desplegar, así que
sigue sin vincular y sin verse con datos reales.

**Bloqueo de vinculación confirmado por HTTPS (21 octubre):** `/health` devuelve 200,
pero `POST /api/wear/pair/start` devuelve 401 «Sesión expirada: inicia sesión de nuevo».
Está pasando por la autenticación web anterior, en vez de la ruta pública de vinculación.
Hace falta desplegar el backend/frontend de Wear-OS; copiar Firebase no publica ese código.

**Watch 7 físico: app 0.2 instalada y abierta (21 octubre, Codex).** El usuario autorizó
comenzar las pruebas físicas. ADB por Wi-Fi identificó SM-L300/API 36; instalación del APK
`codex-watch-dashboard-0.2.0.apk` completada con Success y MainActivity abrió correctamente.
Se vio la pantalla «Preparando vínculo…». Vinculación con MFA y entrega FCM todavía no
verificadas. La conexión ADB quedó offline después; no se cambiaron ajustes de batería,
seguridad ni se borraron datos. Credenciales Firebase locales preparadas fuera del repo;
el usuario informó que su agente del VPS las está instalando.

**Wear-OS publicado y homologación automática activa (20 octubre, Codex).** La rama
`Wear-OS` contiene el código del reloj, mantiene seguimiento de `origin/Wear-OS` y recibe
merges de `main` mediante GitHub Actions después de cada push y cada hora. La primera
ejecución real completó merge, pruebas de backend y push. `main` recibe solo workflow y
guía de activación; todavía no integra la app del reloj ni despliega el VPS. Instrucciones
para agente del servidor y administrador: `deploy/WEAR-OS-ACTIVACION.md` (también en main).

**Wear OS 0.2: ampliación local del dashboard (20 octubre, Codex).** Inicio ahora muestra
cuota Claude y trabajo actual; Proyectos permite explorar y abrir chats/agentes, peticiones,
logs, terminal, archivos, Git, despliegues y contenedores. Configuración y aprobaciones
nativas. El agente general conserva esfera, voz y continuidad. Acciones revisadas y
confirmadas, API específica con las validaciones existentes y mensajes idempotentes por
proyecto/chat. Esta ampliación sustituye la decisión anterior de mostrar solo el agente
al entrar. Sigue sin despliegue VPS, Firebase real ni pruebas sobre el Watch 7 físico.
Ver `wear/README.md` para alcance y límites; la web del proyecto, adjuntos binarios y
credenciales de cuenta no se trasladan a la interfaz del reloj.

**Wear OS / Galaxy Watch 7: MVP implementado localmente en `codex/wear-general-agent` (20 octubre, Codex).**
Cliente Kotlin/Compose en `wear/`, con una sola entrada al mismo agente `_general/main`:
esfera, dictado del sistema con revisión, texto, respuestas breves y accesos para preguntar
por la última tarea o los proyectos. Vinculación web con MFA, sesión revocable y limitada a
la API del reloj, borrador/caché cifrados e idempotencia de envíos. FCM directo opcional;
avisos inicialmente solo de atención. **No se desplegó en el VPS ni se instaló en el reloj
físico.** El usuario pidió dejar la configuración documentada y probar primero en un
emulador de este equipo. Guía: `wear/README.md`; plantilla: `deploy/firebase-watch-client.example.json`.

**Proyecto subido a GitHub (20 octubre, Codex):** repositorio público indicado por
el usuario: https://github.com/raulisai/code-dashboard. Rama `main` publicada con
historial completo y seguimiento `origin/main`. `origin` usa HTTPS para lectura y
SSH para push con la llave existente de `raulisai`. Configuración privada, `.env`,
dependencias y artefactos permanecen fuera de Git. No se modificó la app desplegada.


**Agente general: interfaz viva y más animaciones (18 octubre, Claude). Publicado.**
La esfera tiene 21 formas con color y animación propios según la acción real: escribir código →
líneas con cursor que teclea; terminal → «>_» que escribe y suben líneas de salida; base de datos
(psql, mysql, sqlite3, redis-cli, SQL…) → cilindro con banda de consulta; revisar servidor → pulso
de electrocardiograma; leer → página con haz; buscar en código → radar; web → globo; compilar →
engrane; git → hélice; pruebas → anillo con cometa; subagentes → racimo; pensando → red neuronal
con sinapsis; respondiendo → ondas; gráfica → barras ecualizador; tabla → rejilla; imagen → marco
que se revela; cola → reloj de arena; permiso → escudo; error → se agrieta. Onda de color al
terminar cada paso. Arriba, el plan del agente («1/3 Desplegando»). Bajo la esfera, la **vista en
vivo**: tarjetas ```cm-ui que se actualizan en sitio por `id` (barras/línea/área/dona, tabla, cifras
con contador y tendencia, progreso con pasos, imagen, código, HTML, archivo), esqueleto mientras se
escriben y «Resultado» al terminar (X para ocultar). Imágenes del agente en `/srv/projects/.cm-media/`
→ `/api/media/<nombre>` con sesión. En celular horizontal, esfera y vista van lado a lado.

**Agente general: respuestas breves y habladas, texto solo si se pide (18 octubre, Claude). Publicado.**
El prompt (`GENERAL_PRESENTATION_GUIDE` + `general_prompt()` en `cm/runs.py`, también llega a
Codex reanudado) pide 1–3 frases cortas (~40 palabras), resultado y no proceso, sin listas
salvo que pida detalle. Al terminar lo pedido ya **no se abre** el panel «Tu respuesta»: se lee
en voz alta (también si se escribió; `speakable` recorta a 420 caracteres) y bajo el estado
aparece un botón pequeño «Ver texto». Con la voz apagada el estado dice «Respuesta lista».
Arreglado de paso: `Quota.jsx` rompía Inicio si `/api/quota` venía incompleto.

**Cupo de Claude y Codex en Inicio y Ajustes (18 octubre, Claude). Publicado.** Tomado de
`raulisai/utilizetokens`: `bin/cm-quota.py` (host, vía tmux como `cm-repo.py`) lee Claude con el
token OAuth del CLI → `api.anthropic.com/api/oauth/usage` y Codex con `codex app-server --stdio`
(`account/rateLimits/read`). `cm/quota.py` cachea 2 min; `GET /api/quota[?refresh=1]`.
UI `Quota.jsx`: barras de 5 h y semanal por agente, «% libre», reinicio, créditos y «Ahora conviene X».
**172 Python + 19 Node OK**; lectura real desde el contenedor (Codex 5 h al 100 %, Claude 61 %).

**Agente general: entrada animada y partículas por acción (18 octubre, Claude).**
Al entrar, la esfera de la barra inferior crece hacia el centro y en su hueco aparece
girando el botón «+» de opciones (solo celular; en escritorio sigue bajo la esfera).
La esfera cambia de forma con la actividad real: web → globo de meridianos con banda
de escaneo, revisar código → átomo/radar, Docker/paquetes/compilar → cubo, Git →
doble hélice, pruebas → anillo que gira rápido, editar → disco con ondas, subagentes →
tres esferas; pensando → remolino; reposo → esfera. Transición suave y destello al
cambiar. Publicado; pruebas en sección 5.

**Agente general: ejecución en vivo arriba y controles plegados (18 octubre, Claude).**
Pedido a Codex, que falló por cupo; lo hizo Claude. Mientras trabaja, bajo la
cabecera aparecen en texto translúcido (sin caja) los últimos 3 comandos tal cual
(`git push origin preproduccion`, `npm test`…), con icono de tipo, ✓/✗/anillo y
duración, más la última frase del agente; tocarlo abre Actividad. En reposo no se
muestra nada. Hablar/Escribir/Actividad/Respuesta/Detener quedan dentro de un botón
«+» de 46 px que se despliega encima (se cierra al elegir, tocar fuera o Escape) y
lleva un punto si hay trabajo o conversación de voz. Publicado; pruebas en sección 5.

**Cabecera del proyecto sin botón verde «Desplegar» (18 octubre, Claude).** Lo pidió
el usuario; Codex falló por límite de uso y Claude lo reintentó. Desplegar sigue en
la herramienta «Desplegar» (barra lateral en escritorio, «Más» en el celular) y en
«Desplegar ahora» de Vista previa. Publicado; `WS_HEADER_OK` 360/390/1440 en la URL real.

**Agente general «vivo» terminado y publicado (18 octubre, Claude).** Codex lo
implementó pero agotó su cupo verificando (run `20261017-221813-a55e72`, commit
`245bd05` «con error»); sus cambios quedaron repartidos en commits de otros chats
(`6427c04`, `4ebeba7`). En reposo solo esfera + icono + «Disponible»; el icono y
la frase cambian con la actividad real (pruebas, Docker, Git, edición, web…).
Sin saludos ni datos fijos: Actividad, Respuesta e historial se abren bajo
demanda y conservan el formato. Cerrado por Claude: foco devuelto al cerrar los
diálogos, historial anclado arriba con teclado en tableta/escritorio y prueba de
voz adaptada al nuevo botón «Terminar». **168 Python + 15 frontend OK**,
`GENERAL_KEYBOARD_OK` (390/360/1440) y `GENERAL_BROWSER_OK` (320/360/390/768/
1440 y horizontal 740×390) con API simulada. Producción: healthy, HTTPS 200,
API anónima 401, Origin ajeno 403.

**Chat de proyecto compacto (18 octubre, Codex):** cabecera de 44 px con nombre
y menú «…» para chats/proveedor/reinicio; micrófono de solo icono y modelo/esfuerzo
en la misma fila inferior. Mantiene texto legible, dictado, adjuntos y autosize.
Publicado con Compose; dashboard/speech healthy, HTTPS 200 y API anónima 401.

**Proyectos compacto publicado (18 octubre):** miniatura de 64 px, estado de
contenedores, servicios activos, agentes trabajando/cola y siete herramientas
visibles con ayudas breves. Selector de aplicación + flechas reemplazan la gran
ilustración y los puntos. Móvil apilado y escritorio en dos columnas. Mejoras
responsive en Cola, Servidor, Ajustes, Crear y cabecera del workspace. Estado
Detenida/Parcialmente activa también en workspace. Ver pruebas en sección 5.

**Input del chat corregido (18 octubre, Codex):** la altura se recalcula con el
texto y al activar la vista; vuelve a una línea después de enviar o borrar, y
se adapta también al dictado y borradores. Publicado con Compose; HTTPS 200.

**IU móvil refinada y publicada:** barra inferior de 81 a 60 px (≈25 % menos),
iconos de 18 px, esfera elevada, cristal transparente con desenfoque y selección
visible. Objetivos táctiles ≥44 px, acceso de teclado al contenido, estado de
navegación accesible y respeto de movimiento/transparencia reducidos.


**Agente general ampliado, publicado y verificado:** esfera de puntos 3D compartida con navegación,
voz rápida con texto provisional cuando el navegador lo admite, turnos automáticos
hablar/responder/escuchar y respaldo local rápido/preciso. Ya no espera tres
segundos para enviar. Enrutamiento automático entre Claude/Codex ante límites,
autenticación o disponibilidad, con continuidad y máximo dos intentos por mensaje.
Presentaciones `cm-ui`: gráficos interactivos, tablas, HTML/SVG aislado y archivos.
**168 Python + 14 frontend OK**. Ver detalle, límites y evidencias más abajo.

**Selector inferior de modelo y esfuerzo publicado:** reemplaza el input libre. En el
compositor de los chats de proyecto, «Escoger modelo» abre panel con modelos y
niveles compatibles, sin escritura de IDs. El agente general permanece sin selector.
Catálogo saneado de los CLI: 7 modelos visibles Codex y 13 opciones Claude;
actualización cada hora con timer. Modelo/esfuerzo por mensaje y por chat/agente,
conserva sesión y aplica flags reales. **162 Python + 11 frontend OK**.

**Selector de modelo por chat de proyecto publicado:** Proyecto → Agente muestra modelo
por proveedor, con sugerencias y texto libre, y vuelta a Predeterminado. No se
muestra en el agente general. Se recuerda en navegador por chat/proveedor y se
guarda con cada mensaje, sin alterar tareas anteriores ni los ajustes globales.
**160 Python + 11 frontend OK**; build Vite correcto.

**Refinado del agente general publicado:** esfera compartida `Orb.jsx` en barra y vista
ampliada, ondas/partículas/órbitas, viaje y cambios de tamaño suaves. Sin selector
Claude/Codex en esta vista ni en su historial: usa el proveedor predeterminado
de Ajustes. Conversación con historial propio y respuesta directa, borradores
persistentes y recuperación de envíos fallidos. Transcripción abortada al salir.

**Última sesión (Claude): la esfera central es ahora el agente general. Publicado.**
El botón del centro de la barra abre `/agent`: la esfera viaja desde la barra al
centro y crece. Vista como las imágenes del usuario: pastilla «Codex | Claude», «…»,
titular de lo que hace («Ejecutando pruebas»), proyecto detectado y subtítulo;
«Actividad en tiempo real» con iconos por tipo (git, docker, pruebas, web…),
comando, detalle y duración; esfera viva animada según el estado. Tocar la esfera
= hablar (Whisper local, corta tras 1,8 s de silencio; el texto se envía solo a los
3 s salvo Editar/Cancelar) y la respuesta se lee en voz alta. El agente corre en
`/srv/projects` (pseudo-proyecto `_general`) con el catálogo de proyectos en el
prompt, administra el servidor y deduce a qué proyecto te refieres. **Crear
proyectos queda solo en Proyectos → «Nuevo proyecto»** (`/new` sigue existiendo).
**156 Python + 11 Node OK**, `GENERAL_BROWSER_OK` (360/390/1440) contra la URL real
y prueba real: Claude respondió desde `/srv/projects` con el catálogo.

**Última sesión (Claude): crear proyectos desde un repo Git y opción de repo en
GitHub. Publicado.** En Crear hay «Nuevo desde cero | Desde un repo Git». Importar
valida la URL en vivo (ls-remote en el host con la llave SSH de `raulisai`), deja
elegir rama, clona con historial y el agente lo adapta y publica. En nuevos, la
opción «Crear también el repositorio en GitHub (privado)» viene marcada cuando
GitHub está conectado en Ajustes → GitHub. **Falta que el usuario pegue un token
de GitHub** (no hay `gh` ni token en el VPS): sin él la opción sale desactivada y
el proyecto solo tiene repo local. **150 Python + 5 Node OK**, `REPO_CREATE_BROWSER_OK`
y `CHAT_DELETE_BROWSER_OK` contra la URL real; validación e importación reales.

**Última sesión (Claude): Git convertido en versionador, publicado.** Cada acción
es un commit propio (respuesta de agente, editor, archivos, subidas, despliegue),
con «Deshacer último cambio» (rollback rápido repetible), restaurar cualquier
versión, deshacer solo un cambio, comparar, ramas como alternativas (crear desde
cualquier versión, ver, cambiar, integrar, eliminar archivando) y opción «… y
publicar». Chip «Versión xxx guardada · Ver · Deshacer estos cambios» bajo cada
respuesta del chat. Ajuste Ajustes → Versiones (Git), activo por defecto.
**139 Python + 5 Node OK**; `VERSIONS_BROWSER_OK` en Chromium 360/390/768/1440
contra una instancia aislada con Git real. Producción: ambos servicios healthy,
HTTPS 200, API anónima 401, Origin ajeno 403. **Este proyecto ya es un repositorio
Git** (`main`; base `12eb60d`, versionador `286a2f9`). Ya funciona en real: la
petición `20261017-185758-d709ad` generó sola «Cambios pendientes antes de Claude».

**Última sesión (Claude): borrar chats y cambiar Claude ⇄ Codex sin perder el hilo.
Publicado.** Papelera en Agente → Chat: elimina chats adicionales (cancela su cola,
no toca archivos) y en el principal lo **vacía**. Claude y Codex **comparten el
contexto de cada chat**: al cambiar, el agente recibe un resumen de las peticiones
del chat que no vio; un mensaje a la vez por chat aunque cambie de agente.
**138 Python OK** en el árbol combinado (122 en la imagen publicada) y
`CHAT_DELETE_BROWSER_OK` en Chromium 360/390/768/1440 contra la URL real con API
simulada. **Ojo:** la imagen publicada se construyó desde HEAD + este parche (en
`/tmp/cm-deploy`, ya borrado), **sin** el versionador que otro agente Claude estaba
terminando en paralelo. El árbol de trabajo tiene ambos; el próximo
`docker compose up -d --build` desde el proyecto publicará los dos juntos.
**Resuelto a las 20:52:** se publicaron juntos (commit `286a2f9`).

**Nueva decisión: servidor autónomo, sin confirmaciones rutinarias.** El usuario
prioriza versiones, respaldo y recuperación. Claude configurado en `auto` sin
prompts interactivos; Codex sigue en `full`. Afecta a nuevas ejecuciones, no se
interrumpieron agentes ya activos. AGENTS.md registra esta autorización.
Respaldo diario instalado (timer systemd) y primera copia completa verificada:
`/srv/platform/backups/codex-dashboard-auto/`, retención de 14 copias completas.

**Última sesión: revisión de seguridad y reparación de terminal publicadas.**
Se corrigió el destino de pane tmux en historial (`=session:`), se añadió salida
al directo y reconexión automática/manual con errores visibles. Se reforzaron
Origin, CSP, límites HTTP/WebSocket/PTY, subida, push, Git, plantillas y voz;
contenedores con raíz de solo lectura, sin capabilities y registros limitados.
**116 pruebas Python + 5 Node aprobadas** y verificaciones reales aisladas de
TOTP, terminal, plantilla y audio. Producción: ambos servicios healthy, HTTPS
200, API anónima 401 y Origin ajeno 403; conexión pasiva al shell real correcta.
**El autenticador real ya está activado**, comprobado solo mediante su estado;
no se leyó ni sustituyó el secreto. Sesiones recordadas: 180 días.
No es una garantía de invulnerabilidad: persisten alertas Debian sin versión
corregida informada y el panel conserva privilegios administrativos por diseño.
Informe: `SEGURIDAD.md`; evidencia: `artifacts/security-20261017/`.

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
**Estado histórico a las 19:05:** faltaba vincular TOTP. La revisión posterior
confirmó que ya está activado. Conservar los códigos de recuperación en privado.
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

- Claude: decisión actual del usuario: autonomía sin confirmaciones rutinarias.
  Se cambió de `ask` a `auto` (clasificador, sin prompts interactivos); no se usa
  `bypassPermissions`. Codex conserva `full`. La anterior preferencia `ask` queda
  sustituida. El clasificador aún puede rechazar una operación; no implica una
  solicitud humana automática.
- Codex: conservar acceso completo, equivalente a `codex --yolo`.
- Está autorizado e instalado el servicio systemd que mantiene tmux en el host.
- Para pruebas acotadas: Claude con aprobación web o sin herramientas;
  Codex con `read-only`. No lanzar agentes con bypass para sortear restricciones.
- No modificar la cuenta de recuperación `rootai` ni su SSH.
- Autenticación web: el usuario eligió **contraseña + app autenticadora TOTP** y
  recordar dispositivos hasta seis meses. Mantener el segundo factor obligatorio,
  las sesiones revocables y los códigos de recuperación. No habilitar Basic Auth
  ni vincular automáticamente un autenticador de pruebas a su cuenta real.
- Versiones: el usuario quiere **un commit por cada acción**, ver ramas como
  alternativas y volver a cualquier versión con rollback rápido. Mantener
  `auto_commit=on` por defecto y **no reescribir historial**: restaurar/deshacer
  crean commits nuevos; nada de `reset --hard`, force ni borrar ramas sin archivar.

- Navegación: la **esfera central de la barra es el agente general** (`/agent`).
  Crear proyectos se hace **solo** con el botón «Nuevo proyecto» de Proyectos; no
  volver a poner `/new` en la barra.

## 4. Pendientes y límites de validación

### Wear OS 0.3 — interfaz minimalista (21 octubre, Claude)

- **Instalada en el Watch 7 físico (21 octubre, 05:06)** a petición del usuario, solo con
  `adb -s 192.168.1.74:34563 install -r` (SM-L300; 0.2.0 → 0.3.0, mismo firmante, datos
  intactos). Tras instalar se abrió la app (arranque en frío correcto, sin fallos en logcat).
  **Todavía nadie la ha visto en la pantalla del reloj**: al capturar estaba cargando al 8 %
  y la pantalla de carga de Samsung tapaba la app. Verla con datos reales exige desplegar el
  backend y vincular. Antes de eso solo se probó en el emulador 432×432 (216 dp), a 192 dp
  (`wm size 384x384`) y con texto al 130 %. El puerto de ADB por Wi-Fi cambia: descubrirlo con
  `adb mdns services` (había dos anuncios; solo respondió 34563) y reconectar si queda offline.
  Para el resto de pruebas usar siempre `-s` con el serial exacto.
- El backend nuevo (`recent`, `approvals`) debe desplegarse con el del reloj. Sin backend la
  primera pantalla muestra el estado vacío («Toca la esfera para hablar») y anillos en «–».
- Criterios míos, no del usuario, fáciles de cambiar en `Models.kt`: anillo verde ≥ 40 %
  libre, ámbar ≥ 15 %, coral por debajo; «5 horas» = ventana de ≤ 300 min, la otra es la
  semanal; «Ahora conviene X» = el agente con más cuota de 5 h libre. Mostrar solo: no hay
  aviso push cuando la cuota baja. Si el CLI de Codex no entrega ventanas, su anillo queda en «–».
- La edad de los avisos («hace 5 min») sale de `finished_at`, que el servidor escribe como
  texto en su propia hora local; `wear.stamp` lo interpreta con la zona del servidor. Las
  aprobaciones pendientes no tienen hora y se muestran como «ahora».
- El gesto de volver no se pudo medir con un dedo real, solo con toques inyectados (la captura
  a medio deslizamiento está inspeccionada). La primera pantalla deja el gesto al sistema, que
  sale de la app: es el comportamiento estándar, no un fallo.
- La 0.3 no cambia permisos, red ni almacenamiento: mismas rutas `/api/wear/*`, mismo
  token cifrado. Añade dos lecturas al reanudar la primera pantalla (`view=home` y cuota con
  su caché de 2 min). Falta medir su efecto en la batería real.
- Windows: las pruebas del backend suponen Linux (`fcntl`, `termios`). Esta sesión usó stubs
  fuera del repo y pasan las 21 de `test_wear`; fallan 4 pruebas ajenas de otros módulos
  (`test_http`, `test_push`, `test_auth_security`, `test_general`) por semántica de Windows
  (modo 0600, mtime, separadores), no por este cambio: repetir en Linux/CI antes de publicar.
- Compilar en Windows: Gradle bloquea `~/.gradle` si Android Studio está abierto → usar un
  `GRADLE_USER_HOME` propio (como hace `tools/build_wear.cmd`); en algunos shells
  `gradlew.bat` no se encuentra en el directorio actual, llamarlo con ruta absoluta.

### Bloqueo actual de vinculación — 21 octubre

- El Watch instalado muestra «Preparando vínculo» y «Actualiza el dashboard del servidor».
  Prueba HTTPS local confirmó 401 en POST `/api/wear/pair/start`; no es un fallo del JSON
  de Firebase. Desplegar rama Wear-OS, reconstruir solo dashboard y exigir HTTP 200 en
  ese POST sin sesión. Después generar otro código y autorizarlo en `/watch` con MFA.
- No alterar ni quitar autenticación global para resolverlo: las rutas start/poll ya están
  declaradas públicas y protegidas por secreto temporal/límites en el código de Wear-OS.

### Inicio de pruebas físicas — 21 octubre

- La prohibición anterior de instalar en el reloj físico terminó con la instrucción
  explícita del usuario de esta sesión. App 0.2 instalada en SM-L300/API 36.
- Abrir Codex y mantener el reloj despierto para generar código; autorizarlo en `/watch`
  con la sesión web/MFA del usuario. No se leyó ni sustituyó ninguna credencial web.
- Confirmar backend del reloj desplegado y archivos Firebase instalados por el agente
  del VPS; después comprobar una entrega FCM real y el permiso de notificaciones.
- ADB descubrió dos anuncios del mismo Watch; el puerto vigente conectó y el viejo rechazó
  la conexión. Descubrir de nuevo con `adb mdns services` si está offline; no asumir puerto
  estable ni ejecutar escrituras ADB sin serial de destino.

### Activación y mantenimiento de Wear-OS

- Seguir `deploy/WEAR-OS-ACTIVACION.md`: separa tareas del agente VPS y del administrador,
  las llaves PC→VPS y VPS→GitHub, las rutas privadas Firebase, despliegue y aceptación.
  La guía está publicada en ambas ramas. No poner privadas SSH en carpetas del proyecto.
- La sincronización se detiene ante conflictos o pruebas fallidas; mirar GitHub Actions
  y corregir conservando ambas ramas. No significa homologación funcional automática de
  nuevas pantallas/APIs ni despliegue automático. Mantener Actions y contents:write activos.
- GitHub quedó publicado por HTTPS con el gestor de credenciales existente. No se crearon
  llaves, tokens ni cuentas reales en esta sesión; SSH al VPS y Firebase siguen pendientes.

### Wear OS 0.2 — alcance y activación

- Debe desplegarse el backend 0.2 junto con el APK 0.2; el backend anterior no tiene
  `/api/wear/view` y `/api/wear/action`. La sesión sigue siendo revocable y no abre las
  rutas web con Bearer ni cookies del reloj. La vinculación web explica el acceso ampliado.
- El usuario pidió herramientas mayormente de consulta, con control explícito. Terminal
  es captura + comandos revisados (sin VT/WebSocket permanente). No hay WebView ni web
  del proyecto renderizada, archivos multimedia/adjuntos binarios ni tarjetas cm-ui.
  Credenciales GitHub y administración de TOTP/sesiones siguen en la web.
- Cambios distintos de mensajes de agente no se reintentan automáticamente. Si se pierde
  su respuesta, comprobar el estado antes de repetir. Los mensajes sí conservan ID y
  destino exactos en almacenamiento cifrado para reintentar sin duplicados.
- Pruebas de UI y backend usan datos aislados; aún falta integración contra el VPS,
  entrega FCM real, dictado del sistema y medición física de autonomía. Se respetó la
  instrucción de no instalar ni modificar el reloj físico conectado.

### Wear OS — activación pendiente por el usuario (20 octubre)

- Publicar el backend de esta rama antes de vincular el APK. Desde esta copia Windows
  no hay acceso SSH preparado al VPS; el usuario pidió documentación, sin proporcionar
  credenciales. No cambiar `rootai`, no sustituir TOTP y no alterar el proveedor por defecto.
  Antes del despliegue ejecutar el respaldo autorizado y conservar código pendiente e imagen.
- Firebase todavía no existe para esta app. Configurar en el VPS, con permisos `0600`,
  `/home/dv1/.config/codex-automation/wear-firebase-client.json` y
  `wear-firebase-service-account.json`. El primero contiene las cuatro opciones públicas;
  el segundo es privado y nunca se versiona ni se entrega al reloj. Variable opcional:
  `WEAR_FCM_CREDENTIALS=/config/wear-firebase-service-account.json`. Ver guía para los detalles.
- La conversación funciona sin Firebase una vez publicado el backend. No presentar los
  avisos directos como activados ni la recepción FCM como comprobada.
- Emulador local creado: Wear OS 6 / API 36, x86_64, circular 432×432, densidad 320,
  serial `emulator-5580`. AVD e imagen temporal bajo `artifacts/wear-avd` y
  `artifacts/wear-tooling`. No purgarlos si se quiere conservar este emulador.
- Pendiente tras publicar: vinculación con el usuario real, turno real del modelo desde el
  reloj, recepción FCM, dictado del sistema y medición de batería en el Watch 7 físico.
  Las pruebas de interfaz usan transporte simulado y no gastan cuota ni ejecutan proyectos.
- Windows bloqueó varios ejecutables y AAPT2 al escribir ZIP mapeados en F:. Se verificó
  compilar con Java de Android Studio, AAPT2 de Build Tools 36.0.0 y salida en C:/TEMP.
  `tools/build_wear.cmd` aplica este aislamiento; `tools/verify_wear_android.cmd` exige
  un serial de emulador y comprueba el resultado de instrumentación.

### GitHub publicado (20 octubre)

- Destino autorizado por el usuario: repo público `raulisai/code-dashboard`.
- La publicación inicial ya está hecha: `main` con historial completo, sin force.
- Para trabajar desde otra computadora: `git clone https://github.com/raulisai/code-dashboard.git`.
- Cambios futuros requieren commit y push; la publicación web sigue siendo un
  despliegue independiente. El token de GitHub del panel continúa desconectado;
  el push desde este VPS funciona mediante la llave SSH existente.


### Interfaz viva y más animaciones (18 octubre)

- Falta que el usuario lo pruebe en su celular con una tarea real (p. ej. «muéstrame en una
  gráfica en vivo el CPU de los contenedores»). Que el agente use tarjetas con `id` depende del
  modelo; la guía está en `GENERAL_PRESENTATION_GUIDE` (`cm/runs.py`).
- Rendimiento: 1250 partículas con efecto por forma; si va lento, bajar `count` en `Orb.jsx`.
- Cada forma dura al menos 1,4 s (`DWELL`) para que los pasos rápidos no parpadeen.
- Codex entrega mensajes completos (sin streaming): con Codex no hay esqueleto mientras escribe.
- Imágenes: solo nombres simples en `.cm-media` (png/jpg/gif/webp/svg/avif ≤ 15 MB, se borran a
  los 30 días), archivos de proyecto o data URI ≤ 90 KB. Máximo 8 tarjetas y 6 bloques por mensaje.
- Rollback: no quedó imagen previa etiquetada; volver con el versionador al commit `9ecd921` y
  `docker compose up -d --build`.

### Respuestas breves por voz (18 octubre)

- Falta que el usuario lo pruebe en su celular: en iOS la voz se desbloquea con el gesto de
  enviar o tocar la esfera; si el navegador no habla, queda «Respuesta lista» + «Ver texto».
- La brevedad depende del modelo: si sigue largo, endurecer el prompt o bajar `speakable`.
- El historial completo sigue en «Ver conversación» (arriba a la derecha) y en «+» → Respuesta.
- Rollback: imagen `codex-dashboard:before-brief-20261018`.

### Cupo de Claude y Codex (18 octubre)

- El endpoint de uso de Anthropic **no está documentado**: puede cambiar. Si falla, la UI
  muestra el error y conserva la última lectura. Solo funciona con sesión del CLI
  (`claude auth login`), no con `setup-token`. El token nunca se imprime ni se guarda.
- Codex solo informa con sesión ChatGPT; con API key se indica que se ve en la plataforma.
- No cambia solo de agente por cupo en este módulo (eso lo hace el agente general); solo informa.
- Rollback: imagen `codex-dashboard:before-quota-20261018`.

### Entrada animada + formas de partículas (18 octubre)

- Falta que el usuario lo vea en su celular (rendimiento con 1250 partículas y
  transiciones). Si va lento, bajar el número en `Orb.jsx` o la velocidad `MOTION`.
- Con movimiento reducido no hay animación: la forma cambia sin transición.

### Ejecución en vivo + controles plegados (18 octubre)

- Falta que el usuario lo vea en su celular con una tarea real (comandos largos se
  cortan con «…»; el comando completo está en Actividad).
- Pantallas bajas (≤600 px de alto) muestran solo 2 comandos y sin la frase; con el
  teclado abierto, solo el último comando y sin el botón «+».
- Otra petición concurrente (run `20261017-232832-cc594f`) guardó a mitad de trabajo
  estos cambios en su commit «Cambios pendientes antes de Codex» (`81ad0fd`); el resto
  va en el commit de esta petición. No se reescribió historia.

### Cabecera del proyecto (18 octubre)

- Decisión del usuario: **no volver a poner el botón verde «Desplegar» en la cabecera**
  del proyecto. Rollback: imagen `codex-dashboard:before-no-header-deploy-20261018`.

### Agente general «vivo» (cierre 18 octubre)

- Falta que el usuario lo pruebe en su celular (voz real, teclado real, giro).
  Las pruebas de navegador usan API simulada y micrófono virtual: no se enviaron
  tareas reales ni se gastó cuota. El aviso «Error 503» de las capturas lo provoca
  la prueba a propósito (recuperación de borrador), no es un fallo.
- La ejecución de Codex terminó con error de cupo; si se reintenta esa petición
  no hace falta repetir el trabajo: ya está completo y publicado.

### Chat ergonómico (18 octubre)

- Falta valorar comodidad con teclado y voz en el teléfono físico del usuario.
- Pruebas de navegador con API simulada: no consumen créditos ni alteran chats reales.
- Respaldo previo: `/srv/platform/backups/codex-dashboard-auto/20261017T221650.504518Z/`.

### Proyectos compacto y pantallas responsive (18 octubre)

- Falta valoración visual en el celular físico del usuario (Safari/iOS incluido).
- Estado En línea/Parcialmente activa/Detenida refleja contenedores; no se añade
  monitor HTTP de cada aplicación. No afirmar que todo contenedor activo responde.
- Validación de navegador con API y WebSocket simulados: no ejecuta comandos,
  despliegues, tareas de agentes ni cambios en proyectos reales. Capturas con fixtures.
- Respaldo completo previo: `/srv/platform/backups/codex-dashboard-auto/20261017T221109.239557Z/`.


### Input del chat (18 octubre)

- Pendiente valoración en el celular físico del usuario.
- Pruebas de navegador con API simulada, sin enviar tareas reales a agentes.
- Respaldo previo: `/srv/platform/backups/codex-dashboard-auto/20261017T220749.098076Z/`.

### Barra compacta Glass (18 octubre)

- Falta valoración del usuario en su celular físico, especialmente Safari/iOS.
- Navegador comprobado contra web publicada con API simulada: no se enviaron tareas
  ni se modificaron datos reales. Capturas con datos vacíos de prueba.
- Respaldo previo: `/srv/platform/backups/codex-dashboard-auto/20261017T220456.129498Z/`.


### Agente general: voz, continuidad y presentaciones

- Falta comprobar voz humana y comportamiento real de micrófono/TTS en el teléfono
  del usuario. Las pruebas de turnos usan reconocimiento/TTS simulado y micrófono
  virtual; no prueban exactitud humana ni latencia del proveedor de agentes.
- No es una API Realtime de audio bidireccional: la vía nativa da texto en vivo,
  pero local transcribe por frase y los CLI responden con su latencia normal.
  El reconocimiento del navegador puede usar su servicio externo; «local rápida»
  y «local precisa» procesan solo en el VPS. No se guardan grabaciones.
- Bajo carga, Whisper small tardó ~10–20 s para 4 s de voz sintética; tiny ~4–5 s
  inicialmente, con menor precisión. Se añadió control de confianza/repetición y
  opciones de motor. No afirmar instantaneidad ni calidad validada con el usuario.
- La disponibilidad se aprende de errores reales; no es un saldo de créditos.
  CONFIG/provider-availability.json: cuota/auth se recuerdan 15 min, temporales
  60 s, éxito limpia estado. Si ambos constan bloqueados, un nuevo mensaje puede
  volver a comprobarlos una vez cada uno. Nunca hay reintento indefinido.
- General conserva el mensaje y contexto al cambiar de conexión; los proyectos
  siguen con selección manual. Si hubo acciones parciales, se pide revisar estado
  y evitar repetir lo completado. No se reproducen automáticamente comandos sueltos.
- HTML de `cm-ui` es estático: scripts/red/formularios eliminados y sandbox sin
  permisos. Gráficos propios sí son interactivos. PDF abre fuera del iframe;
  se conservan X-Frame-Options DENY y CSP de los archivos originales.
- Respaldo previo de esta ampliación:
  `/srv/platform/backups/codex-dashboard-auto/20261017T214728.058667Z/`.

### Selector inferior de modelo y esfuerzo (sustituye el input anterior)

- Ya no se ofrecen IDs manuales ni sugerencias inventadas. Catálogo exportado por
  `tools/refresh_models.py` a CONFIG/model-catalog.json: Codex desde su caché de
  modelos visibles y Claude desde inicialización stream-json sin ejecutar turnos.
  Timer `codex-dashboard-models.timer` cada hora; fallos conservan catálogo anterior.
- No se garantiza cuota/disponibilidad futura; se muestran las opciones de los
  CLI instalados, no un catálogo remoto consultado en cada apertura. El selector
  reutiliza metadatos en memoria 60 segundos y respeta restricciones por modelo.
- No se probó inferencia real de cada modelo (sin gasto de cuota); se verificaron
  argumentos CLI, persistencia, validación y UI con modelos simulados. No usar
  credenciales o secretos como fixtures ni imprimir la respuesta cruda initialize.
- La cola añade `effort` en columna 16; filas anteriores siguen siendo válidas.
- Respaldo previo: `/srv/platform/backups/codex-dashboard-auto/20261017T213246.295446Z/`.

### Modelos por chat de proyecto

- El identificador debe estar disponible para la cuenta del proveedor: no se
  consulta catálogo remoto ni se lanzan modelos para validarlo. Las sugerencias
  incluyen alias Claude, modelo configurado e historial del chat. Se permite ID
  manual. Los errores de disponibilidad los informa el proveedor al ejecutar.
- Preferencia recordada por navegador/chat/proveedor; vacío usa Ajustes al iniciar
  la tarea. El cambio no reinicia conversación ni modifica ejecuciones anteriores.
- Cola TSV añade columna 15 `model`; lectores aceptan filas históricas sin ella.
- Respaldo previo: `/srv/platform/backups/codex-dashboard-auto/20261017T212744.180803Z/`.

### Refinado del agente general

- No se cambia el motor ni se añade un orquestador nuevo: sigue ejecutando las
  tareas del agente general con el proveedor predeterminado de Ajustes. Se oculta
  su identidad en la experiencia de conversación por petición del usuario.
- Las pruebas de voz usan micrófono sintético/transcripción simulada; experiencia
  física del celular y voces de iOS pendientes. No se ejecutaron tareas de modelos.
- Respaldo previo completo:
  `/srv/platform/backups/codex-dashboard-auto/20261017T211909.373039Z/`.
  Se conservan las limitaciones de seguridad y copias externas documentadas.

### Agente general / esfera central (sesión actual)

- **Pendiente del usuario:** probarlo en el celular (micrófono, voz en iOS, animación
  de la esfera) y decir si quiere ajustes de diseño. La prueba con voz usó un tono
  sintético con transcripción simulada; la transcripción real es la misma de Crear.
- La lectura en voz alta usa la voz del navegador (`speechSynthesis`, es-MX) y solo
  lee respuestas de mensajes dictados en esa pestaña; se apaga en «…».
- El agente general **no versiona** (la raíz `/srv/projects` no es repo; el prompt
  le pide commit en cada proyecto que cambie). Usa los mismos permisos del panel
  (Claude `auto`, Codex `full`): puede administrar todo el servidor.
- Un solo chat (`main`) para el agente general; «Conversación nueva» reinicia el
  contexto (el historial queda). La duración de Codex se mide en el navegador
  (Codex no manda horas); Claude usa las marcas de tiempo del stream.
- La prueba real dejó en su chat la petición «Prueba del agente general»
  (run `20261017-195541-a6940f`, sin herramientas).
- Rollback: imagen `codex-dashboard:before-general-agent-20261017`; parche y
  archivos nuevos en `/srv/platform/backups/codex-dashboard-before-general-agent-20261017/`.

### Crear desde repo Git / repo en GitHub (sesión actual)

- **Pendiente del usuario:** Ajustes → GitHub → pegar token (fine-grained con
  Administration: Read and write sobre todos sus repos, o clásico `repo`). No se
  ha probado la creación real en GitHub (sin token); la API está cubierta con mocks.
  El push inicial por SSH sí usa la llave real `id_ed25519_agent` (cuenta raulisai).
- Importar no despliega a ciegas un repo con código: encola al agente (prompt
  `projects.import_prompt`). Si el usuario apaga ese interruptor, solo se clona.
- Sin push automático posterior (política `CODEX_GIT_PUSH=0`). Si el usuario pide
  sincronizar con GitHub, sería una función nueva y explícita (botón «Subir»).
- Repos de otros servidores por https privados no funcionan (no hay credenciales);
  por SSH dependen de que la llave del VPS esté autorizada allí. `accept-new`
  acepta la huella SSH de un servidor nuevo la primera vez.
- Clonado con límite de 10 min y como máximo 2 operaciones simultáneas; un repo
  enorme podría superar el tiempo de la petición web (660 s en el navegador).
- Rollback: imagen `codex-dashboard:before-repo-import-20261017`; archivos y
  parche en `/srv/platform/backups/codex-dashboard-before-repo-import-20261017/`.

### Versionador Git (sesión actual)

- Publicado y probado con Git real en una instancia aislada; **falta que el
  usuario lo pruebe en su celular** (Más → Versiones). No se hicieron
  restauraciones, ramas ni merges en proyectos reales.
- **Proyectos con repo propio** (cuidemonos en `produccion`, poleana-game en
  `preproduccion`, guitar-hero-app en `main`): las acciones del panel añadirán
  commits a su rama actual. No hay push; si el usuario hace push después, esos
  commits viajarán también. cuidemonos tenía `.claude/settings.local.json`
  modificado (archivo ya versionado allí): entrará en su próximo commit.
- mapachanel y news no tienen repo: la primera acción hará `git init` con
  exclusiones seguras (`.env*`, claves, dependencias, `.codex-manager/`, >50 MB).
- Comandos de terminal no generan commit por comando: se guardan como «Cambios
  pendientes antes de …» en la siguiente acción. Con dos chats trabajando a la
  vez en el mismo proyecto, el commit final de uno puede incluir cambios del otro.
- Ejecuciones lanzadas antes del despliegue (runner antiguo) no tienen
  `versions.json`. Filtros LFS/merge drivers de `.git/config` local no se
  neutralizan (solo los configura quien ya tiene acceso al host).
- Al cerrar la sesión seguía trabajando otra petición en paralelo sobre este
  proyecto: «añadir un repo Git al crear proyectos y validarlo» (chat main). No
  se tocó; revisar su resultado en el historial de Versiones.

### Borrar chats y contexto compartido Claude ⇄ Codex (sesión actual)

- No se lanzó un turno real de modelo para probar el traspaso (no gastar cuota):
  el resumen se generó en seco con el historial real de `codex-dashboard/main`
  (7 peticiones, ~8 000 caracteres, 0,07 s) y con pruebas automáticas. Falta que
  el usuario lo use en su celular: escribir a Codex, cambiar a Claude y seguir.
- El resumen incluye petición, respuesta final (≤2 500 car.), archivos editados y
  commit de `versions.json`; no incluye la salida de comandos. Si hiciera falta
  más detalle, el agente debe mirar Git/archivos (el encabezado se lo pide).
- Resuelto: el versionador y este cambio se publicaron juntos (`286a2f9`).
  `bin/cm-runner.py` prefiere `request.txt` para que los commits del versionador
  no incluyan el resumen de traspaso.
- Rollback: imagen `codex-dashboard:before-chat-handoff-20261017`; copia de los
  archivos tocados y del parche en
  `/srv/platform/backups/codex-dashboard-before-chat-handoff-20261017/`.

### Autonomía y respaldo

- Timer diario `codex-dashboard-backup.timer`, 04:15 hora del servidor con hasta
  15 minutos de dispersión. Script `/srv/platform/bin/backup-codex-dashboard.py`.
  Copias privadas código+Git+config (incluye secretos; nunca publicar), SQLite
  consistente, SHA256 y marcador COMPLETE. Conserva 14 copias completas; las
  incompletas no cuentan ni se usan para recuperar. Respaldos manuales intactos.
- Recuperación: verificar sha256.json, extraer source.tgz en directorio nuevo,
  verificar history.bundle, comparar antes de sustituir. Restaurar SQLite junto
  con su secreto y revocar sesiones antiguas. No sobrescribir agentes activos.
- Es protección local frente a errores; no cubre pérdida completa del VPS. No hay
  copia externa configurada. Hay cambios de versionado en curso en el árbol de
  trabajo; se preservaron, no se publicaron como parte de este ajuste operativo.

### Seguridad y terminal (revisión del 17 de octubre)

- Cambios terminados, probados y desplegados. Falta confirmar la experiencia en
  el teléfono físico del usuario; se verificó Chromium a 360/390/1440 px.
- Trivy: cero alertas Python, cero CRITICAL y ninguna corrección disponible
  informada para las alertas Debian restantes. Panel: 54 HIGH, 86 MEDIUM,
  125 LOW, 4 UNKNOWN; voz: 44 HIGH, 58 MEDIUM, 61 LOW, 1 UNKNOWN. Son
  asociaciones paquete/aviso, no vulnerabilidades distintas. Mantener revisión
  de parches; no afirmar cero vulnerabilidades ni explotación demostrada.
- Terminal, Docker y agentes conservan control administrativo deliberadamente.
  Montar docker.sock como `:ro` no restringe las operaciones de su API. Un acceso
  privado/VPN sería una protección adicional futura, no está implementado.
- SSH dv1/root ahora exige claves. Se comprobó clave existente y configuración
  válida; SSH fue recargado. La configuración efectiva completa de rootai quedó
  exactamente igual. No modificar su cuenta ni su acceso de recuperación.
- Respaldo privado previo y copia consistente actual de autenticación en
  `/srv/platform/backups/codex-dashboard-before-security-20261017-191138/`;
  `auth-current/` conserva juntos secreto y SQLite (integridad OK). Es el mismo
  VPS: restauración externa no probada. Una restauración debe revocar sesiones
  antiguas y revisar recuperación. Nunca imprimir estos archivos.
- Se eliminaron contenedores, credenciales y tmux de pruebas; no se tocaron
  proyectos ajenos. Claude `ask`, Codex `full` y proveedor Claude conservados.

### Chats por proyecto (sesión actual)

- Implementación terminada. Se crean desde **Agente → + Nuevo chat** y se cambian
  con el selector **Chat**. El lápiz renombra los chats adicionales; el principal
  conserva su nombre. **Actualizado:** la papelera elimina chats (o vacía el
  principal) por petición del usuario; las ejecuciones quedan en disco y el
  registro en `chats-archive.json`. No hay botón de restaurar chats eliminados.
- **Actualizado:** el contexto es por chat y compartido entre Claude y Codex (cada
  proveedor con su sesión + resumen de traspaso). Un mensaje a la vez por chat;
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

- Implementación terminada y desplegada. **TOTP real ya vinculado**, confirmado
  por estado durante la revisión de seguridad sin acceder al secreto. Conservar
  los códigos de recuperación. Para los seis meses debe marcar la opción
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

### Wear OS 0.3 — interfaz minimalista y navegación por gesto (21 octubre, Claude)

- Código en `wear/app/src/main/java/lat/devdj/codex/watch/`. Nuevos: `Icons.kt` (35 iconos de
  línea dibujados en canvas, sin assets), `Kit.kt` (paleta, `ScrollPage` con indicador de Wear y
  corona, `Action` fila con icono, `RoundButton`, `QuotaRing`, `Heading`, `Field`), `Orb.kt`,
  `Nav.kt` (destinos `Dest`, pila `Nav` en el ViewModel, caché `ToolHub` acotada y `Screens`
  = `SwipeToDismissBox`), `Models.kt` (cuota, avisos, `ago`, `bestAgent`), `Screens.kt`
  (primera pantalla, Avisos, Cuota, Escribir, Respuesta, Avisos del reloj, Desvincular,
  Vincular). Reescritos: `MainActivity.kt` (raíz) y `WatchDashboard.kt` (cada vista de
  herramienta y cada acción a revisar es una pantalla de la **única** pila, por eso el gesto
  funciona en todas; al volver se pinta al instante la última respuesta y se refresca).
  `WatchViewModel.kt` carga y guarda cifrados `home` y `quota`; el aviso nuevo se trae al
  terminar el agente. Sin dependencias nuevas (todo está en Wear Compose Material 3 1.7.1).
- Decisiones: negro puro; sin `TimeText` (la primera pantalla gana altura); esfera de
  diámetro adaptable; botones de dictar/enviar arriba del texto; «Volver / Inicio /
  Actualizar» como tres botones redondos al final de cada herramienta; confirmar una acción
  la envía desde el ViewModel, así que deslizar atrás a mitad de envío no la cancela; una
  acción en revisión se cancela sin enviar nada al deslizar. El tap en una notificación push
  (extra `show_dashboard`) ahora abre Avisos.
- Backend: `wear.recent` y `wear.stamp` en `cm/wear.py`; `view=home` en `app.py` devuelve
  además `approvals` (número) y `recent` (hasta 6: aprobaciones y lo último terminado o con
  error, con `kind`, `project`, `provider`, título ≤ 80, `at`). Pruebas nuevas en
  `tests/test_wear.py`.
- Verificación: **21 pruebas del backend de Wear OK** (Windows con stubs), **6 JVM OK**,
  **17 de interfaz OK en `emulator-5580`** (conversación, primera pantalla con cuota y aviso,
  Cuota, gesto de volver incluida una captura a medio deslizamiento, avisos, herramientas con
  revisión/confirmación, reintento sin duplicar, vinculación). Lint: 0 errores, 1 aviso
  (Firebase 26.0.0 disponible). Capturas inspeccionadas en 216 dp, 192 dp y texto al 130 %
  (los anillos pasaron a una sola línea tras verlo). Ajustes del emulador restaurados
  (`wm size reset`, `font_scale 1.0`). Datos de las pruebas = transporte simulado.
- APK: `%TEMP%\codex-watch-ui-build\outputs\apk\debug\app-debug.apk` (0.3.0, depuración, no
  versionado). Capturas: `artifacts/wear-ui-20261021/` (ignorado por Git).

### Diagnóstico HTTPS de vinculación — 21 octubre

- Peticiones desde este equipo con Java HttpClient y TLS validado: GET `/health` 200;
  GET `/api/wear/state` 401 con el mensaje web anterior; POST `/api/wear/pair/start`
  con JSON vacío 401 y el mismo mensaje. La respuesta correcta de start es 200 sin cookie.
- Se informó al usuario para que su agente del VPS publique el código de Wear-OS. No se
  deshabilitó MFA ni se cambiaron rutas o credenciales del servidor desde este equipo.

### Instalación en Galaxy Watch 7 — 21 octubre, Codex

- Detectado dispositivo físico SM-L300/API 36 antes de cualquier instalación; se verificó
  que el paquete no existía. `adb -s <destino-verificado> install -r` del APK 0.2: Success.
- `am start -W -n lat.devdj.codex.watch/.MainActivity`: Status ok, arranque frío correcto.
  Una segunda apertura llevó la tarea existente al frente. Captura propia inspeccionada
  en `artifacts/wear-validation/watch7-install.png`: pantalla de vinculación renderizada.
- Solo se despertó la pantalla mediante KEYCODE_WAKEUP; no se instalaron APKs de pruebas,
  no se ejecutó instrumentación que borre sesiones, no se cambiaron permisos por ADB ni
  se enviaron tareas a proveedores. Las funciones conectadas siguen pendientes de vincular.

### GitHub y guía de puesta en marcha (20 octubre, Codex)

- Creada rama exacta `Wear-OS`, con commits de ambos hitos del reloj e historial completo.
  Subida a `origin` y seguimiento configurado. Se incorporó el main remoto sin descartar
  cambios. No se publicaron .env, JSON privados, APKs/dependencias ni artefactos locales.
- `.github/workflows/sync-wear-os.yml`, también en main: push a main, cron minuto 17 de
  cada hora y ejecución manual; merge con historia completa, pruebas de backend antes de
  push y ninguna operación force/reset. Checkout v6 fijado por SHA oficial.
- Primera ejecución de GitHub Actions comprobada como correcta y merge del bot recibido
  mediante fetch. Documentación operativa `.github/WEAR-OS.md`. La sincronización no
  requiere esta computadora encendida y falla explícitamente ante conflictos.
- `deploy/WEAR-OS-ACTIVACION.md`: instrucciones listas para el agente VPS y administrador,
  generación de llaves dedicadas fuera de Git, aprobación de públicas, cuenta de servicio
  FCM/JSON exactos, backup y despliegue solo dashboard, recuperación y aceptación real.
  Comandos contrastados con configuración del proyecto y documentación oficial. Son
  instrucciones pendientes de ejecutar en el VPS; no se simula haberlo desplegado.

### Wear OS 0.2 — dashboard y herramientas (20 octubre, Codex)

- `WatchDashboard.kt`: navegación nativa Inicio/Proyectos/Configuración, búsqueda,
  chats por proyecto, conversación, cola, logs/actividad de ejecuciones, terminal,
  archivos paginados, edición con control de versión, Git, jobs, contenedores,
  creación/importación/eliminación/restauración de proyectos, servidor y aprobaciones.
- Mantiene el agente general separado y rápido. Dictado revisado en chats de proyecto,
  borrador y outbox cifrados por proyecto/chat; proveedor, modelo y esfuerzo se congelan
  junto al mensaje/ID antes del transporte. Backend rechaza reutilizar IDs con otro destino.
- Rutas de vistas/acciones con lista explícita; reutilizan validación y versionado del
  dashboard, límite de cuerpo de 16 KB, respuestas acotadas y rechazo de rutas externas.
  Capturar una terminal no crea sesiones ni ejecuta comandos. Envío literal con tmux,
  destino derivado del proyecto; nunca conexión libre a sesiones ajenas/internas.
- Solo la vista visible de agente con trabajo consulta cada 6 s; Inicio activo cada 10 s;
  herramientas pesadas actualizan bajo demanda. Se pausa fuera de RESUMED. Cuota usa la
  caché existente de 2 min y se carga por separado. Scroll se reinicia al cambiar de vista,
  admite entrada giratoria y conserva objetivos táctiles de 48 dp.
- Los avisos opcionales incluyen fallos/aprobaciones de proyectos y, si se elige, respuestas;
  agrupan un único aviso genérico sin contenido de conversaciones. Firebase sigue pendiente.
- Evidencias y APK 0.2: `artifacts/wear-validation/`; guía de configuración en `wear/README.md`.
  APK final: `codex-watch-dashboard-0.2.0.apk` (debug, universal); copia recuperable del
  historial en `codex-watch-dashboard-source.bundle`. Plantilla local de SSH pendiente:
  `deploy/wear-ssh-config.example`; Firebase conserva las rutas privadas documentadas.
- Verificación final: **80 pruebas Python, 24 Node, 1 JVM y 10 de interfaz Android
  aprobadas**; las 10 de interfaz repetidas con fuente al 130 % (restaurada a 100 %).
  Build Android y frontend correctos. Lint Android: **0 errores, 2 avisos** de versiones
  nuevas disponibles. Archivos `dashboard-{backend,frontend,android,large-text}-tests.log`,
  `dashboard-lint.txt` y `dashboard-jvm-tests.xml`. Capturas inspeccionadas de Inicio,
  proyecto y terminal; datos simulados. No equivalen a pruebas contra el VPS/modelo real.

### Wear OS — agente general primero (20 octubre, Codex)

- `cm/wear.py` y rutas `/api/wear/*`: vinculación con secreto de 256 bits y código de
  ocho caracteres, caducidad de cinco minutos, aprobación web con MFA/Origin, sesión
  revocable independiente y alcance limitado a estado/envío/avisos/desvinculación. El token
  tampoco permite entrar a las otras API como cookie. Entrega inicial recuperable ante
  una respuesta perdida y cerrada al primer uso autenticado. Tablas SQLite aditivas.
- Comparte `_general/main`, cola y elección de proveedor existente. `origin=wear` añade
  instrucciones de conversación breve y estado reciente real al prompt, sin reiniciar el
  hilo. IDs deterministas de tarea evitan duplicados incluso tras cortes entre guardar y
  responder. No modifica el agente predeterminado ni expone controles de modelos en el reloj.
- Cliente nativo con Android Keystore, HTTPS validado, borrador persistente y reintentos
  explícitos. Sin sockets permanentes ni sondeo de red en reposo; consulta cada seis segundos
  solo cuando hay trabajo y la actividad está RESUMED. Animación de 72 puntos a 20 fps solo
  al trabajar, detenida fuera de pantalla; respeta escala de animación y tamaño de texto.
- Avisos FCM HTTP v1 con cuenta de servicio privada y opciones de app obtenidas del backend;
  sin secretos incorporados al APK. Solo títulos genéricos, filtro de atención inicial,
  agrupación, deduplicación, espera tras fallos y retirada de tokens UNREGISTERED. La
  conversación no depende del SDK de notificaciones ni de una app propia en el teléfono.
- Web: `WatchPair.jsx` en Ajustes y `/watch`. `frontend/package-lock.json` completado con
  plataformas opcionales ausentes para permitir npm ci actual; ninguna versión existente
  cambió. Frontend: **24 pruebas Node y build Vite correctos** en un entorno Linux aislado
  dentro del emulador. No se modificó el frontend desplegado.
- Backend: **74 pruebas aprobadas** (`test_wear`, `test_general`, `test_auth_security`,
  `test_http`, `test_push`, `test_chats`, `test_availability`) con Python 3.12.7 y las
  dependencias exactas del proyecto en el entorno aislado del emulador. Evidencia:
  `artifacts/wear-validation/backend-tests.log`. No es la suite completa de Docker/tmux/Git.
- Android final: **build correcto, 1 prueba JVM y 5 pruebas de interfaz aprobadas**, estas
  últimas repetidas también con fuente al 130 %; lint con **0 errores** y dos avisos de
  versiones nuevas disponibles. APK: `artifacts/wear-validation/codex-watch-mvp-0.1.0.apk`.
  Evidencias de compilación e instrumentación y capturas bajo `artifacts/wear-validation/`. Las
  capturas de conversación son fixtures de UI, no respuestas reales de un modelo.

### Publicación en GitHub (20 octubre, Codex)

- Repo vacío comprobado antes de subir, usando acceso SSH de `raulisai`.
- Añadido `origin` HTTPS como pidió el usuario y URL de push SSH para aprovechar
  la autenticación existente sin guardar tokens.
- `git push -u origin main` completado correctamente; historial conservado.
- Sin cambios de código de aplicación ni reconstrucción de contenedores.

### Preparación para GitHub (20 octubre, Codex)

- `ssh -T git@github.com`: identidad `raulisai` autenticada correctamente.
- `git ls-remote git@github.com:raulisai/codex-dashboard.git`: repo no encontrado.
- Estado privado del panel consultado sin mostrar secretos: GitHub desconectado.
- Árbol de trabajo inicialmente limpio, rama `main`, 148 archivos versionados,
  sin remotos; historial analizado (329 blobs), sin patrones de credenciales hallados
  ni archivos grandes. `.env` y dependencias/artefactos ya están ignorados.
- Respaldo completo antes de preparar la subida:
  `/srv/platform/backups/codex-dashboard-auto/20261020T200050.432786Z/`.
- No hubo cambios de aplicación ni despliegue; publicación GitHub aún pendiente.


### Interfaz viva y más animaciones (Claude, 18 octubre)

- `particles.js` reescrito: `SHAPES`, `TINTS`, `MOTION`, `shapeFx` (efecto por partícula según el
  tiempo en la forma), `neuralPairs`, `mixColor`. `Orb.jsx`: transición con apagado gradual del
  efecto anterior, paleta teñida, giro/vaivén por forma, sinapsis, onda `pulse` (ok/error/done),
  `DWELL`; eje y invertido para el lienzo.
- `general.js`: base de datos, leer/buscar, «Escribiendo código», presencia «Respondiendo» o
  «Preparando una gráfica…» según el bloque en curso (`draftingType`), `planOf` (TodoWrite/Codex).
- `presentations.js`: tipos stats, progress, image, code; `liveSpecs` (tarjetas por id con versión),
  validadores `statItems`, `progressOf`, `imageSources`, `codeOf`. `Presentations.jsx` + `live.css`:
  gráficas animadas, tabla con filas que entran y celdas que destellan, cifras con contador,
  progreso, imagen con desenfoque al cargar, código, `DraftCard`, `LiveStage`.
- `views/General.jsx`: plan, `--presence` por forma, pulso al completar herramientas, `LiveStage`
  de la ejecución actual o la pedida en esta visita; `.general-body` (`display: contents`) permite
  el modo lado a lado con poca altura en horizontal.
- Backend: `cm/media.py` + `GET /api/media/{name}` (sesión, `O_NOFOLLOW`, archivo regular ≤ 15 MB,
  CSP sandbox, nosniff); `media.prepare()` crea la carpeta (0700) y poda a 30 días. Guía
  «Interfaz viva» en `cm/runs.py` con tipos, `id` en vivo, carpeta de imágenes y ejemplos.
- Pruebas: **174 Python + 24 frontend OK**. Nuevo `tools/verify_general_alive_browser.cjs`
  (390/320/768/1440/740×390): formas con color, plan, tarjetas por id sin duplicarse (progreso
  20→80, cifras 42.5→57, tabla que crece, barras que se mueven), imagen, código, dona, resultado al
  terminar, ocultar, «Ver texto», movimiento reducido. Capturas en `artifacts/general-alive-20261018/`.
  También `GENERAL_BROWSER_OK`, `GENERAL_LIVE_OK` y `GENERAL_KEYBOARD_OK`.
- Publicado con `docker compose up -d --build --wait`: healthy; `/health` y `/agent` 200,
  `/api/media/x.png` 401 sin sesión, bundle con `general-canvas`; `/srv/projects/.cm-media` (dv1, 0700).

### Respuestas breves por voz (Claude, 18 octubre)

- `cm/runs.py`: bloque «Respuestas» al inicio de `GENERAL_PRESENTATION_GUIDE` (voz, 1–3 frases,
  detalle solo si lo pide) y presentaciones solo si las pide; `general_prompt()` ya no pide
  «frase final de resumen» (sobraba con respuestas cortas).
- `views/General.jsx`: estado `fresh` ({id, heard}) para la respuesta a lo pedido en esta
  visita; se habla con `say()` sea voz o texto (`unlockSpeech()` también al enviar escrito),
  sin `setResponseOpen(true)`. Botón `.general-reveal` «Ver texto» bajo el estado; abrir la
  respuesta (botón o «+») limpia `fresh`; enviar otra cosa también.
- `general.js`: `presence({ready})` → `{kind: 'done', title: 'Respuesta lista'}`; `speakable` 420.
- `Quota.jsx`: proveedor ausente → estado de error en vez de excepción.
- Pruebas: `test_general.py` (prompt Claude y Codex reanudado), `general.test.mjs` (ready,
  límite de voz). `verify_general_browser.cjs` simula `speechSynthesis`, exige que no se abra
  el texto, que se lea, «Ver texto» dentro de pantalla y que lo abra (captura `answered-*`).
  `verify_general_live_browser.cjs` usa el «+» para «Terminar conversación» (estaba desfasado)
  y «Ver texto». **172 Python + 19 frontend OK**, `GENERAL_BROWSER_OK` (6 tamaños, local y
  URL real 390/1440), `GENERAL_LIVE_OK`, `GENERAL_KEYBOARD_OK`.
- Publicado con `docker compose up -d --build --wait`: ambos healthy; `/`, `/agent`, `/health`
  200, API anónima 401; el bundle publicado contiene «Ver texto».

### Cupo de Claude y Codex

- `bin/cm-quota.py`, `cm/quota.py` (normaliza, limita a 0–100, caché 120 s, un refresco a la vez,
  conserva lectura vieja si falla), `repos.host_op(..., helper=)` reutilizado, ruta `/api/quota`.
- `frontend/src/Quota.jsx`, `quota.js`, `quota.css`; tarjeta en Inicio y bloque en Ajustes.
- Pruebas `tests/test_quota.py` (4) y `frontend/tests/quota.test.mjs` (3). Navegador 360/1440
  (API simulada) en la URL real: contenido, sin desbordamiento. Producción: healthy, `/api/quota` 401 sin sesión.

### Entrada animada y formas por acción (Claude, 18 octubre)

- `particles.js`: `shapeOf(kind)` y `shapePoints(shape, n)` (globe, scan, cube, helix,
  torus, wave, cluster; deterministas). Prueba nueva en `tests/presentations.test.mjs`.
- `Orb.jsx`: prop `shape` (`data-shape`); cada partícula se interpola hacia su forma,
  `MOTION` fija giro/inclinación por forma, banda de escaneo, ondas al editar, destello
  al cambiar. Con movimiento reducido se redibuja solo al cambiar estado/forma.
- `views/General.jsx`: pasa `shapeOf(status.kind)` mientras trabaja; mide el hueco de
  `.bottom-nav a.accent .bn-icon` y, si existe, monta `.general-dock.in-nav` en un
  portal (`createPortal` a `body`, porque `.general` aísla su apilado) en esa posición.
  `general.css`: la esfera de la barra se desvanece agrandándose; `dock-arrive` hace
  aparecer el «+» de 52 px girando tras la llegada de la esfera.
- Pruebas: 168 Python + 16 frontend OK; `GENERAL_KEYBOARD_OK` 390/360/1440 y
  `GENERAL_BROWSER_OK` 320/360/390/768/1440/740×390 (comprueba «+» centrado en la
  barra, `data-shape` torus → cube → sphere). Capturas `shape-*.png` y `nav-dock-390.png`.
- Publicado con `docker compose up -d --build --wait`; healthy, `/health` 200, chunks
  publicados con la nueva vista.

### Ejecución en vivo arriba y controles plegados (Claude, 18 octubre)

- `views/General.jsx`: `.general-live` (botón transparente con `liveRows = rows.slice(-3)`
  de `activityRows`, `data-age` 0/1/2 para atenuar los antiguos, `typingLine` en
  cursiva) y `.general-dock` con `.dock-toggle` («Controles», `aria-expanded`,
  `data-state` working/conversation + `.dock-badge`) que despliega `.general-actions`
  (`role="group"`). `pick()` pliega y deja el foco en «+» para que los diálogos lo
  devuelvan ahí. Clase `has-live` reduce la esfera para que todo quepa.
- `general.css`: estilos `.live-*`, `.dock-*`, panel flotante animado; reglas para
  `max-height: 600px`, `keyboard-open` y transparencia reducida.
- Pruebas: `verify_general_browser.cjs` (helper `control()`, comandos exactos visibles
  y transparentes arriba, duración, iconos, Escape/toque fuera, foco, Detener desde
  ambos sitios) y `verify_general_keyboard.cjs` (usa `.general-dock`).
  **168 Python + 15 frontend OK**, `GENERAL_KEYBOARD_OK` 390/360/1440 y
  `GENERAL_BROWSER_OK` 320/360/390/768/1440/740×390 (una vez falló a 1440 esperando
  «Nuevo proyecto» en /projects, intermitente; al repetir pasó todo). Capturas
  `controls-*` y `working-*` en `artifacts/general-responsive-20261018/`.
- Publicado con `docker compose up -d --build --wait`: ambos servicios healthy,
  `/health` y `/agent` 200, el chunk `General-*.js` publicado contiene la nueva vista.

### Quitar «Desplegar» de la cabecera del proyecto

- `views/Workspace.jsx`: fuera el `btn run` de `.ws-top` (la función `run` sigue para
  Vista previa); CSS `.btn.run` eliminado de `style.css` y `neon.css`.
- Build + 15 pruebas frontend OK. Desplegado con `docker compose up -d --build`:
  healthy, `/`, `/p/codex-dashboard`, `/health` 200, API sin sesión 401. Chromium con
  API simulada en la URL real (360/390/1440): sin botón en la cabecera, «Desplegar
  cambios» accesible desde «Más»/barra lateral, sin desbordamiento ni errores.

### Cierre del agente general «vivo» (Claude, 18 octubre)

- `views/General.jsx` (`AgentDialog`): guarda el elemento que abrió el diálogo y
  le devuelve el foco al desmontar (React retira el `<dialog>` antes de cerrarlo).
- `general.css`: con `keyboard-open` en ≥1024 px el historial se ancla arriba
  (`top: 20px; bottom: auto`) para no quedar detrás del teclado virtual.
- `tools/verify_general_browser.cjs`: espera el botón «Terminar conversación» de
  la barra de acciones en vez del antiguo `.voice-end`. Capturas en
  `artifacts/general-responsive-20261018/`. Publicado con
  `docker compose up -d --build --wait`; ambos servicios healthy.

### Chat ergonómico (18 octubre, Codex)

- `Agent.jsx`: controles de chat y proveedor agrupados en details nativo, cerrado
  inicialmente; cierre por Escape/fuera con foco restaurado al usar Escape.
- `style.css`: cabecera 44 px, panel superpuesto, compositor reducido, micrófono
  sin etiqueta visual (con nombre accesible), modelo y esfuerzo junto al micrófono.
- Conserva borradores por chat, modelo/esfuerzo, adjuntos y altura automática.
- Build Vite y 14 pruebas frontend correctas; navegador de chats y eliminación/
  traspaso verificados en 360/390/768/1440 px, sin mutaciones reales.

### Proyectos compacto y pantallas responsive (18 octubre)

- `Projects.jsx`: conserva búsqueda, selección persistente, favoritos, borrado y
  actividad. Selector nativo + flechas, imagen 64 px, resumen operativo enlazado,
  botón Abrir aplicación y accesos directos a agente/vista previa/archivos/
  servicios/logs/versiones/terminal. Cada herramienta incluye una explicación.
- `neon.css`: disposición apilada/dos columnas según espacio, nombres largos,
  controles con 16 px para evitar zoom de inputs en iOS, filas móviles con botones
  de 44 px, etiquetas de estado de peticiones visibles y cabecera compacta del workspace.
- `Workspace.jsx`: diferencia Detenida de Sin desplegar y Parcialmente activa.
- README y prueba histórica de Inicio/Proyectos adaptados a la nueva navegación.
- Build Vite correcto. Primera revisión local: 12 vistas × 7 tamaños
  (320/360/390/600/768/1024/1440), sin desbordamiento ni errores JS, búsqueda,
  selector, flechas, estados y acceso a archivos comprobados. Comprobación final
  sobre despliegue en `tools/verify_responsive_browser.cjs` incluye 14 vistas
  (también vista previa y terminal con WebSocket simulado) y estado sin proyectos.
- Verificación final publicada: **14 vistas × 7 tamaños OK** (320/360/390/600/
  768/1024/1440), sin errores JS ni desbordamiento horizontal. También búsqueda,
  selector/flechas, estado parcial y vacío, acceso a archivos y terminal simulada.
  Ejecuciones finales completas: 320 px y el resto de tamaños, tras estabilizar
  reconstrucciones concurrentes que interrumpieron intentos anteriores.
- Nombres largos de contenedores e imágenes se envuelven; títulos de peticiones
  admiten dos líneas. No se descartan cambios de los otros chats del proyecto.
- Evidencias: `artifacts/responsive-20261018/`, `published/` y `final/`.
- Publicado con `docker compose up -d --build`; `/projects` HTTPS 200, `/health`
  ok, dashboard y speech healthy. No se modificó autenticación ni datos de apps.


### Input del chat: restaurar tamaño al enviar (18 octubre, Codex)

- `Agent.jsx`: sustituido cálculo exclusivo en onInput por useLayoutEffect
  dependiente de texto/visibilidad y ref del textarea. Cubre escritura, borrado,
  dictado, envío y recuperación de borradores. Mantiene límite de 220 px.
- `verify_chats_browser.cjs`: comprueba crecimiento, límite y reducción al borrar
  y después de enviar un borrador largo recuperado desde otro chat.
- Navegador sobre la web publicada OK a 360/390/768/1440 px: crecimiento,
  borrado, cambio de chat, recuperación de borrador y reducción tras enviar.
  Evidencias: `artifacts/composer-20261018/`.
- 14 tests frontend y build Vite OK. Reconstruido con
  `docker compose up -d --build`; Inicio y /health HTTPS 200; servicios healthy.


### Barra compacta Glass y ergonomía (18 octubre)

- `neon.css`: altura 60 px, iconos 18 px, esfera 64 px elevada 15 px por encima
  de la barra, transparencia, blur/saturación, alternativa opaca sin soporte,
  selección visible, respuesta táctil y zonas seguras. Texto de navegación 10 px
  con más contraste. Zonas táctiles de 52 px de alto; ajustes/enlaces Inicio ≥44 px.
- `App.jsx`: saltar al contenido por teclado y aria-current en navegación lateral.
- Respeto de movimiento reducido y preferencia de transparencia reducida.
- Vite OK; Chromium 320/360/390/768/1440 sin desbordamiento ni errores JS; altura,
  objetivos táctiles, esfera elevada, navegación/aria-current, foco y movimiento
  reducido comprobados (`GLASS_BROWSER_OK`). Evidencias `artifacts/glass-20261018/`.
- Reconstruido con `docker compose up -d --build`; Inicio HTTPS 200 y health ok.


### Agente general: conversación y presentaciones

- Orb.jsx/particles.js: 1250 puntos grandes y 220 por miniatura, esfera Fibonacci
  con deformación/rotación y respuesta al audio; DPR limitado, pausa por visibilidad
  e intersección, render estático con movimiento reducido. Sin recursos externos.
- useOrbVoice: SpeechRecognition con resultados provisionales cuando existe,
  fallback local si falla, cancelación y tiempos acotados. General elimina espera
  de 3 s, habla y reanuda escucha, permite terminar o interrumpir y apaga al ocultar.
  TTS se asocia al ID del mensaje, conservado durante cambio de proveedor.
- Speech: tiny int8 fijado a d90ca5fe260221311c53c58e660288d3deb8d356 para fast <=30 s;
  small sigue para preciso/largo. Protocolo/formatos y límites de audio conservados.
  Rechazo de texto vacío, baja confianza y repetición antes de enviar órdenes.
- availability.py y planificador: observaciones persistentes, salto a otro CLI
  solo por fallo de conexión/cupo/auth y solo en _general. providers_tried en TSV
  columna 17; mensajes históricos compatibles, máximo una ejecución por proveedor
  y mensaje. Éxitos no se clasifican como cuota por avisos anteriores.
- Claude --include-partial-messages y normalización de fragmentos sin duplicar
  texto final; General actualiza cada 500 ms al trabajar y carga eventos completos
  solo de la última ejecución para reducir tráfico. Nuevas capacidades se inyectan
  también en sesiones Codex reanudadas, sin reiniciar contexto.
- Presentations.jsx/presentations.js: protocolo cm-ui acotado (6 tarjetas/64 KB),
  gráficos SVG, tablas, archivos y HTML/SVG saneado con DOMPurify, iframe sandbox
  sin scripts y CSP sin red. Ampliación con diálogo nativo y Escape. Rutas de
  archivos validadas y endpoints existentes mantienen control de acceso.
- 168 Python y 14 frontend aprobados; build Vite correcto y npm audit de producción
  sin alertas. Prueba local General a 360/390/1440; prueba de voz nativa/turnos,
  fallback local, UI, HTML hostil sin scripts/red/acceso al padre y agotamiento doble
  aprobada también contra HTTPS público. No se gastaron turnos de agentes.
- Validación final: GENERAL_BROWSER_OK a 360/390/1440 sobre URL pública y
  GENERAL_LIVE_OK (texto provisional, envío rápido, TTS y reescucha, fallback a
  local, cuatro tipos de presentación, Escape, HTML sin scripts/red/padre y error
  claro cuando ambos proveedores fallan). Directorio: artifacts/general-release-20261018.
- SPEECH_SECURITY_OK: WAV/WebM/MP4 reales, listas remotas rechazadas, elección
  tiny/small por duración, rechazo de repetición y prueba del healthcheck de voz.
  Se corrigió una referencia incorrecta del healthcheck introducida en la revisión.
- Publicado con docker compose up -d --build --wait --wait-timeout 120. Backend
  y speech actuales coinciden por SHA256 con los archivos verificados. Ambos
  healthy; /agent y /health HTTPS 200, API anónima 401, health interno de voz ready
  y fast_engine tiny correctos. Se retiró solo el preview local creado por esta sesión.
- Otros agentes empezaron tareas en paralelo y el versionador guardó snapshots
  durante el trabajo. Se preservaron sus cambios en Agent.jsx/verify_chats_browser;
  no detener sus previews ni sus procesos y no sobrescribir sus modificaciones.

### Panel de modelos y esfuerzo junto al mensaje

- ModelPicker.jsx: diálogo modal nativo, elección por botones, resumen inferior,
  niveles compatibles, limpiar esfuerzo al cambiar a modelo no compatible, cerrar
  por Escape y respeto a movimiento reducido. Sin inputs/datalists de modelos.
- modelcatalog.py/API autenticada GET /api/models, validador de esfuerzo por modelo
  en POST /api/agent/send. General rechaza overrides. tasks conserva modelo/esfuerzo
  en TSV y runs/meta; runner aplica Claude --effort o Codex -c
  model_reasoning_effort antes de resume. No se cambian permisos de agentes.
- refresh_models.py: salida saneada/atómica 0600; no exporta account/identidad,
  credenciales ni instrucciones internas del catálogo. Timer systemd activo.
- 162 Python OK (incluye compatibilidad modelo/esfuerzo, auth de catálogo,
  argumentos reales CLI y cola); 11 frontend OK y build Vite correcto.
  Navegador local: CHATS_BROWSER_OK a 360/390/768/1440 con selección por botones,
  sin campo manual, esfuerzo en POST, independencia chat/proveedor, Escape,
  descarte de esfuerzo incompatible y ausencia en el agente general.
- Verificación final contra URL pública: CHATS_BROWSER_OK a 360/390/768/1440,
  sin errores JS. Evidencias en artifacts/picker-live-20261017. Datos interceptados
  en navegador, sin gasto de turnos. Catálogo real en servicio: 7 Codex, 13 Claude,
  compatibilidades comprobadas. Timer y última actualización correctos.
- Desplegado con docker compose up -d --build --wait --wait-timeout 90; ambos
  servicios healthy. curl health/proyecto 200, catálogo anónimo 401. Preview
  temporal retirado. Configuración de modelos se añade a los respaldos privados.

### Selector de modelo por proyecto

- ChatConversation muestra input/datalist accesible por proveedor; persiste las
  selecciones por chat y las envía en cada POST. No cambia el agente general.
- app.agent_send valida tipo/sintaxis/longitud y rechaza overrides en _general.
  tasks conserva `model` en TSV; runs aplica el override solo a esa ejecución,
  conservando sesión, permisos y modelos globales. Reintentos conservan selección.
- tests/test_models.py: roundtrip, cola con modelos diferentes, ejecución aislada,
  ajustes intactos, formato histórico, general sin override y validación HTTP.
  **160 pruebas Python y 11 frontend aprobadas**, build Vite correcto.
- verify_chats_browser.cjs amplía comprobaciones por chat/proveedor, modelo en
  POST y ausencia en agente general; API simulada, sin lanzar tareas reales.
- CHATS_BROWSER_OK en URL pública a 360/390/768/1440, sin errores JS; selección
  aislada entre chat/proveedor, modelo enviado y sin selector en agente general.
  Evidencias en `artifacts/models-live-20261017/`.
- Desplegado con `docker compose up -d --build --wait --wait-timeout 90`.
  dashboard y speech healthy; curl /health y proyecto 200, API anónima 401.
  Preview local retirado. No se consumió cuota de modelos en la validación.

### Refinado de esfera y conversación

- `Orb.jsx`/`orb.css`: mismo componente en navegación móvil/escritorio y esfera
  central, 14 partículas interiores y tres satélites, animaciones CSS, pausa al
  ocultar pestaña y movimiento reducido. Sin canvas ni bucle JS de animación.
- `General.jsx`: identidad única, proveedor de Ajustes, historial conversacional
  sin selector técnico, respuestas sin corte de 260 caracteres, borrador privado
  persistente, protección de doble envío y preservación del texto ante errores.
  Un fallo al recargar después de un POST exitoso no provoca reenvíos duplicados.
- `useOrbVoice.js`: AbortController cancela transcripción al salir; temporizador
  de timeout liberado y ciclo de montaje corregido. Service worker actualizado.
- Pruebas frontend: 11 aprobadas y build Vite correcto. Script de navegador
  actualizado para verificar ausencia de selector, esfera compartida, fallo de
  envío con borrador conservado, voz y movimiento reducido a varios tamaños.

- Validación final sobre HTTPS público: GENERAL_BROWSER_OK a 360/390/1440,
  sin errores JS, micrófono virtual y API interceptada (sin consumo de modelos).
  Comprueba voz, actividad, detener, historial, envío fallido con borrador,
  movimiento reducido y creación solo en Proyectos. Evidencias finales en
  `artifacts/general-refined-final-20261017/` (browser.log y capturas).
- Reconstruido con `docker compose up -d --build --wait --wait-timeout 90`;
  dashboard y speech healthy. curl público: /agent y /health 200, API anónima401.
  Preview local de pruebas retirado al finalizar.

### Agente general en la esfera central

- Backend: `config.GENERAL='_general'`; `runs.general_prompt()` (rol, reglas del
  servidor, catálogo de proyectos con resumen y URL) y `start_run` con cwd
  `/srv/projects`, sin versionado; Codex recibe el catálogo también al reanudar.
  `normalize_claude` añade `t0`/`t1` a las herramientas. `app.agent_project()`
  acepta `_general` en agent/chats; `add_task` lo admite. `push.label/link`:
  notificaciones «Agente general» → `/agent`.
- Frontend: `general.js` (clasificar herramientas, filas, proyecto detectado,
  titular, texto hablable), `useOrbVoice.js` (micrófono + medidor + silencio),
  `views/General.jsx` + `general.css` (esfera con anillos, ondas, giro y estados
  idle/working/thinking/listening/speaking; llegada animada desde la barra; hoja
  «Ver conversación» con `ChatConversation`; aprobaciones; Detener; Escribir).
  `App.jsx`: nav «Agente» con la esfera, ruta `/agent`, `/new` fuera de la barra.
  Cola e Inicio enlazan las tareas del agente general a `/agent`.
- Pruebas: `tests/test_general.py` (6), `frontend/tests/general.test.mjs` (6);
  `tools/verify_general_browser.cjs` → **GENERAL_BROWSER_OK** (local y URL real):
  esfera llega desde la barra y queda centrada, resumen del servidor, cambio a
  Claude, envío escrito, actividad con duración y sin scroll, menú/hoja, Detener,
  dictado con micrófono virtual que se envía solo, Proyectos conserva «Nuevo
  proyecto». Capturas en `artifacts/general-20261017/`. Se corrigió que el fondo
  tapara el aviso de tmux y que «Escribir» quedara bajo la barra en 360×740.
- Desplegado con `docker compose up -d --build`: ambos servicios healthy; `/`,
  `/agent`, `/projects`, `/health` 200; API sin sesión 401; Origin ajeno 403.
  Real: tarea `_general` encolada en el contenedor → run en tmux del host con cwd
  `/srv/projects`, `versioning: false`, catálogo en el prompt, terminó en 9,6 s.

### Crear proyecto desde repo Git y repo en GitHub

- `bin/cm-repo.py` (host, vía tmux `cmj-repo-*`, petición/resultado en
  `/config/repo-ops/<id>/`, borrado al terminar): `check` (ls-remote, rama
  principal y ramas), `clone` (solo al temporal vacío `.nombre-creating-*`),
  `push` (rama actual a origin). URLs https/ssh, `GIT_TERMINAL_PROMPT=0`,
  `GIT_ALLOW_PROTOCOL=https:ssh`, BatchMode, sin hooks; mensajes de error en español.
  umask 022 para que Docker pueda leer el código clonado (se detectó 0600 y se corrigió).
- `cm/repos.py`: normaliza (GitHub https/`usuario/repo` → SSH; rechaza file://,
  rutas, opciones, ext::, credenciales en URL, http), `check`/`clone`/`push`,
  token GitHub cifrado con Fernet derivado de `.cm-secret` (`/config/github.json`,
  0600), `/user` para validar y `POST /user/repos` privado.
- `cm/projects.py`: `name_problem`, `_commit_scaffold`, `import_project` (todo o
  nada; repo vacío → scaffold), `import_prompt`, `publish_github` (crear + origin +
  push; un fallo no impide el proyecto). `app.py`: create con `repo_url`/`repo_branch`
  o `github`; `POST /api/projects/repo-check`; `GET|POST /api/github` (auditado).
- UI: `Create.jsx` selector de origen, validación con estado, rama, nombre sugerido
  desde el repo, pasos numerados sin huecos, sin «Tecnología»/«Publicar» al importar
  código; `Settings.jsx` sección GitHub (conectar/desconectar).
- Pruebas `tests/test_repos.py` (11): normalización y rechazos, helper (refs,
  errores, rutas seguras, clonado local), host_op ida/vuelta y proceso muerto,
  importar con ramas/vacío/fallos sin residuos, token cifrado + creación + 422,
  HTTP auth/Origin/import sin despliegue/GitHub. 150 Python + 5 Node OK.
- Real (solo lectura salvo el temporal): desde el contenedor desplegado validó
  `raulisai/cuidemonos` privado por SSH (master, produccion) en 1,6 s y el error de
  un repo inexistente; importó `octocat/Hello-World` como `cm-import-check-20261017`
  (ramas remotas, origin SSH, permisos 644/750) y se borró. Sin residuos en repo-ops.
- `tools/verify_repo_create_browser.cjs`: **REPO_CREATE_BROWSER_OK** (360/390/1440,
  API simulada); capturas en `artifacts/repo-create-20261017/`. Desplegado con
  `docker compose up -d --build` desde el proyecto: healthy, `/`, `/new`,
  `/settings`, `/health` 200; `/api/github` y repo-check sin sesión 401; Origin ajeno 403.

### Versionador Git (commit por acción, ramas y rollback)

- `cm/vcs.py` (solo stdlib, usado por panel y `bin/cm-runner.py`): `snapshot()`
  hace `add -A` + commit con trailers `Codex-Manager-Action/Provider/Run/Chat/
  Restores/Reverts/Job`; init automático con identidad de respaldo y bloque en
  `.git/info/exclude`; excluye >50 MB; flock `.git/codex-manager.lock` entre
  contenedor y host; reintento ante `index.lock`; se niega con merge/rebase a medias.
- `cm/gitops.py`: status (rama, sin rama, operación, pendientes, destino de
  deshacer, despliegue), log paginado con estadísticas y rama a rama
  (`only_here`), detalle con archivos ±, diff de versión/comparación, ramas con
  ahead/behind. Acciones: commit, init, restore (`read-tree -u --reset` + commit
  nuevo), undo (sigue cadenas `Restores`; con pendientes vuelve a HEAD),
  revert (`--no-commit`, aborta si choca), branch-create/switch/merge(`--no-ff`,
  aborta en conflicto)/delete (archiva en `refs/codex-manager/archivadas/`).
  Antes de cambiar archivos: bloqueo si hay agente/despliegue, commit de lo
  pendiente y copia de ignorados sobrescribibles en `.git/codex-manager/respaldos/`.
  Revisiones solo sha hex o rama existente; nombres de rama validados.
- Runner: versión «antes» y «después» de cada agente, cuerpo con petición y
  respuesta final; `versions.json` por ejecución (`base`, `commit`). `runs.py`:
  `auto_commit` en ajustes, `title`/`versioning` en meta, commit previo y `commit`
  en trabajos deploy/dev/build, `version` en `describe_run`.
- `app.py`: `GET /api/git`, `/api/git/log`, `/api/git/commit`, `/api/git/branches`,
  `/api/git/diff?rev&compare`; `POST /api/git` con `deploy: true` para «… y
  publicar». Editor, operaciones de archivos y subidas al proyecto crean commit
  (antes guardan lo pendiente aparte); adjuntos del chat no se versionan.
- Interfaz `workspace/Git.jsx` («Versiones»): cabecera con rama, sha, producción
  y Deshacer; pestañas Historial/Ramas/Cambios; hoja de detalle; confirmaciones
  con «… y publicar». `Agent.jsx`: chip de versión por respuesta. Ajustes:
  Versiones (Git). Etiqueta «Versiones (Git)» en workspace y Proyectos.
- Pruebas `tests/test_versions.py` (17): init sin secretos, commit por acción,
  desactivar, deshacer repetido y con pendientes, restaurar y volver, copia de
  ignorados, revert y conflicto limpio, ramas/merge/conflicto/borrado, bloqueo
  con agente, archivos grandes, sin ejecutar textconv/diff externo/fsmonitor,
  runner antes/después, despliegue marcado, HTTP con auth/Origin/deploy.
- `tools/versions_fixture.py` + `tools/verify_versions_browser.cjs`: instancia
  HTTPS aislada en contenedor desechable (tmpfs, sin proyectos reales) y flujo
  completo en Chromium. Capturas: `artifacts/versions-20261017/`.
- Corrección tras desplegar: el contenedor no tenía el ignore global del host y
  habría versionado `.claude/settings.local.json`; añadido a exclusiones seguras.
- Despliegue `docker compose up -d --build --wait`; respaldo previo: imagen
  `codex-dashboard:before-versions-20261017` y commit `12eb60d`. Un `/health`
  devolvió 404 unos segundos mientras Traefik re-registraba; después 200.

### Borrar chats y contexto compartido entre agentes

- `cm/chats.py`: `delete()` con `tasks.LOCK` + `runs.STATE_LOCK`; rechaza si hay una
  petición en curso, cancela las de la cola («Cancelada al eliminar el chat»),
  olvida sesiones del chat y archiva fila+sesiones en `chats-archive.json`. En
  `main` vacía: guarda la fecha y `runs.list_runs(chat_id='main')` oculta lo previo.
  API: `POST /api/agent/chats {action: 'delete', project, chat_id}` (sesión+TOTP+Origin).
- `cm/runs.py`: `handoff_context()` resume las peticiones del chat posteriores al
  último turno incluido en la sesión guardada del agente elegido (o todo el chat
  desde `_reset_at` si no tiene sesión); `request.txt` guarda el mensaje limpio y
  `meta.handoff` el número resumido. Planificador: clave proyecto/chat (antes
  proyecto/chat/proveedor). **Reiniciar** borra las sesiones de ambos proveedores
  y fija `_reset_at`. `describe_run` muestra `request.txt` y `handoff`.
- `Agent.jsx`: papelera (Eliminar chat / Vaciar chat principal) con confirmación,
  limpieza de borrador/adjuntos/proveedor locales, «X retoma el chat», marca
  «retoma el chat» en la respuesta, «Se pondrá en cola» con cualquier agente
  ocupado. CSS: oculta la etiqueta «Chat» bajo 400 px para no estrechar el selector.
- Pruebas: 7 nuevas en `tests/test_chats.py` (traspaso en ambos sentidos, mismo
  agente sin resumen, sesión perdida/reinicio, serialización entre agentes,
  borrar, vaciar, HTTP/Origin) y `test_core` adaptado a la serialización por chat.
  138 Python OK (árbol combinado con el versionador), 122 OK en el árbol publicado,
  build Vite y tests Node OK. `tools/verify_chat_delete_browser.cjs`:
  **CHAT_DELETE_BROWSER_OK**; capturas en `artifacts/chat-delete-20261017/`.
- Despliegue: `docker compose up -d --build --no-deps --wait dashboard` desde
  `/tmp/cm-deploy` (HEAD + `cm/projects.py` publicado + parche). Healthy; HTTPS
  `/`, `/health`, `/projects` 200; chats sin sesión 401; borrar con Origin ajeno 403.
  speech, Traefik, agentes del host y la ejecución del otro agente no se tocaron.

### Autonomía autorizada y copias diarias

- Ajustes persistentes actualizados por runs.save_settings en el servicio vivo:
  claude_permission=auto, codex_sandbox=full. Sin cambiar procesos ya iniciados,
  segundo factor, reglas de acceso web ni cuenta rootai.
- Instalados script y servicio/timer de respaldo privado. Primera copia completada;
  se comprueban hash, extracción aislada, bundle y SQLite sin revelar su contenido.
  Son cambios operativos/documentales: no se reconstruyó código de la app ni se
  mezclaron los cambios de versionado concurrentes con un nuevo despliegue.

### Revisión de seguridad y reparación de terminal

- `cm/websecurity.py`: Origin canónico, cabeceras CSP/HSTS y protección de
  respuestas tempranas, errores uniformes y auditoría sin cuerpos ni secretos.
- `cm/terminal.py`: límites de conexiones/mensajes/colas, PTY con contrapresión,
  escritura parcial y limpieza segura; revocación de sesión periódica. `cm/tmux.py`
  corrige destino de pane. Frontend: estado previo, reintentos, pausa de historial
  visible y vuelta al directo. No se mata el shell del usuario al desconectar.
- Límites de JSON, multipart y respuestas Docker; push vinculado a sesión vigente;
  logout borra borradores privados. Git evita hooks/fsmonitor/diff externos;
  plantilla Node impide traversal y enlaces externos; decodificador voz restringe
  formatos/protocolos y serializa lectura e inferencia.
- Imágenes reconstruidas con actualizaciones disponibles; pip/ensurepip retirados
  del runtime. Compose: raíz readonly, tmpfs, cap_drop ALL, logs rotados y rate
  limit Traefik. Dependencia source-map-js corregida; npm audit cero avisos.
- 116 Python y 5 Node OK; después del último ajuste de plantilla, 48 regresiones
  centrales OK. Navegador real aislado: TOTP/recuperación/revocación/180 días,
  limpieza de borradores, terminal con Bash real, historial, reconexión y fallo
  previo. Audio WAV/WebM/MP4 real con modelo simulado; HLS/concat rechazados sin
  conexiones salientes. HTTP real de plantilla: traversal/symlinks rechazados y
  URL malformada sin caída. Evidencias completas en artifacts/security-20261017.
- Desplegado con `docker compose up -d --build --wait --wait-timeout 90`.
  curl TLS estricto comprobó web/health/ruta shell 200, API 401, Origin ajeno403
  y cabeceras. Ambos servicios healthy. Chromium público verificó bloqueo CSP
  de script inline; shell real verificado con attach pasivo de solo lectura,
  sin enviar comandos ni registrar su contenido. Docker y voz interna OK.
- SSH: validación sshd y recarga; igualdad efectiva de rootai documentada en
  `ssh-verification.json`. Informe y límites del escaneo en `SEGURIDAD.md`.

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

- Código: `/srv/projects/codex-dashboard`, repositorio Git local desde el 17/10 (`main`, sin remoto).
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
