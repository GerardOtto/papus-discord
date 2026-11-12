# Preview aislado de la plaza

Este entorno existe para probar la plaza sin desplegar ni modificar el Worker de producción `papus-bots`.

## Aislamiento

- Worker: `papus-plaza-preview` (no comparte nombre con `papus-bots`).
- D1: `papus-plaza-preview` (base nueva; nunca usar el ID de `papus`).
- Durable Objects: namespaces propios del Worker preview, con clases `SalaMundo` y `SalaTrivia`.
- Entry point: `worker/src/preview.ts`. No importa `src/index.ts`, no expone `/interactions/miku` ni `/interactions/luka`, y no programa el cron de producción.
- No contiene tokens de Miku/Luka ni ejecuta el puente Node que aplica recompensas o responde menciones.
- La plaza conserva el OAuth de Discord de Teto para identificar miembros; el secreto se guarda como secreto de Cloudflare, nunca en el repositorio.

## Despliegue reproducible del preview

Hay un workflow manual en `.github/workflows/plaza-preview.yml`, que solo despliega `papus-plaza-preview` desde `feature/plaza-beta`. Para habilitarlo, crear el entorno GitHub Actions `plaza-preview` y configurar estos **Environment secrets**:

- `CLOUDFLARE_API_TOKEN`: token limitado a Workers Scripts y D1 de la cuenta de preview.
- `CLOUDFLARE_ACCOUNT_ID`: cuenta Cloudflare donde vivirá el preview.
- `PREVIEW_D1_DATABASE_ID`: UUID de la base D1 nueva `papus-plaza-preview`.
- `PREVIEW_GUILD_ID`: ID del servidor de Discord.
- `PREVIEW_TETO_CLIENT_ID`: ID de la aplicación OAuth de Teto.
- `PREVIEW_TETO_CLIENT_SECRET`: secreto OAuth de esa aplicación.

El workflow construye ambos clientes (`npm run actividad` y `npm run mundo`), configura el TOML solo durante el job, aplica el esquema a la D1 indicada, carga el secreto y despliega con el archivo exclusivo de preview. No despliega `papus-bots`. Se ejecuta desde Actions → Deploy isolated Plaza preview → Run workflow.

Antes de ejecutar el workflow, la D1 debe existir con el nombre `papus-plaza-preview` y el UUID guardado en `PREVIEW_D1_DATABASE_ID`. El token Cloudflare debe estar limitado a la cuenta correcta. La URL workers.dev la informa Wrangler al finalizar el job.

## Preparación manual (alternativa)

1. Crear una base D1 nueva llamada exactamente `papus-plaza-preview` en la cuenta Cloudflare. Si usas el workflow, guarda su UUID como `PREVIEW_D1_DATABASE_ID` en el entorno GitHub `plaza-preview`.
2. Copiar su UUID en `worker/wrangler.preview.toml`, en `database_id`. No copiar el UUID de `papus`.
3. Aplicar el esquema inicial a esa base nueva desde `worker/schema.preview.sql`:
   `npx wrangler d1 execute papus-plaza-preview --remote --file=worker/schema.preview.sql --config=worker/wrangler.preview.toml`.
4. Sustituir los valores de `GUILD_ID` y `TETO_CLIENT_ID` en `worker/wrangler.preview.toml` por los IDs reales. No modificar el `client_id` de la aplicación de producción.
5. Desde la raíz del repositorio, guardar el secreto OAuth solo en el Worker preview: `npx wrangler secret put TETO_CLIENT_SECRET --config=worker/wrangler.preview.toml`.
6. En el Developer Portal de Discord, añadir el redirect URI exacto:
   `https://papus-plaza-preview.<subdominio>.workers.dev/mundo/api/volver`.
   No eliminar ni reemplazar los redirects que ya usa producción.
7. Construir la plaza: desde la raíz del repo, ejecutar `npm run mundo`.
8. Desplegar exclusivamente con:
   `npx wrangler deploy --config worker/wrangler.preview.toml`.

## Límites funcionales del preview

La plaza permite validar acceso Discord, movimiento, chat, avatares y salas en tiempo real. La trivia en `/actividad/` reutiliza las reglas originales en modo sandbox, sin XP ni escrituras de recompensas. La plaza no procesa menciones a Vocaloids, no sincroniza XP/cuotas, no concede premios y no comparte economía con producción. Las acciones que dependen del bot (por ejemplo, ruleta real) no deben habilitarse como si fueran funcionales.

La trivia existente también se sirve en `/actividad/` desde este Worker preview, reutilizando el mismo pool de preguntas y las mismas reglas de partida. Su Durable Object corre en el namespace propio del preview. En este modo `MUNDO_PREVIEW=1`, la sala no solicita perfiles al bot, no lee ni escribe `actividad_perfiles` y no persiste `actividad_aciertos`: los aciertos muestran 0 XP y no generan recompensas. La trivia puede abrirse desde la zona Escuela de la Plaza mediante `/actividad/?sala=plaza`. En navegador reutiliza la sesión OAuth HttpOnly de la Plaza para identificar al miembro; dentro de Discord conserva el flujo Embedded App. La instancia web `plaza` es compartida entre quienes abren ese enlace. El token sigue siendo HttpOnly y el Durable Object vuelve a comprobar la identidad y pertenencia al servidor. No se expone el token a JavaScript.

## Comprobación antes de desplegar

- [ ] El nombre del Worker es `papus-plaza-preview`.
- [ ] El UUID D1 es distinto de producción.
- [ ] No hay cron configurado.
- [ ] El entry point es `src/preview.ts`, no `src/index.ts`.
- [ ] No hay secretos de Miku/Luka.
- [ ] Los redirects OAuth de producción permanecen intactos.
- [ ] El comando de despliegue usa explícitamente `wrangler.preview.toml`.

No usar `npm run worker:deploy`: ese script registra comandos y cambia los endpoints de interacción de Miku y Luka.
