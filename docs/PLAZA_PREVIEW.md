# Plaza: Worker de interfaz conectado al backend Papus

## Arquitectura

La Plaza es una segunda interfaz del servidor. No tiene una economía ni progresión propia.

- El Worker `papus-plaza-preview` separa el despliegue y los Durable Objects de la interfaz.
- Su binding D1 `DB` usa el mismo identificador configurado en `worker/wrangler.toml`.
- El bot principal ejecuta `MundoPuente.sync()` cada pocos segundos contra ese D1.
- Las acciones se procesan con los servicios canónicos de Papus: niveles/XP, cuota, ruleta, Shaula-coins, tienda, mercado y pesca.
- Los perfiles de usuarios conectados se vuelven a solicitar periódicamente para reflejar también cambios realizados desde Discord.
- La Plaza y Discord reciben eventos desde el mismo backend.

El D1 solo transporta comandos, perfiles públicos, eventos y estado de sala. No contiene una copia de los saldos ni un ledger alternativo de usuario.

## Requisitos

En GitHub Actions, crear el entorno `plaza-preview` y configurar:

- `CLOUDFLARE_API_TOKEN`: token con permisos para desplegar el Worker de interfaz, administrar sus secretos y ejecutar cambios D1 (Workers Scripts Edit, D1 Edit).
- `CLOUDFLARE_ACCOUNT_ID`: cuenta Cloudflare.
- `PREVIEW_GUILD_ID`: ID del servidor.
- `PREVIEW_TETO_CLIENT_ID`: ID de la aplicación OAuth de Teto.
- `PREVIEW_TETO_CLIENT_SECRET`: secreto OAuth de esa aplicación.

No se necesita `PREVIEW_D1_DATABASE_ID`. El workflow obtiene el ID del D1 canónico desde `worker/wrangler.toml`, lo verifica y lo inserta temporalmente en `worker/wrangler.preview.toml`.

## Despliegue de la interfaz

El workflow manual `.github/workflows/plaza-preview.yml`:

1. Ejecuta typecheck, pruebas y builds.
2. Configura el Worker separado `papus-plaza-preview`.
3. Le asigna el D1 canónico de Papus.
4. Carga el secreto OAuth de Teto.
5. Despliega exclusivamente `papus-plaza-preview`.

No crea bases D1 ni despliega `papus-bots`. Antes de publicar la interfaz, aplica únicamente `worker/migrations/0001_mundo_tarjetas.sql` sobre el D1 canónico: es una migración aditiva e idempotente que crea la caché pública de tarjetas y su cola, sin modificar saldos, XP, inventario ni preferencias. El Worker principal no se reemplaza.

La URL de Cloudflare se informa al terminar el workflow. En el Developer Portal de Discord, el redirect OAuth debe incluir:

`https://papus-plaza-preview.<subdominio>.workers.dev/mundo/api/volver`

No reemplaces los redirects existentes.

## Ejecución en producción

El bot principal debe permanecer conectado y ejecutar `MundoPuente.sync()`. Ese proceso consume las solicitudes del D1 canónico y ejecuta las reglas reales. Si el bot principal está detenido, la Plaza puede abrirse y mantener la presencia, pero las acciones que requieren backend quedarán pendientes hasta que el puente vuelva a funcionar.

## Límites actuales

- Las tarjetas públicas están habilitadas mediante `MUNDO_TARJETAS=1`. El Worker las entrega desde una caché de imágenes generadas por el bot principal usando el renderizador de `/nivel`, sin exponer cuota privada.
- El preview no debe usar un D1 independiente para las acciones de Papus.
- No se debe instalar ni ejecutar un segundo proceso Node que consuma la cola de acciones.
- Para desarrollo local, `wrangler dev` usa el D1 local; no lo conectes al D1 remoto por accidente.

## Comprobación

- [ ] El Worker se llama `papus-plaza-preview` y usa `worker/src/preview.ts`.
- [ ] Su binding `DB` coincide con el ID de `worker/wrangler.toml`.
- [ ] El bot principal está conectado y su puente `MundoPuente` está activo.
- [ ] La migración aditiva de tarjetas se aplicó al D1 canónico antes del despliegue.
- [ ] `MUNDO_TARJETAS=1` está activo en el Worker de Plaza.
- [ ] No se ejecutan migraciones ni despliegues del Worker principal desde este workflow.

**No ejecutar `npm run worker:deploy` para publicar esta interfaz:** ese comando despliega el Worker principal y gestiona los endpoints de interacción de los bots.
