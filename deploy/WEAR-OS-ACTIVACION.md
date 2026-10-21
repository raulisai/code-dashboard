# Primera versión operativa: tareas del agente del VPS y del administrador

Repositorio: https://github.com/raulisai/code-dashboard · rama de la app: `Wear-OS`.
Backend: `https://codex-dashboard.devdj.lat` · paquete Android: `lat.devdj.codex.watch`.
El código 0.2 y las pruebas locales están terminados. Faltan despliegue, Firebase
real y pruebas de integración con el usuario. No asumir que ya se aplicaron estos pasos.

## 1. Qué hace cada uno

| Tarea | Responsable | Resultado que entrega |
|---|---|---|
| Respaldo, integrar rama, pruebas, build y despliegue | Agente del VPS | Commit desplegado y comprobaciones |
| Crear llave de acceso del VPS a GitHub, si hace falta | Agente del VPS | Solo la llave pública `.pub` |
| Registrar esa pública como Deploy key en GitHub | Administrador | Acceso al repo concedido |
| Crear llave de esta computadora para entrar al VPS | Administrador en su PC | Solo su pública al agente del VPS |
| Añadir esa pública a `authorized_keys` de `dv1` | Agente del VPS | Acceso local verificado sin tocar otras llaves |
| Crear proyecto/app Firebase y autorizar cuenta de servicio | Administrador | Dos JSON por canal privado al VPS |
| Instalar JSON, permisos y verificar registro FCM | Agente del VPS | Avisos preparados sin exponer la clave privada |
| Vincular mediante contraseña y TOTP | Administrador | Reloj vinculado y sesión revocable |
| Integración real, notificaciones y autonomía del Watch 7 | Ambos, al final | Resultado de aceptación |

No hay que crear otro usuario ni modificar `rootai`. Tampoco cambiar contraseña,
factor TOTP, sesiones existentes, proveedor o llaves que ya funcionan para activar Wear.

## 2. Instrucciones para copiar a tu agente dentro del servidor

> Lee AGENTS.md y SEMILLA.md. Activa la rama Wear-OS conservando cambios ajenos y
> credenciales existentes. Haz primero el respaldo autorizado. Puedes crear una llave
> dedicada para acceder a GitHub, pero entrega únicamente su pública al administrador.
> Las privadas deben quedar fuera del repositorio. Ejecuta pruebas, construye y publica
> solo dashboard, verifica la autenticación y documenta commit, respaldo y resultados.
> No cambies rootai, TOTP ni SSH global. Si faltan archivos Firebase, termina el
> despliegue sin push y enumera exactamente los dos archivos que faltan. No inventes claves.

### 2.1 Respaldo e inventario

Como `dv1` en el VPS:

```bash
cd /srv/projects/codex-dashboard
python3 /srv/platform/bin/backup-codex-dashboard.py
git status --short
git branch --show-current
git log -1 --oneline
docker compose ps
```

Anotar la ruta real que devolvió el respaldo. Conservar también la imagen actual de
dashboard con una etiqueta de recuperación antes de reconstruir. El agente debe
resolver sus cambios locales mediante commits selectivos/merge, después del respaldo;
no ejecutar reset/clean ni borrar el árbol. No versionar `.env` o archivos privados.

### 2.2 Llave VPS → GitHub, solo si necesita acceso privado o push

El repositorio es público: para `git fetch` por HTTPS no hace falta llave. Para subir
cambios desde el VPS, reutilizar primero el acceso GitHub autorizado que ya exista.
Si hace falta uno nuevo, ejecutar como **dv1**, no como root:

```bash
install -d -m 700 /home/dv1/.ssh
if [ ! -e /home/dv1/.ssh/code-dashboard-github ] &&
   [ ! -e /home/dv1/.ssh/code-dashboard-github.pub ]; then
  umask 077
  ssh-keygen -t ed25519 -f /home/dv1/.ssh/code-dashboard-github \
    -N '' -C 'codex-dashboard-vps'
fi
chmod 600 /home/dv1/.ssh/code-dashboard-github
chmod 644 /home/dv1/.ssh/code-dashboard-github.pub
cat /home/dv1/.ssh/code-dashboard-github.pub
```

La clave sin frase queda dedicada a automatización en este servidor; limitar su
alcance con una Deploy key del repositorio. No copiar la privada a una carpeta del
proyecto, el chat, un artefacto descargable ni Git. La carpeta correcta es `.ssh` de
`dv1`. El `.pub` sí se puede entregar al administrador.

Administrador: GitHub → repositorio → **Settings → Deploy keys → Add deploy key**.
Pegar la pública. Activar **Allow write access** solo si ese agente va a subir commits;
la lectura para despliegue no lo necesita. [Guía oficial de Deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

El agente añade este bloque a `/home/dv1/.ssh/config`, preservando lo existente:

```sshconfig
Host github-code-dashboard
    HostName github.com
    User git
    IdentityFile /home/dv1/.ssh/code-dashboard-github
    IdentitiesOnly yes
```

Comprobar la huella del host contra las [huellas oficiales de GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
antes de aceptar una nueva entrada; no desactivar StrictHostKeyChecking. Después:

```bash
ssh -T git@github-code-dashboard
git ls-remote git@github-code-dashboard:raulisai/code-dashboard.git refs/heads/Wear-OS
```

`ssh -T` puede devolver código 1 aun cuando GitHub confirme autenticación; la
comprobación útil es `git ls-remote`. Mantener `origin` HTTPS si se desea y configurar
solo el push con `git remote set-url --push origin git@github-code-dashboard:raulisai/code-dashboard.git`.

### 2.3 Incorporar el código y publicar

Con los cambios locales ya protegidos e integrados por el agente:

```bash
cd /srv/projects/codex-dashboard
git fetch origin
# Si Wear-OS ya existe localmente:
git switch Wear-OS
# Si no existe, usar en su lugar: git switch -c Wear-OS --track origin/Wear-OS
git merge --ff-only origin/Wear-OS
git merge origin/main
git merge-base --is-ancestor origin/main HEAD

python3 -m venv /tmp/codex-wear-validation-venv
/tmp/codex-wear-validation-venv/bin/python -m pip install -r requirements.txt
PYTHONPATH=.:tests /tmp/codex-wear-validation-venv/bin/python -m unittest \
  test_wear test_general test_auth_security test_http test_push test_chats test_availability

docker compose build dashboard
docker compose up -d --no-deps --wait --wait-timeout 90 dashboard
docker compose ps dashboard
curl --fail --silent --show-error https://codex-dashboard.devdj.lat/health
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://codex-dashboard.devdj.lat/api/wear/view?view=home
```

`/health` debe responder `ok`; la vista sin credencial debe devolver **401**.
Ante error de pruebas o build, corregir antes de publicar. Si falla el servicio
nuevo, recuperar código/imagen del respaldo sin restaurar por defecto una SQLite
vieja que pudiera resucitar sesiones revocadas. No reiniciar Docker ni Traefik
globalmente, no apagar speech ni otros proyectos.

Dockerfile compila el frontend dentro del build. La suite indicada no necesita
mandar peticiones a un modelo ni consumir cuota. Las pruebas completas de host/Git/
Docker adicionales deben ejecutarse en un entorno aislado, no sobre proyectos reales.

## 3. Tus tareas fuera del servidor, como administrador

### 3.1 Llave PC → VPS, si quieres que trabajemos desde esta computadora

Es otra llave distinta de la anterior. En PowerShell de Windows:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\codex-dashboard-vps" -C "admin-code-dashboard"
Get-Content "$env:USERPROFILE\.ssh\codex-dashboard-vps.pub"
```

Si ese archivo ya existe, conservarlo y reutilizarlo; no aceptar sobrescribirlo.
Elegir una frase de contraseña para uso personal. Mandar **solo el `.pub`** al
agente que ya está dentro del VPS. La privada se queda en tu computadora. Ver
[gestión de llaves OpenSSH en Windows](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement).

El agente agrega esa línea pública a `/home/dv1/.ssh/authorized_keys`, sin truncar
el archivo ni quitar llaves, con carpeta 700/archivo 600 y propietario `dv1`.
Primero conserva copia del archivo. No necesita crear una llave privada en el VPS
para que tu computadora entre: necesita autorizar la pública creada en tu PC.

Adaptar `deploy/wear-ssh-config.example` en `%USERPROFILE%\.ssh\config` y probar:

```powershell
ssh codex-dashboard-vps
```

Comparar la primera huella con la que el agente obtiene mediante
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. El servidor y la PC pueden
trabajar por separado; este acceso no es requisito para que el reloj funcione.

### 3.2 Crear Firebase para notificaciones directas

1. Crear o elegir un proyecto en Firebase Console.
2. Registrar una app **Android** con paquete exacto `lat.devdj.codex.watch`.
3. Habilitar la API **Firebase Cloud Messaging HTTP v1** en ese proyecto.
4. Crear una cuenta de servicio dedicada y conceder el rol **Firebase Cloud
   Messaging API Admin** (`roles/firebasecloudmessaging.admin`), o un rol personalizado
   con el permiso necesario `cloudmessaging.messages.create`. No hace falta Owner.
5. Generar su llave JSON y transferirla al VPS por un canal privado. Si la política
   de la organización no permite llaves, no eludirla: habrá que adaptar el backend
   para usar identidad de carga/credenciales del entorno.

Referencias: [envío HTTP v1 de Firebase](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
y [roles y permisos de FCM](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging).

Crear también `wear-firebase-client.json`, con estos cuatro valores de la app real:

```json
{
  "project_id": "ID_DEL_PROYECTO_FIREBASE",
  "application_id": "ID_FIREBASE_DE_LA_APP_ANDROID",
  "api_key": "API_KEY_DE_LA_APP_ANDROID",
  "sender_id": "NUMERO_DEL_PROYECTO_FIREBASE"
}
```

Si usas `google-services.json`, corresponden a `project_info.project_id`,
`client[].client_info.mobilesdk_app_id`, `client[].api_key[].current_key` y
`project_info.project_number`, seleccionando el cliente de `lat.devdj.codex.watch`.
`application_id` es el ID Firebase (normalmente `1:…:android:…`), no el paquete Android.

### 3.3 Instalación privada que hace el agente del VPS

Los dos archivos finales deben quedar así:

| En el host VPS | Dentro del contenedor |
|---|---|
| `/home/dv1/.config/codex-automation/wear-firebase-client.json` | `/config/wear-firebase-client.json` |
| `/home/dv1/.config/codex-automation/wear-firebase-service-account.json` | `/config/wear-firebase-service-account.json` |

El agente los instala con propietario `dv1`, permisos **0600**, y comprueba que el
usuario UID 1002 del dashboard pueda leerlos a través del montaje existente. No
publicar el JSON privado, imprimirlo en logs ni sustituir archivos TOTP o `.cm-secret`.
No se necesita `google-services.json` dentro del APK: esta app recibe las opciones
del backend después de vincular. No requiere reconstruir el APK para añadir FCM.

Con esas rutas **no hay variable nueva obligatoria**. La ruta alternativa opcional
se configura en el `.env` privado del VPS, ya cargado por Compose:

```dotenv
WEAR_FCM_CREDENTIALS=/config/wear-firebase-service-account.json
```

Si se cambia el entorno, recrear solo dashboard. No copiar `.env.example` encima del
`.env` existente: contiene ejemplos que sustituirían contraseña y ajustes reales.
Las llaves SSH no van en `.env`.

## 4. Prueba final y criterio de «primera versión operativa»

Primero contra el emulador y el backend publicado; el Watch 7 físico se usa al final:

1. Instalar el APK 0.2 con el mismo firmante; si se recompila, conservar el keystore
   para poder actualizar sin borrar la sesión. El APK actual es de desarrollo;
   publicar en Play Store o distribuir una release firmada es un paso independiente.
2. Abrir Codex → copiar el código → web con contraseña/TOTP → Ajustes → Tu reloj.
3. Inicio muestra cuota real o un error explícito; Proyectos coincide con el catálogo.
4. Consultar logs, terminal y archivos de un proyecto de prueba. Probar un comando
   inocuo (`pwd`) con revisión, edición de un archivo de prueba y control de versión.
5. Mandar una petición pequeña al agente general y otra al chat de ese proyecto;
   comprobar continuidad, respuesta real y reintento sin duplicación tras perder red.
6. Activar Avisos en el reloj, conceder el permiso Android y generar un evento de
   prueba. Comprobar recepción con pantalla apagada y sin la app en primer plano.
   No basta con que el servidor haya aceptado el token FCM.
7. Revocar la sesión de un dispositivo de prueba y confirmar que ya no accede;
   volver a vincularlo. Probar dictado, desconexión/reconexión y texto grande.
8. En el Watch 7 físico, comprobar legibilidad, dictado, avisos y autonomía con uso
   real. No declarar ahorro de batería medido basándose solo en el emulador.

El agente debe entregar: commit y rama desplegados, respaldo recuperable, estado
healthy, resultados HTTP/auth, prueba real de mensajes y FCM, archivos pendientes
sin contenidos secretos y actualización de SEMILLA.md (secciones 0, 4 y 5).

## 5. Homologación de ramas

La sincronización `main → Wear-OS` está en `.github/workflows/sync-wear-os.yml` y
se documenta en `.github/WEAR-OS.md`. Corre al publicar en main y cada hora. GitHub
Actions debe seguir habilitado. No cambia el VPS automáticamente. Si hay conflictos
o fallan las pruebas, detener la publicación y corregirlos: no sacrificar el trabajo
de una rama para aparentar sincronización.
