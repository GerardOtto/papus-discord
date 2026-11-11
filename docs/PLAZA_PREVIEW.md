# Preview aislado de la plaza

Este entorno existe para probar la plaza sin desplegar ni modificar el Worker de producción `papus-bots`.

## Aislamiento

- Worker: `papus-plaza-preview` (no comparte nombre con `papus-bots`).
- D1: `papus-plaza-preview` (base nueva; nunca usar el ID de `papus`).
- Durable Objects: namespaces propios del Worker preview, con clases `SalaMundo` y `SalaTrivia`.
- Entry point: `worker/src/preview.ts`. No importa `src/index.ts`, no expone `/interactions/miku` ni `/interactions/luka`, y no programa el cron de producción.
- No contiene tokens de Miku/Luka ni ejecuta el puente Node que aplica recompensas o responde menciones.
- La plaza conserva el OAuth de Discord de Teto para identificar miembros; el secreto se guarda como secreto de Cloudflare, nunca en el repositorio.

## Preparación manual (no ejecutar en producción)

1. Crear una base D1 nueva llamada exactamente `papus-plaza-preview` en la cuenta Cloudflare.
2. Copiar su UUID en `worker/wrangler.preview.toml`, en `database_id`. No copiar el UUID de `papus`.
3. Aplicar el esquema inicial a esa base nueva desde `worker/schema.preview.sql`:
   `npx wrangler d1 execute papus-plaza-preview --remote --file=schema.sql --config=wrangler.preview.toml`.
4. Configurar el ID del servidor como variable `GUILD_ID` y el ID de la aplicación OAuth de Teto como `TETO_CLIENT_ID` en el Worker preview.
5. Configurar `TETO_CLIENT_SECRET` como secreto del Worker preview.
6. En el Developer Portal de Discord, añadir el redirect URI exacto:
   `https://papus-plaza-preview.<subdominio>.workers.dev/mundo/api/volver`.
   No eliminar ni reemplazar los redirects que ya usa producción.
7. Construir la plaza: desde la raíz del repo, ejecutar `npm run mundo`.
8. Desplegar exclusivamente con:
   `npx wrangler deploy --config worker/wrangler.preview.toml`.

## Límites funcionales del preview

La plaza permite validar acceso Discord, movimiento, chat, avatares y salas en tiempo real. No procesa menciones a Vocaloids, no sincroniza XP/cuotas, no concede premios y no comparte economía con producción. Las acciones que dependen del bot (por ejemplo, ruleta real) no deben habilitarse como si fueran funcionales.

La trivia no se sirve desde este Worker preview: el namespace se declara solo para mantener la compatibilidad de tipos/API compartida. La base preview contiene únicamente las tablas necesarias para la plaza, no las tablas de pedidos, niveles, economía ni actividad de los bots. La integración de la trivia requiere una fase posterior que adapte su cliente y backend sin conectar la base de producción.

## Comprobación antes de desplegar

- [ ] El nombre del Worker es `papus-plaza-preview`.
- [ ] El UUID D1 es distinto de producción.
- [ ] No hay cron configurado.
- [ ] El entry point es `src/preview.ts`, no `src/index.ts`.
- [ ] No hay secretos de Miku/Luka.
- [ ] Los redirects OAuth de producción permanecen intactos.
- [ ] El comando de despliegue usa explícitamente `wrangler.preview.toml`.

No usar `npm run worker:deploy`: ese script registra comandos y cambia los endpoints de interacción de Miku y Luka.
