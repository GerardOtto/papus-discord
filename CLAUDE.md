# CLAUDE.md — papus-discord

## Objetivo
Servidor de Discord de la comunidad ("Papus") del canal Vocaloid de GyroP: membresías de Ko-fi por niveles y cuatro
bots con personalidad (**Teto, Miku, Luka y Neru**) que conversan con LLM gratuitos, cumplen tareas del servidor y moderan.
**Plan completo y decisiones: `docs/PLAN.md`** (leer antes de cualquier cambio). Estado (16 oct. 2026): **abre al público
el 17 oct. 2026, sin prueba cerrada**; prueba de carga cuando esté lo mínimo (gratis + Puerro, Atún, Baguette). Hecho:
conversación con cuota y cola, LLM local (Ollama) + APIs con reparto, moderación de Neru + AutoMod, bienvenidas, servidor
estructurado (`config/servidor.json`), guías fijadas, emojis de nivel, arranque con Windows (tarea "Papus Discord").
Miku y Luka responden sus comandos 24/7 desde Cloudflare (`worker/`: pedidos, votaciones, calendario, estrenos, noticias,
tips). Pendiente: `/cumple` de Teto, aviso automático de compras de Ko-fi, exportar votaciones y pedidos al motor.
Uso y archivos editables: `README.md`.

Repo hermano: el motor de videos en `../Proyecto1` (fuente del lore, calendario y fuentes de noticias).
**Rutas de los datos del motor: `config/engine-paths.json`** (solo lectura; el bot nunca escribe en el motor).

## Reglas (no negociables)
1. **Ningún plan de pago da exclusividades con los bots**: cuota diaria única por Papu (7 al lanzar), compartida entre los
   4 bots, igual para todos los niveles; una unidad por cada @ en un mensaje; sin prioridad en la cola por pagar.
2. Los bots son omnipresentes (todos los canales) y no se responden solos entre ellos.
3. La moderación es por reglas fijas + AutoMod de Discord, **nunca el LLM**. Neru no expulsa ni banea (solo GyroP).
4. El LLM solo responde menciones libres. Bienvenidas, avisos, votaciones, moderación, cuota agotada, etc. usan grupos de
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
- Hosting de la prueba: el PC de GyroP (arranque con Windows). Bots desconectados cuando el PC está apagado; AutoMod cubre lo grave.
- Repo aparte del motor.

## Sobre el usuario
- Gerard Otto, nombre de productor **GyroP** (se pronuncia "yairo-pi"); escribe en español; está en Chile, el público es
  mexicano de 14 a 32 años (a los seguidores les dice "Papus").
- Quiere mecanizar todo lo posible y prefiere planes visuales (PDF, imágenes, calendarios), nunca Excel.
- Commits solo cuando lo pida.
