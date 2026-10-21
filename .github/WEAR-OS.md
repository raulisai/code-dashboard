# Sincronización de Wear-OS

`main` es la base compartida. `Wear-OS` conserva la aplicación nativa y las API del
reloj, e incorpora los cambios nuevos de `main` mediante merges, sin force push.

El workflow `Sync main into Wear-OS` vive también en `main`: se ejecuta después de
cada push a esa rama, cada hora (minuto 17) y bajo demanda desde GitHub Actions.
La comprobación horaria recupera eventos omitidos, aunque GitHub puede retrasar
ejecuciones programadas. No necesita el equipo local encendido ni una llave SSH:
usa el `GITHUB_TOKEN` temporal con permiso `contents: write`.

Si `main` ya está incluido no crea commits ni instala dependencias. Si hay cambios,
los integra y ejecuta las pruebas aisladas de backend, autenticación, chats y Wear
antes de publicar el merge. No integra Wear-OS en main ni despliega el VPS.

Los conflictos o fallos dejan la rama remota intacta y la ejecución en rojo. Revisar
el log y resolver conservando el código de ambas ramas; no utilizar «ours/theirs»
global, reset ni force push para ocultar el conflicto. Una publicación simultánea
en Wear-OS puede rechazar el push; la siguiente ejecución recupera el nuevo estado.
Las pruebas de backend no sustituyen compilar el APK y verificar UI/contratos nuevos.

Para comprobar y sincronizar manualmente desde un árbol limpio:

```sh
git fetch origin
git switch Wear-OS
git merge --ff-only origin/Wear-OS
git merge origin/main
# Ejecutar las pruebas y resolver conflictos si los hay.
git push origin Wear-OS
git rev-list --left-right --count origin/main...origin/Wear-OS
```

El primer número debe ser cero: ningún commit de main falta en Wear-OS. No significa
que ambas ramas deban tener el mismo contenido; el segundo número incluye los
cambios propios del reloj.

Mantener GitHub Actions habilitado y permitir escribir contenido a este workflow.
Si se protegen ramas, adaptar las reglas para permitir esta sincronización; el
workflow no elude reglas de protección ni resuelve conflictos automáticamente.
