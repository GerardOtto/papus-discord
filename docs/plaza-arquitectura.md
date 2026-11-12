# Arquitectura de la Plaza

## Principio

La Plaza 3D es una segunda interfaz del servidor de Discord. Discord y la Plaza leen y modifican el mismo estado canónico de Papus. La base D1 configurada en `worker/wrangler.toml` es el transporte y estado compartido de la Plaza; los servicios del bot y su SQLite siguen siendo la autoridad para XP, niveles, cuota, monedas, inventario, ruleta, pesca y mercado.

## Conexión efectiva

- El Worker principal y el Worker de interfaz de Plaza usan el mismo identificador D1 canónico.
- El Worker de Plaza no contiene una economía ni un ledger de usuario alternativo.
- El bot principal crea `MundoPuente` contra el D1 canónico y consulta la cola de acciones cada pocos segundos.
- Los handlers de `MundoPuente` ejecutan `LevelService`, `RouletteService`, `CoinService` y `MercadoService`, es decir, los mismos servicios que atienden Discord.
- Después de una acción confirmada, el puente vuelve a publicar el perfil canónico. Los eventos de Discord se entregan a los clientes conectados.
- La separación del Worker de interfaz mantiene aislados el despliegue, el dominio y los Durable Objects; no separa los datos de Papus.

## Flujo de una acción

1. El cliente se autentica con Discord y envía un comando tipado al Durable Object.
2. El Worker valida identidad, allowlist, tamaño y frecuencia; escribe una solicitud en `mundo_acciones` del D1 canónico.
3. El bot principal reclama la solicitud y ejecuta el handler contra los servicios reales de Papus.
4. El bot persiste el resultado y actualiza el perfil; el Durable Object entrega la respuesta al usuario.
5. La interfaz vuelve a leer los perfiles/eventos compartidos. Un refresco periódico de perfiles activos recoge también cambios originados en Discord.

## Consistencia

- La Plaza no calcula XP, niveles ni saldos.
- El Worker no concede recompensas ni descuenta monedas.
- El backend revalida usuario, datos, permisos, cooldowns y reglas.
- La respuesta de éxito se entrega después de la operación del servicio canónico.
- Los perfiles son snapshots derivados del backend; nunca se usan como fuente de verdad.
- La presencia y las poses pueden ser efímeras. La economía y la progresión permanecen en los servicios de Papus.
- Los endpoints de estado no deben almacenar respuestas en caché, para evitar mostrar snapshots vencidos.

## Despliegue y seguridad

- `papus-plaza-preview` es un Worker separado y su despliegue no publica ni reemplaza `papus-bots`.
- Su binding `DB` se resuelve desde el identificador de `worker/wrangler.toml`; no se acepta una base aislada como sustituto del estado del servidor.
- El workflow no ejecuta migraciones ni crea tablas en D1. El esquema canónico debe estar instalado por el despliegue normal del backend.
- No ejecutar `worker:deploy`, no fusionar este PR y no modificar el despliegue del bot principal desde el workflow de Plaza.

## Criterios de aceptación

- Un cambio de XP, nivel, cuota o ruleta realizado en Discord aparece en los perfiles de la Plaza tras el siguiente ciclo de refresco.
- Una acción iniciada en la Plaza se procesa mediante los mismos servicios y reglas que Discord.
- Dos acciones concurrentes no pueden sobrepasar los límites que imponen los servicios canónicos.
- La reconexión recupera perfiles y eventos actuales desde D1 y los servicios centrales.
- Ninguna recompensa, saldo o inventario se mantiene en un ledger paralelo.
