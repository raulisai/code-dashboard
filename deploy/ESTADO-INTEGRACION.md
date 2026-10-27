# Estado conjunto: reloj y conector — 27 octubre de 2026

La rama `Wear-OS` reúne el cliente 0.4 (rediseño, voz, lectura incremental y long
polling), las herramientas del reloj y el conector de equipos con carpeta base,
descubrimiento de proyectos y creación explícita. Conserva la base de main.

Se integran los commits locales de reloj `f58b1b8`, `d62d4cd` y del conector
`39012f3`, `586a721`, `a511b06`. Las ramas originales permanecen conservadas.

## Comprobado desde esta PC

- Suite Python completa en WSL: 212 pruebas aprobadas.
- Frontend: 24 pruebas aprobadas y build correcto.
- Android 0.4: build correcto, 10 pruebas JVM y 18 de interfaz en emulador aprobadas;
  lint con 0 errores y 2 avisos de versiones nuevas. Captura del agente inspeccionada.
  APK de desarrollo: `artifacts/wear-validation/codex-watch-integrated-0.4.0.apk`.
- HTTPS del VPS: `/health` 200; `POST /api/wear/pair/start` 200.
- `POST /api/workstation/enroll` con JSON vacío devuelve 401 de login web: todavía
  no está publicado el backend del conector (debe responder 400 por código inválido).

Los APKs, resultados Android y capturas quedan localmente en
`artifacts/wear-validation/`; no se guardan en Git ni incluyen credenciales reales.

## Instrucción para el agente del VPS

Lee AGENTS.md y SEMILLA.md, ejecuta el respaldo autorizado y conserva cambios
locales, imagen anterior y SQLite consistente. Obtén la rama Wear-OS de origin e
integra sus cambios con el código del servidor, sin reset/clean ni sobrescribir el
árbol. La integración ya incluye reloj y conector; no aplicar parches antiguos
encima de ella. No modificar rootai, TOTP, contraseña ni proveedor predeterminado.

Ejecuta la suite Python y frontend; reconstruye y recrea únicamente dashboard.
Guarda el commit desplegado y comprueba:

1. `/health` responde 200.
2. `POST /api/wear/pair/start` sin credencial y con JSON `{}` responde 200.
3. `POST /api/workstation/enroll` sin credencial y con JSON `{}` responde 400.
4. Las API de estado/datos siguen rechazando clientes sin sesión/credencial.
5. La web con MFA muestra Tu reloj y Cola → Desarrollar en otra computadora.
6. Los archivos Firebase privados están en el volumen correcto y son legibles por
   dashboard. No imprimir sus contenidos ni versionarlos.

No quitar la autenticación global para conseguir estas respuestas: cada tipo de
dispositivo ya tiene sus rutas públicas de alta y su alcance de credenciales.

## Aceptación que todavía requiere pruebas reales

- Vincular el reloj y comprobar dictado, envío, respuesta hablada y reconexión.
- Recepción FCM con pantalla apagada; haber instalado JSON no demuestra la entrega.
- Vincular Estado IA desde la web, habilitar recepción local y ejecutar una tarea
  de prueba en una carpeta autorizada. Conservar aprobación local por defecto.
- Revisar autonomía en Watch 7 y confirmar el commit que realmente ejecuta el VPS.

Guías detalladas: `deploy/WEAR-OS-ACTIVACION.md`, `deploy/CONECTOR-EQUIPOS.md`
y `wear/README.md`. Actualizar SEMILLA secciones 0, 4 y 5 tras el despliegue.
