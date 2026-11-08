# CLAUDE.md — papus-discord

## Objetivo
Servidor de Discord de la comunidad ("Papus") del canal Vocaloid de GyroP: membresías de Ko-fi por niveles y cuatro
bots con personalidad (**Teto, Miku, Luka y Neru**) que conversan con LLM gratuitos, cumplen tareas del servidor y moderan,
más once que solo conversan (**Gakupo, Kaito, flower, IA, Haku, Gumi, Rin, Len, Meiko, Adachi Rei y Ruko**; opcionales por
token, rol 🎤 Coro, PLAN §4) y **Mango9374**, que imita a un Papu real: da los números del día y a veces frases fijas (sin LLM, PLAN §4).
**Plan completo y decisiones: `docs/PLAN.md`** (leer antes de cualquier cambio). Estado (16 oct. 2026): **abre al público
el 17 oct. 2026, sin prueba cerrada**; prueba de carga cuando esté lo mínimo (gratis + Puerro, Atún, Baguette). Hecho:
conversación con cuota y cola, LLM local (Ollama) + APIs con reparto, moderación de Neru + AutoMod, bienvenidas, servidor
estructurado (`config/servidor.json`), guías fijadas, emojis de nivel, arranque con Windows (tarea "Papus Discord").
Miku y Luka responden sus comandos 24/7 desde Cloudflare (`worker/`: pedidos, votaciones, calendario, estrenos, noticias,
tips). Bodas con las Vocaloids por adivinanzas (PLAN §3.2). Ruleta diaria por misiones (PLAN §3.3). Trivia con rachas en fácil, media y difícil y sobres por hitos de aciertos, `/trivia` (PLAN §3.4; ~5.750 preguntas, 5.014 generadas con `npm run trivia:generar`). `/donar` cuota y cuota sobrante → XP (PLAN §3). Sorteo de GyroP, `/sorteo` (PLAN §3.5). Tienda de Shaula-coins con sobres y objetos para la tarjeta, `/tienda` (PLAN §3.6). 1vs1 de 28 luchadores (Vocaloids e invitados) con apuestas de Shaula-coins ganadas (10-400), `/pelea` y wiki en #peleas (PLAN §3.7). Avisos (⚔️ Ludópata, 💍 Rizzler, 🎬 Estrenos) en #tus-roles (PLAN §3.8). Niveles por participación (1-99 y prestigios, PLAN §3.1;
cálculo inicial con `npm run niveles`). Pendiente: `/cumple` de Teto, aviso automático de compras de Ko-fi, exportar votaciones y pedidos al motor.
Uso y archivos editables: `README.md`.

Repo hermano: el motor de videos en `../Proyecto1` (fuente del lore, calendario y fuentes de noticias).
**Rutas de los datos del motor: `config/engine-paths.json`** (solo lectura; el bot nunca escribe en el motor).

## Reglas (no negociables)
1. **Ningún plan de pago da exclusividades con los bots**: cuota diaria por Papu, compartida entre todos los bots, que depende **solo de su
   nivel por participación** (PLAN §3.1, `config/niveles.json`: 3 en el nivel 1 hasta 18, 20 con prestigio; desde el 20 oct. 2026, antes 12
   para todos); nada de pago (Ko-fi) da XP ni cuota; una unidad por cada @ en un mensaje; sin prioridad en la cola por pagar. Única excepción,
   regalo de GyroP y no de un nivel: 🍍♡Piña♡🍍 (`config/especiales.json`, PLAN §cuota); no se extiende a otros Papus.
   Excepción por juego: ganar una boda con una Vocaloid reinicia la cuota del día (PLAN §3.2; se gana adivinando, no pagando),
   y la ruleta puede dar mensajes extra del día (PLAN §3.3; se gana con misiones de participación); con la cuota llena, lo ganado
   se vuelve XP, y `/donar` pasa cuota de un Papu a otro sin subir la cuota diaria (PLAN §3). La trivia da XP por
   acierto (PLAN §3.4; se gana jugando) y el sorteo de GyroP puede dar XP, niveles y mensajes extra del día (PLAN §3.5; entran todos los Papus por igual).
   Las Shaula-coins solo adornan la tarjeta: no dan XP ni cuota (PLAN §3.6); las insignias de membresía también son solo adorno.
   Las apuestas del 1vs1 (PLAN §3.7) solo usan monedas ganadas, nunca compradas, y no dan XP ni cuota.
2. Los bots son omnipresentes (todos los canales) y no se responden solos entre ellos. Única excepción: la charla de
   #general (PLAN §4), donde un Vocaloid le pregunta a otro con @ y este contesta una sola vez.
3. La moderación es por reglas fijas + AutoMod de Discord, **nunca el LLM**. Neru no expulsa ni banea (solo GyroP).
4. El LLM solo responde menciones libres y la charla espontánea de #general (cada 20 min, PLAN §4; no gasta cuota de Papus). Bienvenidas, avisos, votaciones, moderación, cuota agotada, etc. usan grupos de
   30-40 frases fijas elegidas al azar sin repetir (estado persistido). Las frases fijas nunca gastan cuota.
5. No acoplar a un proveedor de LLM: interfaz única con cadena de respaldo (Groq, Gemini, OpenRouter y Cloudflare por turnos; el local de respaldo).
   Varios proveedores sí; varias cuentas del mismo proveedor, no. "local" = Ollama en el PC de GyroP (Gemma 4 E4B como
   `papus-gemma`, `config/ollama/`). Desde el 16 oct. 2026 (`"preferencia": "apis"` en `config/llm.json`, decisión de
   GyroP por calidad): las APIs se turnan según su cupo diario y el local es el respaldo. Con `"local"`, vuelve a ir primero.
6. El lore de los personajes se lee del motor (`$ENGINE_DIR/config/autopilot/lore.json`); no inventar datos de personajes.
7. Sin audio en la prueba cerrada (los clips de voz cuestan dinero).
8. Tokens y claves solo en `.env` (nunca en el repo ni en los registros).
9. Todo componente importante con prueba; nunca desactivar tests para pasar en verde.

## Decisiones ya tomadas (no volver a plantearlas)
- GyroP asume el riesgo de licencias de los personajes y revisa por su cuenta los términos de las APIs (menores, datos).
- Hosting: desde el 23 oct. 2026, Google Cloud e2-micro gratuita (`nube\nube.cmd`, `nube/LEEME.md`); el PC solo sincroniza datos
  del motor. Nunca los bots en el PC y en la nube a la vez. Volver al PC: `nube\nube.cmd volver`.
- Repo aparte del motor.

## Sobre el usuario
- Gerard Otto, nombre de productor **GyroP** (se pronuncia "yairo-pi"); escribe en español; está en Chile, el público es
  mexicano de 14 a 32 años (a los seguidores les dice "Papus").
- Quiere mecanizar todo lo posible y prefiere planes visuales (PDF, imágenes, calendarios), nunca Excel.
- Commits solo cuando lo pida.
