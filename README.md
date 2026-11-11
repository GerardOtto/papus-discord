# papus-discord

Bots y automatización del servidor de Discord de los Papus (canal Vocaloid de GyroP): Teto, Miku, Luka y Neru, más
Gakupo, Kaito, flower, IA, Haku, Gumi, Rin, Len, Meiko, Adachi Rei y Ruko, que solo conversan.

- Plan y decisiones: [docs/PLAN.md](docs/PLAN.md)
- Reglas para trabajar en el repo: [CLAUDE.md](CLAUDE.md)

## Uso
1. Copiar `.env.example` a `.env` y completar los tokens de los 4 bots, las claves de las APIs y (opcional) los tokens de
   los Vocaloids de conversación: el que no tenga token simplemente no se conecta.
2. `npm install`
3. `npm run check` revisa `.env`, datos del motor y APIs; `npm run check -- --llm` además prueba la personalidad
   de los 4 personajes en cada API (se puede pasar un mensaje: `npm run check -- --llm "hola Teto"`).
4. `npm start` conecta los bots. `npm test` corre las pruebas.
5. `npm run conversaciones [-- --desde AAAA-MM-DD | --horas N]` exporta las conversaciones con los Vocaloids (solo
   lectura, Papus con seudónimo) a `data/revision/` para buscar alucinaciones y refinar las fichas. Además deja
   `general-<fecha>.md`: **todo #general** y sus hilos con nombres reales, y arriba lo que en otro canal habría sido
   sanción, para moderar a mano el canal de lenguaje libre (`/advertir`, `/machetazo`, `/machetazos`). Borrar los informes al terminar.

## Agregar un Vocaloid de conversación (Discord Developer Portal)
Para cada uno (hoy faltan Rin, Len, Meiko, Adachi Rei y Ruko; el código ya los tiene):
1. https://discord.com/developers/applications → **New Application** con su nombre (ej. "Rin", "Adachi Rei").
2. **Bot** → Reset Token y copiarlo a `.env` (`DISCORD_TOKEN_RIN`, `_LEN`, `_MEIKO`, `_ADACHIREI`, `_RUKO`). Sin intents
   privilegiados (solo usan `Guilds`: Neru lee los mensajes por todos). Desactivar **Public Bot**.
3. **OAuth2 → URL Generator**: scope `bot` (sin `applications.commands`: no tienen comandos) y permisos Ver canales,
   Enviar mensajes, Enviar mensajes en hilos, Insertar enlaces, Adjuntar archivos, Añadir reacciones y Leer el historial
   (permissions=`274878024768`). Abrir la URL e invitarlo al servidor.
4. `npm run servidor` (vista previa) y luego `npm run servidor -- --apply`: le da el rol **🎤 Coro** (y se lo quita a
   Vocaloids si lo tenía) y lo deja al final de la lista de miembros.
5. `npm run perfiles -- rin` (avatar, banner y biografía de `assets/bots/` y `content/perfiles.json`) y reiniciar los bots.

## Mango9374 (el que imita a un Papu)
Bot de broma (PLAN §4): a cada @ (sin límite) le da al Papu sus números del día (cuota gastada, XP, mensajes enviados y con
qué Vocaloids no se puede casar ahora) y, 1 de cada 3 veces, contesta "Sea serio ve", "Poco serio ve" o "See you in the
next reel, tetolovers". A GyroP le da los totales del servidor.
1. Developer Portal → **New Application** "Mango9374" → **Bot** → Reset Token y copiarlo a `.env` (`DISCORD_TOKEN_MANGO9374`).
   Sin intents privilegiados; desactivar **Public Bot**.
2. Invitarlo con la misma URL que los Vocaloids de conversación (scope `bot`, permissions=`274878024768`).
3. Darle **a mano** el rol 🎤 Coro (así ve y escribe en todos los canales; `npm run servidor` no lo toca porque no es un Vocaloid).
4. Reiniciar los bots: al conectarse copia la foto de perfil del Papu Mango9374 (por su id) y se pone el nombre "Mango9374"
   (`config/mango.json`: nombre, usuario real y frases). Si Discord rechaza el cambio, avisa en #registro-bots.

## Qué se edita sin tocar código
| Archivo | Qué contiene |
|---|---|
| `content/personajes/*.md` | Instrucciones de personalidad (comunes y de cada bot). Los datos de lore vienen del motor. |
| `content/lore-extra.json` | Datos de los Vocaloids de conversación que el motor no tiene (Gakupo, IA, Haku, flower, Ruko; de Ruko también nombre y color, en `display`). Si el motor los agrega, manda el motor. |
| `content/frases/*.json` | Frases fijas por bot y situación (30-40 por grupo, sin repetir). |
| `config/bodas.json` | Bodas con las Vocaloids (PLAN §3.2): qué chicas juegan (nombre y corazón del rol), cuántas adivinanzas al día y a qué hora (México), intentos, minutos, duración de la boda, días sin repetir esposa y la XP de regalo. |
| `content/bodas.json` | Adivinanzas de cada chica con sus respuestas aceptadas (la primera es la que se revela). Las revisa el código, nunca el LLM. |
| `config/moderacion.json` | Listas de insultos, groserías muy fuertes, odio, estafas, enlaces permitidos y límites. AutoMod se sincroniza al arrancar. |
| `config/llm.json` | Cadena de LLM: el modelo local (Ollama) y las APIs gratuitas (modelo, límite diario estimado, tiempo máximo). El orden de cada petición lo decide `src/llm/router.ts`: el local primero si la GPU está libre y no está respondiendo a otro Papu; si no, las APIs, de la que más le queda en el día a la que menos. |
| `config/ollama/*.Modelfile` | Modelos locales con su ventana de contexto. Crear o actualizar: `ollama create papus-gemma -f config/ollama/papus-gemma.Modelfile`. Comparar modelos: `npm run bench:local -- <modelo> [otro]`. |
| `config/engine-paths.json` | Rutas de los datos del motor (solo lectura). |
| `config/servidor.json` | Categorías, canales (con emoji), quién los ve y quién escribe, roles y seguridad. `npm run servidor` muestra los cambios; `npm run servidor -- --apply` los aplica (Teto necesita Administrador mientras corre). Nunca borra. |
| `content/canales.json` | Mensaje fijado de guía de cada canal y qué Vocaloid lo firma. `npm run guias -- --apply` publica o **edita** (no duplica). Imágenes: `python scripts/make_reactions.py`. |
| `content/perfiles.json` | Biografía de cada bot. Avatares y banners: `npm run avatares` (elige la cara en `SPEC` de `scripts/make_avatars.py`); se aplican con `npm run perfiles`. Figuras del podio de `/ranking`: `python scripts/make_avatars.py --figuras` (pose en `SPEC` → `figura`). |

## Shaula-coins (tienda)
Moneda para adornar la tarjeta de nivel (PLAN §3.6). Menú en #🪙・tienda-shaula; los pedidos de monedas llegan a
#🧾・registro-compras para que GyroP confirme si llegó el pago.

| Archivo | Qué contiene |
|---|---|
| `config/monedas.json` | Economía: cuánto se gana, sobres y garantías, precios, Ecos, paquetes (USD y CLP), regalo de membresía, vitrinas, temporada en curso, canales y fundadores. |
| `config/objetos.json` | Objetos de cada temporada (tipo, rareza, si es arte propio o render, animado, limitado). Miniaturas del arte propio: `npm run coleccion`. |

Variables de `.env` (nunca en el repo): `PAYPAL_ME_USUARIO` (link paypal.me de GyroP) y, para la transferencia en
Chile, `TRANSFERENCIA_BANCO`, `TRANSFERENCIA_TIPO`, `TRANSFERENCIA_NUMERO`, `TRANSFERENCIA_RUT`, `TRANSFERENCIA_NOMBRE`
y `TRANSFERENCIA_CORREO`. Sin ellas, esa forma de pago no aparece.

## Trivia multijugador (Actividad de Discord)
La trivia se abre dentro de un canal de voz (🚀 Actividades → Teto). Corre en el worker de Cloudflare (PLAN §3.4).
`npm run actividad` arma el pool (todas las preguntas de `/trivia`; `-- 50` para uno de prueba) y la página; `npm run worker:deploy` lo hace solo y lo sube. Arte con la estética del canal (plantillas del motor): `npm run actividad:arte` (deja `assets/actividad/web/`); vista previa sin desplegar, con capturas: `npm run actividad:vista` (`data/actividad-vista/`).

Una sola vez, en el [Developer Portal](https://discord.com/developers/applications) → app de **Teto**:
1. **OAuth2** → copiar el *Client Secret* a `.env` como `TETO_CLIENT_SECRET`, y agregar el redirect `https://127.0.0.1`.
2. **Activities → URL Mappings**: raíz `/` → `papus-bots.<subdominio>.workers.dev/actividad` (el que imprime el despliegue).
3. **Activities → Settings**: activar *Enable Activities*.
4. `npm run worker:deploy` (sube el secreto y la página) y reiniciar los bots en la nube (Teto aplica la XP).

Probar sin Discord: `cd worker`, `npx wrangler d1 execute papus --local --file=schema.sql --yes` (una vez) y `npx wrangler dev --var ACTIVIDAD_PRUEBA:1 --var GUILD_ID:1` y abrir
`http://127.0.0.1:8787/actividad/` en dos pestañas (`?sala=x` para compartir sala).

### Plaza de los Papus (mundo 3D, PLAN §3.10)
Mundo low-poly donde cada Papu camina, corre (Shift), anda en patineta (M), personaliza su personaje (🎨) y habla con
burbujas sobre la cabeza (chat filtrado por las reglas fijas de Neru; no da XP ni cuota). La fuente está al centro y
alrededor hay 9 zonas (por ahora solo decorado; al acercarse se ve su ficha). Código: `worker/src/mundo/` (sala,
Durable Object `SalaMundo` con WebSockets que hibernan) y `worker/mundo/cliente/` (página con three.js). Probar:
`npm run mundo`, levantar `wrangler dev` como arriba y abrir `http://127.0.0.1:8787/mundo/?nombre=Ana` y
`?nombre=Beto` en dos pestañas (WASD/flechas en PC, arrastrar el dedo en celular).

Entrada por el navegador: `https://papus-bots.<subdominio>.workers.dev/mundo/` con **Entrar con Discord**. Para que
funcione, en el portal de Discord (app de Teto → OAuth2 → Redirects) agregar
`https://papus-bots.<subdominio>.workers.dev/mundo/api/volver`. En local, `?web=1` muestra esa entrada. Todos (navegador
y Actividad) comparten una sola plaza.

Registro del chat: el bot publica todo lo que se dice en la plaza en **#plaza-papus** (solo lectura). Su guía fijada
lleva el mapa (`npm run mundo:mapa` → `assets/mundo/mapa-plaza.png`) y el enlace: `MUNDO_URL` en `.env` y luego
`npm run guias -- --apply`.
Vocaloids en la plaza (por ahora Teto, que pasea y saluda con frases fijas): son **renders**, nunca el modelo 3D.
`npm run mundo:sprites -- tet` usa Blender y el pipeline de `../Diva-a-Render` para renderizar 8 direcciones × 7
cuadros (quieta + 6 pasos) y deja `assets/mundo/tet.webp` y `tet.json`; `npm run mundo` los copia a la página.
Hablarle a Teto en la plaza: `@Teto …` en el chat. Gasta la misma cuota diaria que un @ en Discord y da la misma XP
(la responde el bot con su cola y su LLM: `src/mundo/puente.ts`, cada 3 s, por la base D1 del worker). Arriba se ven el
nivel y los mensajes que le quedan hoy al Papu. Los Papus de prueba (`wrangler dev`) solo reciben un aviso. Tras cambiar
`worker/schema.sql`, en local: `npx wrangler d1 execute papus --local --file=schema.sql --yes`.

## Estructura
- `src/services/` lógica de conversación y moderación (probada sin Discord).
- `src/discord/` conexión de los bots, comandos, AutoMod y canales.
- `src/llm/` interfaz única, cadena de respaldo, cola y armado de la petición.
- `src/moderation/` reglas fijas, machetazos y reglas de AutoMod.
- `src/quota/`, `src/phrases/`, `src/engine/`, `src/db/`.
- Datos del bot: `data/papus.sqlite` (cuotas, machetazos, mazos de frases, uso de APIs). No se sube al repo.

## Funcionamiento diario
- **Arranque automático:** la tarea "Papus Discord" del Programador de tareas inicia los bots 30 s después de iniciar
  sesión, sin ventana, y los reinicia si fallan (`npm run autostart`; quitarla: `npm run autostart -- quitar`).
  Registro: `data/bots.log`.
- **Ícono en la bandeja** (tarea "Papus Bandeja"; `npm run bandeja`): las chicas rotando con punto verde si están en
  línea, Neru gris con punto rojo si no. Menú: bots, lista de pedidos, carpetas (Proyecto Vocaloid, motor, bots) y
  enlaces (Discord, Ko-fi, Cloudflare). Íconos: `npm run iconos`.
- **Detener y reiniciar con despedida:** `npm run detener` y `npm run reiniciar` (o desde el ícono) dejan
  `data/detener.flag`; las chicas se despiden y el reinicio automático respeta la detención.
- **Al apagar el PC:** un script de cierre de sesión de Windows (directiva local) las despide antes de apagar
  (`npm run despedida-al-apagar`, como administrador; quitarlo: `npm run despedida-al-apagar -- quitar`).
- **Suspensión:** al despertar, si estuvieron más de 30 min fuera, una de las chicas saluda.
- **Lista de pedidos:** `npm run pedidos` abre en el navegador la cola con todos los detalles (`data/pedidos.html`).
- **Cloudflare (`worker/`):** Miku y Luka responden sus comandos 24/7, aunque el PC esté apagado. Publicar cambios del
  worker o de sus frases: `npm run worker:deploy` (necesita `CLOUDFLARE_DEPLOY_TOKEN` en `.env`).
- **Ícono animado y cartel de invitación** (17 oct. 2026, nivel 1 de mejoras): `assets/servidor/icono.html` (las 4 chicas
  se turnan) y `cartel.html` (concierto con 6 Vocaloids, centro libre para la tarjeta de Discord). Generar:
  `python scripts/make_icono.py` y `node scripts/render-servidor.mjs cartel`. El ícono anterior está en `icono_anterior.png`.
- **Emojis** (17 oct. 2026): dos packs. **Gratis** (todos): caras de las 10 Vocaloids y reacciones de la biblioteca de
  stickers del motor (gatos, nugget, chibis). **Pago** (Puerro y superiores): las insignias y caras de
  `scripts/make_emojis.py` más lo mejor de la biblioteca (bailes MMD, Mesmerizer, nendoroids…), varios animados.
  Generar: `python scripts/make_emojis.py` y `python scripts/make_emoji_samples.py` (escribe `assets/emojis/packs.json`,
  la lista exacta que se sube); subir: `npm run emojis`. Nadie más que GyroP puede crear emojis, stickers ni eventos.

## Comandos
| Quién | Comando | Dónde corre |
|---|---|---|
| Todos | `/cuota` (Teto): mensajes que quedan hoy (la cuota depende del nivel) | PC |
| Todos | `/donar papu cantidad` (Teto): regalarle mensajes de tu cuota de hoy a otro Papu (los pierdes tú; al otro solo le llegan hasta llenar su cuota) | PC |
| Todos | `/nivel [papu] [mostrar]` (Teto): tarjeta de nivel; botones para poner el nivel en el apodo y prestigiar en el 99 | PC |
| Todos | `/tarjeta frase · color · fondo · imagen` (Teto): personaliza la tarjeta (la imagen propia la aprueba GyroP en #moderación) | PC |
| Todos | `/ranking` (Teto): ranking de Papus por nivel (top 10 y tu puesto); solo lo ve quien lo pide | PC |
| GyroP | `/publicar-ranking` (Teto): publica el ranking en el canal donde se usa, para todos (además, Teto lo publica sola cada día a las 12:00 de Chile en #ranking) | PC |
| Todos | `/divorcio` (Teto): divorciarse de su Vocaloid (con confirmación); conserva la XP y la cuota, pierde el rol, y ella deja otra adivinanza | PC |
| Todos | `/trivia [dificultad]` (Teto): ~5.750 preguntas Vocaloid privadas con tiempo límite (opciones, verdadero o falso, texto, audio, siluetas e imágenes) en fácil, media o difícil, con contador de superadas; XP en cada acierto, la racha final sale en el canal y superar toda una dificultad da un sobre (común, raro o legendario). Desde la partida 16 del día, cada partida quita XP (el doble cada vez; Teto avisa antes) | PC |
| Todos | `/ruleta` (Teto): misiones del día (2 h en voz, 200 mensajes, subir de nivel) y hasta 3 giros de la ruleta (XP, mensajes extra o un sobre común; con la cuota llena, los mensajes se vuelven XP); el resultado sale público como GIF | PC |
| GyroP | `/sorteo [premio] [xp] [niveles] [mensajes]` (Teto): todos los Papus en una ruleta; el premio lo eliges tú (XP, niveles y mensajes extra de hoy se entregan solos; solo texto = lo entregas tú) o sale al azar; primero lo ves solo tú y decides si se lo queda, giras otra vez sin él o se lo das a otro; al confirmar sale público como GIF (`config/sorteo.json`) | PC |
| GyroP | `/pelea [vocaloid1] [vocaloid2] [cancelar]` (Teto): 1vs1 de Vocaloids en este canal; los Papus apuestan de 10 a 400 Shaula-coins ganadas con los botones del cartel (3 min) y la pelea se narra línea a línea; también hay peleas solas a las 14:00 y 21:00 en #⚔️・peleas. `cancelar` devuelve lo apostado (`config/peleas.json`) | PC |
| Todos | `/tienda` (Teto): abre el menú de la tienda (comprar monedas, vitrina, sobres, colección, tarjeta y ayuda); solo lo ve quien lo usa | PC |
| Todos | Mercado negro (Neru, una hora al día a una hora sorpresa, en #tienda-shaula; solo monedas ganadas) y `/consumibles` (Teto): usos del Atún de Luka, la Baguette de Teto, el Celular de Neru, el Seguro de Gakupo (1vs1), el Helado de Kaito (sobres), el Micrófono de Meiko y el regalo de Rin y Len (ruleta), la Luna de IA, el Sake de Haku (bodas), la Zanahoria de Gumi y la Guitarra de flower (trivia), el Doble helado de Kaito, el PC y el Disquete de Adachi Rei y el Machete de Neru (`/machetear`, de mentira); GyroP lo abre a mano con `/consumibles abrir_mercado:true`; al abrir, Neru borra el aviso de la apertura anterior | PC |
| Todos (nivel 5 y 3 días) | `/intercambio [papu]` (Teto): ofertas de intercambio como en Steam, abiertas o dirigidas, con contraofertas; Shaula-coins, XP, niveles, cuota de hoy, sobres, objetos y consumibles. Teto las anuncia en #🤝・centro-de-comercio (modo lento de 1 h). Ajustes en `config/intercambios.json` | PC |
| GyroP | `/monedas panel · dar · quitar · limite · bloquear` (Teto): compras del mes por Papu, ajustar saldos, límite mensual y bloqueo de compras | PC |
| GyroP | `/boda [vocaloid]` (Teto): una chica deja ya su adivinanza de boda en #general (no gasta las 3 del día) | PC |
| GyroP | `/evento multiplicador [horas]` (Teto): XP multiplicada; Miku lo anuncia (los estrenos del calendario ya dan ×2 solos) | PC |
| Atún y superiores | `/tip` (Luka): dato + fuente | Cloudflare |
| Triple Baka | `/pedido`, `/mi-pedido` (Miku) | Cloudflare |
| GyroP | `/cola ver · detalle · estado · agregar` (Miku) | Cloudflare |
| Todos | Menú de colores en #tus-roles (Miku): color del nombre de la paleta Vocaloid (se ve sobre el de los niveles) | Cloudflare |
| Todos | Menú de países en #tus-roles (Miku): bandera y nombre del país en el perfil, sin color | Cloudflare |
| Todos | Menú de avisos en #tus-roles (Miku, varios a la vez): ⚔️ Ludópata (peleas), 💍 Rizzler (bodas), 🎬 Estrenos (XP doble), 🕶️ Traficante (mercado negro) | Cloudflare |
| GyroP | `/votacion abrir · cerrar` (Miku): encuesta, aviso 12 h antes y ganador | Cloudflare |
| GyroP | `/votacion listo · listos · quitar-listo · honor` (Miku): votación de los Papus de honor, automática cada 2 semanas (lunes 18:00 a jueves 18:00): videos listos + las 2 ideas con más 👍 de #charla-de-honor | Cloudflare |
| GyroP | `/votacion candidato · candidatos · quitar · semanal · desempate` (Miku): votación semanal automática (`config/votaciones.json`); el 2.º lugar vuelve con candidatos nuevos | Cloudflare |
| GyroP | `/calendario`, `/estreno`, `/noticia` (Miku) | Cloudflare |
| GyroP | `/tip-usado` (Luka): lleva un tip al Salón de la Fama | Cloudflare |
| GyroP | `/perdonar` (Neru): solo GyroP. Borra machetazos y advertencias, devuelve la XP que quitaron y levanta el silencio | PC |
| GyroP y 🛡️ Mod | `/machetazos` (Neru): machetazos y advertencias activos de un Papu | PC |
| GyroP y 🛡️ Mod | `/advertir @papu [motivo]` o clic derecho en un mensaje → Apps → **Advertir (Neru)**: advertencia pública de Neru (frases `aviso`), sin borrar; **3 en 3 días = 1 machetazo**; queda en #moderación | PC |
| GyroP y 🛡️ Mod | `/machetazo @papu [motivo]` o clic derecho → Apps → **Machetazo (Neru)**: machetazo a mano con la escalera normal (1: 10 min; 2: 1 h y sin ganar XP; 3: 24 h y aviso a GyroP; siempre sin la XP del día) y borra el mensaje | PC |

**🛡️ Mod** (lo das tú a mano): sanciona igual que GyroP con Neru, sin permisos propios de Discord; en #moderación sale qué Mod fue. No puede sancionar a otro Mod ni a GyroP. Desde el 8 nov. 2026 también usa `/perdonar` (no a sí mismo), lanza o cancela `/pelea` y `/boda`, y aprueba o rechaza los fondos de tarjeta en #moderación. Para que vea los comandos (una vez): Ajustes del servidor → Integraciones → Neru → en `/machetazo`, `/advertir`, `/machetazos`, `/perdonar`, **Machetazo (Neru)** y **Advertir (Neru)**, y Teto → en `/pelea` y `/boda`, agregar el rol 🛡️ Mod. Para los fondos, el rol 🛡️ Mod necesita ver #moderación (permiso del canal).

Automático (PC): Teto da el rol **Papu** a cada uno al entrar y **Fundador** a quien tenga un nivel en la primera semana
(`config/servidor.json`); cuando GyroP publica en un canal de nivel de solo lectura, Teto avisa en #vitrina dónde y
para quién (nunca qué). Automático (Cloudflare): Miku abre la votación semanal y la anuncia en #vitrina.
