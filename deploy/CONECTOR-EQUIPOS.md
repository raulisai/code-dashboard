# Code Dashboard → Estado IA: equipos de desarrollo

Estado al 27 de octubre de 2026: implementado y probado localmente. **Todavía no desplegado en https://codex-dashboard.devdj.lat ni vinculado a una cuenta real.**

La web envía una tarea a una computadora con Estado IA. La PC consulta la cola mediante HTTPS, solicita aprobación local por defecto, trabaja en una rama Git aislada y devuelve informe, rama, commit y validación. Puede usar Android SDK, Java y Gradle locales. No necesita abrir Android Studio ni expone terminal, ADB o puertos entrantes de Windows.

## Activar el backend desde el dashboard existente

No necesitas SSH en la PC para usar el conector. El backend debe instalarse una vez en el VPS. Puedes hacerlo desde el chat del agente del propio dashboard, subiendo el parche adjunto a esta guía.

Instrucción para el agente del VPS:

> Instala el conector de equipos del parche adjunto. Lee AGENTS.md y SEMILLA.md y realiza el respaldo autorizado antes de modificar el despliegue. Conserva cambios y credenciales existentes. Comprueba el parche con git apply --check; si la versión del servidor difiere, integra los cambios de app.py, cm/workstations.py, frontend/src/Workstations.jsx y frontend/src/views/Queue.jsx sin reemplazar el árbol por una versión antigua ni desplegar otras funciones accidentalmente. No cambies el acceso de rootai, contraseña, TOTP, proveedor predeterminado ni sesiones web existentes. Ejecuta las pruebas de Python, npm ci, npm test y npm run build. Reconstruye y actualiza únicamente el servicio dashboard con el procedimiento habitual de Compose. Verifica /health y que la API de equipos rechaza clientes sin credencial. Desde una sesión web con MFA debe aparecer Cola → Desarrollar en otra computadora. No generes ni transmitas códigos de vinculación, tokens o contraseñas en el chat: el usuario generará el vínculo desde esa pantalla. Informa el commit desplegado y los resultados.

El cambio es aditivo: `CONFIG_DIR/workstations.sqlite3`, con permisos 600 y creación automática de tablas. No modifica la cola TSV del VPS. Conserva el volumen de configuración e incluye ese SQLite en los respaldos consistentes. Si el frontend encuentra un backend antiguo, avisa que falta actualizarlo. No elimines la autenticación global para vincular equipos.

## Vinculación por web, después del despliegue

1. Entra al dashboard con contraseña y TOTP. Abre **Cola → Desarrollar en otra computadora → Vincular una computadora**.
2. Escribe el nombre de la PC y permite proyectos por nombre en la carpeta base, o restringe una lista de identificadores. No necesitan una carpeta en el VPS.
3. Genera el código de 10 minutos. Se muestra en esa pantalla y no se guarda en el almacenamiento del navegador. No lo pegues en chats ni logs.
4. En Estado IA abre **Conector**, introduce `https://codex-dashboard.devdj.lat` y el código y pulsa **Vincular equipo**.
5. En **Conector → Carpeta base**, selecciona la carpeta local de proyectos, por ejemplo `F:\proyectos`. No hay que registrar cada carpeta. Las asociaciones locales siguen disponibles para nombres distintos o reglas específicas. El servidor nunca decide la ruta de disco.
6. Guarda la conexión y pulsa **Recibir tareas**. La recepción no se activa automáticamente al abrir la app.
7. En la web selecciona computadora, proyecto y agente, escribe la tarea y envíala. En Windows revisa el texto y pulsa **Aprobar esta tarea**. La ejecución sin revisión es opcional y se limita a proyectos y agentes seleccionados localmente.

La cola remota se muestra junto a la del VPS, pero usa almacenamiento y ejecución separados. Una tarea remota no puede caer en el scheduler del servidor.

## Proyectos existentes y nuevos

La web permite **Buscar y crear si falta**, **Solo existente** y **Nuevo**. Se buscan carpetas del primer nivel dentro de la base local, normalizando mayúsculas, guiones y guiones bajos. Las coincidencias ambiguas se rechazan. Nuevo nunca reutiliza una carpeta ni una asociación existente; si falta la carpeta y la PC permite crear, inicializa un repositorio Git nuevo. El código terminado queda visible en la carpeta recién creada, sobre la rama generada. Los proyectos existentes conservan su copia de trabajo intacta. No se convierten automáticamente carpetas existentes sin Git ni se siguen enlaces/junctions fuera de la base.

El alcance de dispositivo `*` significa proyectos por nombre, siempre sujeto a la carpeta base y la autorización local. No es una ruta ni acceso a todo el disco. La cola solo entrega esos nombres si el cliente anuncia la capacidad de carpeta base; los clientes anteriores continúan recibiendo tareas automáticas para sus asociaciones, sin campos desconocidos. SQLite añade de forma transaccional `jobs.project_mode` con valor anterior `auto`; el despliegue debe respaldar la base antes de actualizar.

## Seguridad y recuperación

- HTTPS obligatorio con certificados verificados. El cliente no sigue redirecciones ni envía el token a otro origen.
- Código aleatorio de 256 bits, 10 minutos y primer vínculo exclusivo. Repetir el mismo intercambio recupera una respuesta perdida sin crear otro token.
- Credencial por equipo, revocable y válida por 90 días. Solo hashes en SQLite. Cambiar las credenciales web invalida los dispositivos. El token de PC no permite usar terminal, archivos, ajustes, API del reloj ni otras rutas web.
- En Windows, DPAPI protege el token para ese usuario. En otros sistemas, archivo 0600. Nunca se guardan credenciales en el repo ni se envían tokens de Claude/Codex al dashboard.
- Solo se aceptan proyecto, proveedor e instrucciones. El servidor no puede elegir ruta, shell, modelo, comando de build, credenciales, sandbox o push; se utiliza la configuración local.
- Una tarea por equipo y un ciclo por PC. Asignación temporal exclusiva y clave de idempotencia. Una asignación perdida se marca interrumpida y no se ejecuta otra vez automáticamente.
- El permiso local caduca a los 75 segundos sin latidos válidos, antes de la asignación del servidor (120 segundos). Cancelar o revocar se atiende en el siguiente punto de cancelación, termina el árbol del subproceso y permite limpiar el worktree.
- Los resultados pendientes se conservan y reenvían sin repetir el trabajo. Si la asignación venció, se archivan en la PC como `unacknowledged-<id>.json`; el dashboard conserva el estado interrumpido.
- Los commits permanecen en ramas locales `ia/desarrollo-*`. No se hace push, merge, publicación de APK ni transferencia automática de binarios. El informe identifica el commit para revisarlo.
- La PC debe estar encendida, con usuario y Estado IA activos y recepción habilitada. Si está apagada, la cola espera.

El conector es para tu dashboard de confianza. Un worktree y una lista de proyectos no son una máquina virtual: agentes y scripts de build ejecutan con los permisos del usuario local. Para tareas o repos de terceros, usa una cuenta de desarrollo separada o aislamiento del sistema operativo. No ejecutes Estado IA como administrador.

## Android

Se respetan `JAVA_HOME`, `ANDROID_HOME` y `ANDROID_SDK_ROOT`. Si faltan, el proceso busca el SDK y el Java de Android Studio en ubicaciones habituales, sin cambiar variables del sistema ni copiar `local.properties`. La detección Gradle usa `gradlew.bat` en Windows y `./gradlew` en macOS/Linux; para Android propone `test assembleDebug` y `lintDebug`. Configura comandos explícitos para variantes o módulos distintos. Deben estar instalados los paquetes/licencias SDK del proyecto. Aún no se ha validado una compilación Android real del usuario.

## API y pruebas

Administración web con MFA: `GET/POST /api/workstations`, acciones `enroll`, `enqueue`, `cancel`, `revoke`.

Cliente: `POST /api/workstation/enroll` con código temporal y token generado localmente; `poll`, `heartbeat` y `finish` con Bearer. Las operaciones vuelven a validar el dispositivo para aplicar revocaciones también entre autenticación y operación. Cuerpos JSON acotados; sus contenidos no se registran.

```bash
python -m unittest discover -s tests
cd frontend
npm ci
npm test
npm run build
```

Con ambos repos disponibles, esta prueba usa HTTPS y una CA temporal verificada, un agente falso en un proceso hijo real, Git temporal, aprobación local, tests antes/después y entrega confirmada:

```bash
python tools/verify_workstation_bridge.py --desktop /ruta/a/utilizetokens
```

No usa cuentas, proyectos ni cupo reales. No despliega ni verifica el VPS.
