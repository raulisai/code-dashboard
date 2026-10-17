# codex-dashboard

Antes de trabajar en este proyecto, lee `SEMILLA.md`: dice qué está hecho, qué falta,
en qué estado está el despliegue y qué decisiones tomó el usuario.

Al terminar tu sesión, actualiza `SEMILLA.md` (secciones 0, 4 y 5) para que el
siguiente agente sepa dónde quedó el trabajo.

## Autonomía autorizada por el usuario

Este VPS es un sandbox de desarrollo autónomo controlado por agentes. Resolver,
probar, reconstruir y desplegar los cambios solicitados sin pedir confirmaciones
rutinarias para comandos, instalaciones, reinicios o correcciones reversibles.
La autorización persiste entre sesiones. Pedir información solo si falta un dato
imprescindible; no pedir de nuevo una autorización ya dada.

Proteger el trabajo con versiones y respaldos recuperables: conservar cambios
ajenos, guardar una copia antes de migraciones o cambios destructivos, validar
antes/después y recuperar automáticamente cuando sea posible. Nunca usar un
reset/clean para descartar trabajo de otros agentes. No borrar datos únicos sin
copia ni modificar la cuenta rootai o su acceso SSH.

Respaldo local: `python3 /srv/platform/bin/backup-codex-dashboard.py`.
El timer `codex-dashboard-backup.timer` lo ejecuta diariamente y conserva las
14 últimas copias automáticas completas. Incluye código pendiente, historial Git
y configuración privada con SQLite consistente. No imprimir ni versionar secretos.
Los respaldos manuales previos se conservan aparte. Consultar SEMILLA.md para
estado y recuperación. Mantener TOTP y sesiones revocables en el acceso web.
