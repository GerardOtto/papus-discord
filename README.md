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
   sanción, para moderar a mano el canal de lenguaje libre (`/advertir`, `/strike`, `/strikes`). Borrar los informes al terminar.

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

## Estructura
- `src/services/` lógica de conversación y moderación (probada sin Discord).
- `src/discord/` conexión de los bots, comandos, AutoMod y canales.
- `src/llm/` interfaz única, cadena de respaldo, cola y armado de la petición.
- `src/moderation/` reglas fijas, strikes y reglas de AutoMod.
- `src/quota/`, `src/phrases/`, `src/engine/`, `src/db/`.
- Datos del bot: `data/papus.sqlite` (cuotas, strikes, mazos de frases, uso de APIs). No se sube al repo.

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
| Todos | `/nivel [papu] [mostrar]` (Teto): tarjeta de nivel; botones para poner el nivel en el apodo y prestigiar en el 99 | PC |
| Todos | `/tarjeta frase · color · fondo · imagen` (Teto): personaliza la tarjeta (la imagen propia la aprueba GyroP en #moderación) | PC |
| Todos | `/ranking` (Teto): ranking de Papus por nivel (top 10 y tu puesto); solo lo ve quien lo pide | PC |
| GyroP | `/publicar-ranking` (Teto): publica el ranking en el canal donde se usa, para todos | PC |
| Todos | `/divorcio` (Teto): divorciarse de su Vocaloid (con confirmación); conserva la XP y la cuota, pierde el rol, y ella deja otra adivinanza | PC |
| Todos | `/trivia` (Teto): preguntas Vocaloid privadas con tiempo límite (opciones, texto, audio y siluetas); XP en cada acierto y la racha final sale en el canal | PC |
| Todos | `/ruleta` (Teto): misiones del día (2 h en voz, 200 mensajes, subir de nivel) y hasta 3 giros de la ruleta (XP o mensajes extra); el resultado sale público como GIF | PC |
| GyroP | `/boda [vocaloid]` (Teto): una chica deja ya su adivinanza de boda en #general (no gasta las 3 del día) | PC |
| GyroP | `/evento multiplicador [horas]` (Teto): XP multiplicada; Miku lo anuncia (los estrenos del calendario ya dan ×2 solos) | PC |
| Atún y superiores | `/tip` (Luka): dato + fuente | Cloudflare |
| Triple Baka | `/pedido`, `/mi-pedido` (Miku) | Cloudflare |
| GyroP | `/cola ver · detalle · estado · agregar` (Miku) | Cloudflare |
| Todos | Menú de colores en #tu-color (Miku): color del nombre de la paleta Vocaloid (se ve sobre el de los niveles) | Cloudflare |
| Todos | Menú de países en #tu-color (Miku): bandera y nombre del país en el perfil, sin color | Cloudflare |
| GyroP | `/votacion abrir · cerrar` (Miku): encuesta, aviso 12 h antes y ganador | Cloudflare |
| GyroP | `/votacion listo · listos · quitar-listo · honor` (Miku): votación de los Papus de honor, automática cada 2 semanas (lunes 18:00 a jueves 18:00): videos listos + las 2 ideas con más 👍 de #charla-de-honor | Cloudflare |
| GyroP | `/votacion candidato · candidatos · quitar · semanal · desempate` (Miku): votación semanal automática (`config/votaciones.json`); el 2.º lugar vuelve con candidatos nuevos | Cloudflare |
| GyroP | `/calendario`, `/estreno`, `/noticia` (Miku) | Cloudflare |
| GyroP | `/tip-usado` (Luka): lleva un tip al Salón de la Fama | Cloudflare |
| GyroP | `/perdonar` (Neru): solo GyroP | PC |
| GyroP y 🛡️ Mod | `/strikes` (Neru) | PC |
| GyroP y 🛡️ Mod | `/advertir @papu [motivo]` o clic derecho en un mensaje → Apps → **Advertir (Neru)**: aviso público de Neru (frases `aviso`), sin borrar ni strike; queda en #moderación | PC |
| GyroP y 🛡️ Mod | `/strike @papu [motivo]` o clic derecho → Apps → **Strike (Neru)**: strike a mano con la escalera normal, sin borrar; **Strike y borrar (Neru)** hace lo mismo y borra el mensaje | PC |

**🛡️ Mod** (lo das tú a mano): sanciona igual que GyroP con Neru, sin permisos propios de Discord; en #moderación sale qué Mod fue. No puede sancionar a otro Mod ni a GyroP, ni usar `/perdonar`. Para que vea los comandos (una vez): Ajustes del servidor → Integraciones → Neru → en `/strike`, `/advertir`, `/strikes`, **Strike (Neru)**, **Strike y borrar (Neru)** y **Advertir (Neru)**, agregar el rol 🛡️ Mod.

Automático (PC): Teto da el rol **Papu** a cada uno al entrar y **Fundador** a quien tenga un nivel en la primera semana
(`config/servidor.json`); cuando GyroP publica en un canal de nivel de solo lectura, Teto avisa en #vitrina dónde y
para quién (nunca qué). Automático (Cloudflare): Miku abre la votación semanal y la anuncia en #vitrina.
