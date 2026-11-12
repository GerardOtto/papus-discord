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

La plaza valida acceso Discord, movimiento, chat entre Papus, avatares y salas en tiempo real. La fogata permite ocupar seis troncos compartidos, impide ocupar un asiento dos veces, sincroniza quién está sentado y libera el asiento al levantarse o desconectarse. La trivia en `/actividad/` conserva sus reglas y partidas multijugador, pero sigue sin XP ni recompensas en este preview. La economía de los interactivos usa `mundo_sandbox` en la D1 aislada: al primer uso toma una foto de XP, monedero e inventario desde `papus.sqlite` abierta en SOLO LECTURA; desde entonces guarda en D1 su propio progreso, compras, objetos, consumibles, tiradas y enfriamientos. La Tienda Shaula permite comprar los artículos de la vitrina vigente con la misma prioridad de pago (monedas compradas y luego ganadas; los renders solo con ganadas). El Mercado Negro respeta su horario y rotación, cobra únicamente monedas ganadas y persiste usos de consumibles y artículos permanentes. La pesca aplica 5 %, 10 % o 20 % de la barra que falta al siguiente nivel, según el tamaño, y persiste la XP sandbox y su enfriamiento. El Micrófono de Meiko se puede activar desde el Mercado Negro: consume un uso del ledger sandbox, reduce a 60 minutos la misión de voz del día y puede habilitar la tirada correspondiente sin alterar el registro real de voz. El Disquete de Adachi Rei conserva en el ledger sandbox las tiradas no usadas al cerrar cada día, a partir de la compra registrada en ese entorno. El Atún de Luka permite descartar el premio de un giro y volver a sortearlo hasta dos veces, consumiendo un uso por giro con descartes; el giro pendiente y su reversión se conservan en el ledger incluso al recargar el proceso. La ruleta consulta las misiones reales, consume las tiradas disponibles del día en el ledger sandbox y aplica el premio al progreso de prueba (XP, sobres o cuota simulada). El resultado se conserva entre sesiones y pestañas mediante compare-and-swap en D1. Nada de esto escribe en `papus.sqlite`, `papus`, el D1 de producción, la XP real, el monedero real ni el inventario real. El resto de los consumibles se puede comprar y conservar en el inventario sandbox, pero sus efectos aún no están implementados en la Plaza. Los efectos de trivia (Baguette, Celular, Zanahoria y Guitarra), además de otros consumibles ligados a bodas, sobres, apuestas o acciones sociales, siguen pendientes de integración sandbox. Los roles/efectos que dependen de Discord o de Vocaloids no se ejecutan fuera de este sandbox. El preview no procesa menciones a Vocaloids ni comparte economía con producción.

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


## Tarjetas de nivel en el preview

La Plaza puede mostrar la misma tarjeta que genera `/nivel`, sin incluir la cuota diaria ni las tiradas privadas. El panel de la ruleta muestra el avance de las misiones consultadas desde SQLite de solo lectura, pero permite girar en el ledger sandbox: las tiradas, premios de XP, sobres y cuota simulada persisten en D1 preview y no afectan recursos reales.
La generación se ejecuta bajo demanda en el proceso Node del puente preview y almacena temporalmente la imagen en el D1 aislado del preview.

Para habilitar el puente en el equipo donde se ejecuta el bot, agrega al `.env`:

```dotenv
PLAZA_PREVIEW_D1_DATABASE_ID=<ID de la base papus-plaza-preview>
```

El puente reutiliza `CLOUDFLARE_DEPLOY_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, pero solo escribe en el ID explícito anterior. Si la variable no existe, no se conecta al preview. Además de las tarjetas, el puente procesa los interactivos de la plaza y guarda sus cambios en `mundo_sandbox` dentro de ese D1. La base `papus.sqlite` se abre en modo lectura; el ledger sandbox no la modifica. No cambies `worker/wrangler.toml` ni ejecutes el despliegue de producción.

Las tarjetas se generan bajo demanda y se cachean durante 60 segundos en D1. La tarjeta propia solicitada con ⭐ o P se distribuye a todos los Papus conectados a esa misma sala y aparece sobre su personaje durante tres segundos; al pulsar el nombre de otro Papu se abre su tarjeta completa. Cada navegador mantiene una caché en memoria de hasta 12 tarjetas: 60 segundos de frescura y hasta 5 minutos de uso stale mientras se actualiza. La imagen pública excluye la cuota diaria. El Worker sirve directamente desde D1 las tarjetas frescas para evitar esperar el polling del puente.

## Puente aislado de tarjetas (sin tocar el bot de producción)

Mientras la beta no se fusione, las tarjetas las genera un proceso aparte (`scripts/plaza-tarjetas.ts`,
`src/mundo/tarjetas-preview.ts`), no el proceso `papus`:

- Lee `papus.sqlite` en **solo lectura** (`readOnly` + `PRAGMA query_only`): no migra ni escribe.
- Lee nombres y avatares de Discord solo por REST con el token de Teto (sin segunda sesión de gateway).
- Escribe únicamente en el D1 `PLAZA_PREVIEW_D1_DATABASE_ID`; se niega a arrancar sin él o si es el de producción.
- No responde menciones ni publica chat. Atiende `ruleta.estado`, `ruleta.girar`, `pesca.capturar`, `tienda.estado`, `tienda.comprar`, `mercado.estado`, `mercado.comprar` y `mercado.usar` (Micrófono de Meiko). Las compras, recompensas y consumos se aplican solo al ledger sandbox persistente en D1; no consumen ni modifican recursos reales.

Prueba sin D1 (dibuja una tarjeta a un archivo):

```
PAPUS_ENV_FILE=../papus-discord/.env PLAZA_DATA_DIR=<carpeta con papus.sqlite> PLAZA_PREVIEW_D1_DATABASE_ID=<uuid> npm run plaza:tarjetas -- --probar=<id> --salida=tarjeta.png
```

En la VM (servicio `papus-plaza-preview`, plantilla en `nube/plaza-preview.service`): código en
`~/papus/plaza-preview` (enlace a `~/papus/app/node_modules`), variables en `~/papus/plaza-preview/preview.env`
(`PLAZA_PREVIEW_D1_DATABASE_ID`, `PLAZA_DATA_DIR=/home/papus/papus/app/data`, `PAPUS_ENV_FILE=/home/papus/papus/app/.env`).
Limitado a 260 MB y 50 % de CPU, sin escritura en `~/papus/app` y sin arranque automático. Si el proceso se acerca de nuevo al límite, optimizar memoria antes de solicitar otro aumento.

El workflow de GitHub actualiza el Worker Cloudflare, pero no reemplaza el código del proceso systemd de la VM. Después de actualizar esta rama, sincroniza el código de `feature/plaza-beta` en `~/papus/plaza-preview` y reinicia únicamente el puente aislado:

```bash
sudo systemctl restart papus-plaza-preview
journalctl -u papus-plaza-preview -n 80 --no-pager
```

Comprueba que el log indique `mundoPreview listo` y que no haya errores al inicializar `mundo_sandbox`. No reinicies `papus`, no cambies `~/papus/app` y no ejecutes el despliegue del Worker de producción. El puente lee las misiones y restricciones con `LevelService`, `StrikeStore` y `RouletteService` sobre SQLite de solo lectura. Las acciones de ruleta y pesca se resuelven mediante `EconomiaPlazaPreview`: consumen tiradas sandbox, aplican premios al progreso de prueba y respetan bloqueos/cooldowns; las compras de tienda y mercado también se guardan en el ledger aislado. No se ejecutan efectos externos de Discord/Vocaloids ni se modifica el estado real.

```
sudo install -m 644 ~/papus/plaza-preview/nube/plaza-preview.service /etc/systemd/system/papus-plaza-preview.service
sudo systemctl daemon-reload && sudo systemctl start papus-plaza-preview
journalctl -u papus-plaza-preview -f      # "✔ mundoPreview listo" y "✔ tarjeta de <id>"
```

Revertir: `sudo systemctl stop papus-plaza-preview && sudo rm /etc/systemd/system/papus-plaza-preview.service && sudo systemctl daemon-reload && rm -rf ~/papus/plaza-preview`.
`nube subir` no toca esta carpeta; antes de `nube volver` o `trasladar`, detener el servicio.
