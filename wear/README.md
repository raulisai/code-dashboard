# Codex en Wear OS — dashboard nativo 0.2

Activación por responsables (agente del VPS y administrador), llaves SSH, Firebase,
despliegue y prueba final: [`deploy/WEAR-OS-ACTIVACION.md`](../deploy/WEAR-OS-ACTIVACION.md).
Rama de trabajo publicada: `Wear-OS`; sincronización con `main` en `.github/WEAR-OS.md`.

Cliente nativo independiente para el Galaxy Watch 7, en el mismo repositorio que el
dashboard. Kotlin + Compose para Wear OS. API específica `/api/wear/*`. Comparte el
chat `_general/main`, el proveedor predeterminado, la continuidad entre proveedores
y la cola existente. No necesita una aplicación propia en el teléfono.

## Experiencia

Al entrar: **Inicio**, con cuota de Claude Code (ventanas de cinco horas/semanal,
porcentaje libre y reposición), actividad real, cola y accesos a **Proyectos**,
**Configuración** y el **Agente general**. Fondo negro y herramientas progresivas;
no se carga la web de escritorio dentro del reloj.

Proyectos permite buscar y abrir cada proyecto. Sus herramientas nativas incluyen:

- Agente: chats existentes, crear/renombrar/borrar, continuidad, proveedor/modelo/
  esfuerzo por mensaje, dictado con revisión, respuesta y actividad reciente.
- Peticiones: estado, detener, reintentar y eliminar de la cola.
- Logs: últimas 60 entradas; terminal shell/Claude/Codex: captura de las últimas
  100 líneas, actualizar, enviar un comando revisado y cerrar la sesión.
- Archivos: exploración por páginas de 40, lectura, edición con versión optimista,
  crear, mover y eliminar. Las vistas recortadas/binarias no se editan.
- Git: estado, diff, historial, versión individual, ramas, guardar versión,
  deshacer, restaurar, revertir, crear/cambiar/integrar/archivar ramas.
- Despliegues: publicar, reiniciar, apagar, compilar y modo desarrollo; salida de
  jobs; estado y controles de contenedores, protegidos con las reglas del dashboard.
- Crear/importar proyectos, destacados, eliminación recuperable y papelera.

Configuración permite cambiar proveedor y modelos predeterminados, permisos,
sandbox y versiones automáticas. Inicio también ofrece servidor y aprobaciones.
Cada acción mutante se revisa y confirma; leer una vista no ejecuta comandos ni
crea una terminal. Los controles llaman a los mismos validadores del dashboard.

Tocar la esfera abre el dictado del sistema. El texto se revisa antes de enviarlo.
También se puede escribir con el teclado del reloj. Ejemplos:

- «¿Cómo va la última tarea?»
- «¿Qué proyectos tenemos?»
- «Trabaja en alpha y corrige el formulario»
- «Ahora revisa cómo quedó»

El agente recibe contexto real reciente y una instrucción de respuesta breve. El
menú secundario permite preguntar por la última tarea, abrir la respuesta,
escucharla, actualizar o abrir las demás secciones. El agente general sigue usando
su proveedor predeterminado; el chat de proyecto usa el proyecto/chat elegido.
Los mensajes comparten la cola del chat principal: si el agente ya está trabajando,
la nueva petición espera su turno. La esfera muestra su actividad mientras tanto.

## Vincular

1. Desplegar primero la versión del backend que incluye `/api/wear/*`.
2. Instalar el APK y abrir **Codex** en el reloj.
3. En una sesión web con contraseña y TOTP completados, abrir **Ajustes → Tu reloj**
   o `/watch` e introducir los ocho caracteres que muestra el reloj.
4. El reloj recibe una sesión propia. Puede revocarse en **Seguridad → Sesiones**
   (etiqueta `Wear OS · Galaxy Watch`) o desde el propio reloj.

El código dura cinco minutos. El secreto de entrega tiene 256 bits y se guarda
hasheado; la sesión se cifra hasta su primer uso. Una respuesta de vinculación
perdida puede recuperarse durante ese intervalo. La aprobación no puede repetirse.
Las credenciales del reloj solo sirven para las rutas nativas autorizadas, incluso si
se intenta utilizarlas como cookie en las demás API. Cambiar la contraseña,
reconfigurar TOTP o revocar sesiones también invalida el reloj.

Credencial, borrador y caché locales cifrados con Android Keystore; sin copias de
seguridad Android. Solo HTTPS con validación normal de certificados; sin WebView,
cookies web, TLS permisivo ni credenciales incluidas en el APK.

## Conectividad y batería

- Consulta al abrir/reanudar una vista y después de acciones. El chat visible
  trabajando se actualiza cada seis segundos; Inicio con trabajo activo cada diez.
  Únicamente **RESUMED**, pausa tras tres fallos. Logs, terminal, archivos y Git
  se actualizan a petición; en reposo no hay consultas periódicas de red.
- Cuota solicitada por separado, con la caché de dos minutos ya existente; un
  proveedor lento no bloquea la navegación ni el resumen de actividad.
- Sin servicio permanente, socket, wake locks propios, sensores ni grabación continua.
- El dictado puede usar los servicios de reconocimiento configurados en el reloj;
  su disponibilidad y tratamiento del audio dependen del sistema. La app no graba
  ni envía audio al VPS; envía la transcripción revisada.
- Estado sin conexión con hora de actualización. Un envío sin confirmación conserva
  el texto y el mismo identificador al reintentar, incluso tras cerrar la app.
- La deduplicación del servidor usa un ID determinista en la cola, también ante un
  corte después de guardar la tarea y antes de responder al reloj.
- Los envíos a proyectos guardan texto, destino, proveedor/modelo/esfuerzo e ID
  juntos antes de la red. Cambiar de proyecto no cambia un envío por confirmar.
  Otras operaciones no se repiten automáticamente si la respuesta se pierde:
  actualizar el estado antes de intentar aplicarlas de nuevo.
- Consumo real y calidad del dictado deben medirse al final en el Watch 7 físico.
  Las pruebas de emulador no equivalen a una medición de autonomía.

## Firebase: configuración opcional pendiente

La conversación no depende de Firebase. El SDK se inicializa únicamente cuando el
servidor entrega una configuración válida. No hay proyecto Firebase de ejemplo ni
clave privada dentro del APK o del repositorio.

Crear una app Android con paquete `lat.devdj.codex.watch` en un proyecto Firebase,
habilitar FCM HTTP v1 y guardar, **en privado**, estos archivos en el directorio de
configuración del backend (`/home/dv1/.config/codex-automation`, montado en `/config`):

`wear-firebase-client.json` (opciones públicas de la app registrada):

```json
{
  "project_id": "ID_DEL_PROYECTO",
  "application_id": "ID_FIREBASE_DE_LA_APP_ANDROID",
  "api_key": "CLAVE_API_DE_LA_APP",
  "sender_id": "NUMERO_DEL_PROYECTO"
}
```

`wear-firebase-service-account.json`: JSON de una cuenta de servicio autorizada para
enviar mensajes FCM en ese mismo proyecto. Permisos de archivo `0600`. Este archivo
nunca se devuelve al reloj. Alternativamente, `WEAR_FCM_CREDENTIALS` permite definir
su ruta dentro del contenedor. Restringir la API key según las instrucciones de
Firebase sin bloquear los servicios necesarios para Firebase Installations/FCM.

Abrir la app del reloj, actualizar y elegir **Avisos → Solo atención** o **También
respuestas**; conceder el permiso del sistema. No hace falta reconstruir el APK.
Predeterminado: solo fallos y solicitudes de aprobación de agentes/proyectos;
opcionalmente también respuestas terminadas. Nunca avisa de cada paso. Un único aviso reemplazable
agrupa eventos acumulados. Firebase recibe solo un título genérico y un marcador,
sin mensajes ni respuestas. Reintentos con espera, deduplicación y baja de tokens
`UNREGISTERED`. Las entregas dependen de conectividad y restricciones del sistema.

## Compilar

Abrir esta carpeta `wear/` en Android Studio. Instalar JDK 25, Android SDK Platform
37 y aceptar las licencias del SDK. `targetSdk=36`, `minSdk=33`; no requiere Wear OS 7
en el dispositivo. Las bibliotecas actuales requieren compilar con API 37.

```sh
cd wear
sh gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
```

En Windows: `gradlew.bat` con `JAVA_HOME` y `ANDROID_HOME` configurados. El wrapper
verifica SHA-256 de la distribución. APK en
`app/build/outputs/apk/debug/app-debug.apk`. Firmado para desarrollo: no es una
publicación en Play Store ni una firma de producción. Conservar el mismo keystore
si se quieren instalar actualizaciones sin borrar la configuración local.

En este equipo se verificó también `tools/build_wear.cmd` (desde la raíz). Usa el
Java de Android Studio, cachés separadas y salida en `%TEMP%\codex-watch-mvp-build`.
Si el SDK tiene Build Tools 36.0.0, usa su AAPT2 como alternativa. Esto evita los
bloqueos de ZIP mapeados que aparecieron al compilar en la unidad F: durante esta
sesión. `WEAR_BUILD_DIR` y `WEAR_JAVA_HOME` permiten elegir otras rutas. Desde
Android Studio también se puede pasar `-PwearBuildDirectory=C:\ruta\de\salida`.

## Pruebas

Backend, en Linux, con los requisitos del repositorio instalados:

```sh
python -m unittest discover -s tests
```

`tests/test_wear.py` comprueba aprobación MFA/Origin, caducidad, alcance de tokens,
cookie, revocación, concurrencia/reintentos, contexto, privacidad y avisos. Las
pruebas de entrega usan un transporte simulado: no demuestran recepción FCM real.

Para las pruebas Android, crear un **Wear OS 6 / API 36, x86_64, circular** desde
Device Manager, arrancarlo y ejecutar:

```sh
adb -s emulator-5580 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5580 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5580 shell am instrument -w lat.devdj.codex.watch.test/androidx.test.runner.AndroidJUnitRunner
```

Ajustar el serial al del emulador. No usar comandos ADB sin serial si hay un reloj
físico conectado. `ConversationTest` y `DashboardTest` utilizan transporte aislado: comprueban UI,
revisión, envío, fallo/reintento, restauración y revocación sin gastar cuota ni crear
trabajo real. Después verificar el flujo HTTPS contra el backend desplegado y
finalmente probar dictado, notificaciones y batería en el reloj físico.

En Windows, `tools/verify_wear_android.cmd emulator-5580 [directorio-de-build]`
instala ambos APK y comprueba el resultado de instrumentación. Rechaza seriales de
dispositivos físicos. Las capturas de `ConversationTest` llevan datos de prueba;
no son respuestas reales de Claude/Codex.

## Límites de la adaptación

Las herramientas son nativas, principalmente vistas compactas. No incluyen una
terminal VT interactiva (se usan captura + comando explícito), renderizado de la
web del proyecto, adjuntos binarios, reproducción multimedia ni presentaciones
HTML/gráficos `cm-ui`. La URL de vista previa se muestra como referencia. La
configuración de credenciales GitHub y seguridad de cuenta/TOTP sigue en la web:
no se distribuyen esos secretos al reloj. Esto amplía el MVP; no representa paridad
visual ni todas las opciones avanzadas de la aplicación de escritorio.

Validación local usa respuestas simuladas para no consumir cuota ni ejecutar
acciones en proyectos reales. Falta publicar el backend y realizar la vinculación
y pruebas de integración reales, Firebase y autonomía física, como pidió el usuario.

## Publicar backend y recuperar

Desde este equipo falta configurar acceso SSH al VPS. Adaptar el bloque de
`deploy/wear-ssh-config.example` en `%USERPROFILE%/.ssh/config`, indicando una llave
local autorizada para `dv1`. No hay que pegar llaves ni contraseñas en `.env` ni
versionarlas. Cuando `ssh codex-dashboard-vps` funcione se podrá completar el
despliegue; no se modificó el acceso de `rootai`.

Antes del despliegue, ejecutar el respaldo autorizado del proyecto en el VPS:
`python3 /srv/platform/bin/backup-codex-dashboard.py`. Conservar el código pendiente
y la imagen anterior. Ejecutar las pruebas, compilar frontend y reconstruir solo
`dashboard` mediante Compose. Verificar `/health`, API anónima 401 y vinculación
con MFA. No reiniciar Docker/Traefik globalmente ni modificar `rootai`.

Las tablas nuevas son aditivas en `web-auth.sqlite3`. Una reversión del código no
requiere borrar sesiones, TOTP ni las tablas. No restaurar una copia antigua de la
base de autenticación sin considerar las sesiones revocadas después del respaldo.

Referencias: [Compose Wear OS](https://developer.android.com/training/wearables/compose),
[energía](https://developer.android.com/training/wearables/apps/power),
[red](https://developer.android.com/training/wearables/data/network-communication),
[FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api).
