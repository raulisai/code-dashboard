# Revisión de seguridad de Codex Manager

Fecha: 17 de octubre de 2026. Alcance: código del panel y su servicio de voz,
frontend/PWA, autenticación, terminal WebSocket, permisos de archivos, uso de
Git/Docker/tmux, dependencias, imágenes y controles básicos del VPS.

Ninguna revisión demuestra que un sistema sea invulnerable. Esta es una revisión
manual con pruebas de regresión y escáneres de vulnerabilidades conocidas, no una
certificación ni una prueba de intrusión independiente. No se modificaron otros
proyectos ni se usaron secretos o autenticadores reales para las pruebas.

## Correcciones aplicadas

| Área | Hallazgo y cambio |
| --- | --- |
| Terminal | Historial fallaba: `copy-mode`/`send-keys` recibían `=sesión`, que es inválido para seleccionar un panel. Se corrigió a `=sesión:` y se verificó con tmux real independiente. |
| Reconexión | Había desconexiones sin recuperación ni explicación útil. Ahora se comprueba el acceso antes de conectar, se muestra el error, se reintenta con espera progresiva hasta cinco veces y se recupera al volver a la app/red. |
| Historial | Se informa cuando está en pausa y se ofrece «Volver al directo». Enviar un comando desde la línea móvil sale primero del modo historial. |
| Transporte | Origin exacto obligatorio para WebSocket; compresión desactivada; mensajes JSON validados, límites de tamaño/frecuencia, cuatro conexiones por sesión y doce globales. Cola de salida acotada, escrituras parciales completas y limpieza protegida contra cancelación. |
| Sesiones | Se mantiene contraseña + TOTP obligatorio, códigos de un solo uso, revocación, rotación de credenciales y máximo absoluto de 180 días. Una terminal revocada se desconecta en cinco segundos sin terminar el shell/tmux. |
| Navegador | CSP sin scripts en línea/eval; anti marcos, HSTS, no-referrer, nosniff, política de permisos y aislamiento de apertura/recursos. Las cabeceras cubren también errores y WebSocket. Los archivos de proyecto mantienen su sandbox propio. |
| Vista previa | El propio panel se abre en otra pestaña y no se incrusta como contenido del editor. |
| JSON/cargas | Login/seguridad limitados a 4 KB; se exige JSON. Cargas con máximo agregado de 25 MB, 20 MB por archivo y 16 archivos. |
| Docker/logs | Una respuesta de Docker no puede consumir memoria ilimitada: máximo 8 MB. Logs de contenedores con rotación de 10 MB × 3. |
| Git | Consultar/confirmar un repositorio no ejecuta fsmonitor, hooks, herramientas de diff/textconv ni programas de firma definidos por ese repositorio. El directorio de trabajo se fija al proyecto. |
| Proyectos | El catálogo excluye enlaces simbólicos, nombres inválidos y sesiones reservadas. README se lee con límite de 16 KB y no sigue enlaces simbólicos. |
| Voz | El decodificador admite solo los formatos de audio previstos y E/S en memoria; rechaza HLS/concat y protocolos externos. Una sola lectura/inferencia simultánea. |
| Avisos | Cada suscripción push queda asociada a una sesión web activa. Cerrar/revocar/cambiar contraseña impide seguir enviándole información privada; las antiguas sin asociación se retiran. |
| Salir | El cierre explícito borra también borradores/adjuntos locales. Una respuesta de polling iniciada antes de salir no vuelve a guardar datos privados en la caché. |
| Despliegue | Raíz del contenedor de solo lectura, tmpfs de 64 MB, capacidades Linux retiradas, usuario sin root y no-new-privileges; límites de CPU/RAM/PIDs existentes. Límite de entrada en Traefik de 25 peticiones/s y ráfaga de 50 por IP. |
| Registro | Eventos de autenticación/seguridad y rechazos 401/403/429 con fecha, ruta, estado e IP; nunca contraseña, código, clave TOTP, cookie ni cuerpo de la petición. |
| Dependencias | `source-map-js` actualizado a la versión corregida. Se actualizan las imágenes base y los paquetes Debian disponibles; pip se actualiza durante build y se retira junto con sus copias vendorizadas/ensurepip del runtime. |
| SSH | `dv1` y `root` usan claves, sin contraseña ni autenticación interactiva. Se comprobó previamente la existencia de una clave autorizada de dv1. La configuración efectiva de rootai se comparó antes/después y es idéntica; su cuenta y sus claves no se tocaron. Recarga validada, sin reiniciar SSH. |

## Límites de confianza y riesgos que siguen existiendo

- **Este panel es una consola administrativa del VPS.** La terminal, el socket
  tmux y los agentes permiten acciones del usuario operativo; Docker puede
  administrar el host. Montar `docker.sock` con `:ro` NO limita su API a lectura.
  Si alguien obtiene acceso completo al panel, el impacto puede alcanzar el VPS
  y otros proyectos. Los controles del contenedor no constituyen aislamiento
  frente a un administrador autorizado ni una plataforma multiusuario segura.
- Se conserva la decisión explícita de Codex con acceso completo y Claude con
  aprobaciones web. No se cambió el proveedor ni se redujeron silenciosamente
  sus permisos. Las instrucciones o repositorios no confiables pueden influir
  en un agente: sus permisos deben considerarse privilegios reales del servidor.
- El escáner detecta alertas en paquetes Debian para las que no informa una
  versión corregida. Su presencia no demuestra que exista un ataque remoto
  reproducible contra esta app; tampoco se declaran falsos positivos ni se
  ocultan. Se conservan identificadores, versiones y estados en los informes.
  Deben revisarse de nuevo cuando el proveedor publique parches.
- Los accesos recordados duran hasta 180 días porque lo pidió el usuario. Una
  cookie robada conserva poder mientras sea válida; rotación, revocación y TOTP
  reducen riesgos, pero no eliminan el secuestro de una sesión ni el acceso físico
  a un teléfono desbloqueado. Los cambios del autenticador/recuperación exigen
  ambos factores nuevamente.
- `rootai` conserva exactamente su política de recuperación, por instrucción
  expresa. No se modificó su acceso SSH. Firewall activo: puertos públicos
  previstos 22/80/443; no se expone Docker TCP ni bases de datos. La actualización
  automática de seguridad del VPS estaba activa durante la revisión.
- La publicación sigue siendo accesible por Internet. La limitación de entrada
  ayuda contra abuso ordinario; una protección adicional mediante VPN/acceso
  privado o un proveedor contra DDoS requiere su configuración correspondiente.
- La comprobación de terminal móvil usa navegador real a tamaños de celular;
  no sustituye la prueba en el teléfono físico o en su red. Se verifican por
  separado el proceso/sesión real de codex-dashboard y el handshake público;
  las pruebas con comandos, reconexión y autenticador utilizan una instancia
  local y un servidor tmux propios, sin entrar en la cuenta real ni interrumpir
  sus shells o agentes.

## Evidencias y operación

- Capturas, pruebas, build, despliegue y escaneos: `artifacts/security-20261017/`.
- Pruebas de terminal: `tools/verify_terminal_browser.cjs`, solo HTTPS local y
  tmux de pruebas. Prueba de autenticador: `tools/verify_auth_browser.cjs`.
- Decodificación de voz segura: `tools/verify_speech_security.py`, ejecutada en
  la imagen de voz con formatos reales generados, sin inferencia ni audio humano.
- Regresiones Python: `tests/test_hardening.py`, además de autenticación, push,
  HTTP, chats, procesos, archivos y ciclo de vida existentes.
- Respaldo privado del código/configuración previo a esta revisión:
  `/srv/platform/backups/codex-dashboard-before-security-20261017-191138/`.
  Incluye respaldo SSH y prueba de igualdad de la configuración de rootai.
  Imagen anterior: `codex-dashboard:before-security-20261017`.
- Actualizar dependencias e imágenes con nuevas revisiones de seguridad y repetir
  las pruebas antes de desplegar. No borrar `.cm-secret` ni `web-auth.sqlite3`.
  No instalar dependencias dentro del contenedor en ejecución: reconstruir la
  imagen. pip/ensurepip se retiraron del runtime deliberadamente.

Fuentes primarias consultadas:
[OWASP WebSocket](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html),
[OWASP CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html),
[seguridad Docker](https://docs.docker.com/engine/security/),
[aviso source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[Trivy oficial](https://trivy.dev/docs/latest/getting-started/installation/).
