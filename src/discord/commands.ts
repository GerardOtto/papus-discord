// Comandos de barra por bot. Cada aplicacion registra SOLO los suyos en el servidor (registro por servidor:
// aparecen al instante). Los de administracion quedan ocultos para quien no es administrador.
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from "discord.js";
import type { BotId } from "../config";
import { WEDDING_BOTS } from "../phrases/catalog";

export interface CastMember {
  id: string;
  name: string;
}

/** Los quince Vocaloids del servidor, para elegir quien habla en /charla (Discord admite hasta 25 opciones). */
const VOCALOID_CHOICES = (
  [
    ["teto", "Teto"],
    ["miku", "Miku"],
    ["luka", "Luka"],
    ["neru", "Neru"],
    ["gakupo", "Gakupo"],
    ["kaito", "Kaito"],
    ["flower", "flower"],
    ["ia", "IA"],
    ["haku", "Haku"],
    ["gumi", "Gumi"],
    ["rin", "Rin"],
    ["len", "Len"],
    ["meiko", "Meiko"],
    ["adachirei", "Adachi Rei"],
    ["ruko", "Ruko"],
  ] satisfies [BotId, string][]
).map(([value, name]) => ({ name, value }));

/** Las chicas de las bodas, para /boda (y Mango9374, desde el 12 nov. 2026). */
const BRIDE_CHOICES = [...VOCALOID_CHOICES.filter((c) => WEDDING_BOTS.includes(c.value as BotId)), { name: "Mango9374", value: "mango" }];

/** `_cardColors`: ya no se usa (/tarjeta sin opciones desde el 13 nov. 2026); queda para no cambiar las llamadas. */
export function commandsFor(
  bot: BotId,
  _cast: CastMember[] = [], // elenco del motor: lo usaban /pedido y /cola (quitados el 13 nov. 2026)
  _cardColors: { name: string; value: string }[] = [],
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  switch (bot) {
    case "teto":
      return [
        new SlashCommandBuilder()
          .setName("cuota")
          .setDescription("Cuántos mensajes con los Vocaloids te quedan hoy")
          .toJSON(),
        new SlashCommandBuilder()
          .setName("reiniciar-cuota")
          .setDescription("Devuelve los mensajes de hoy a todos los Papus, o a uno (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addUserOption((o) => o.setName("papu").setDescription("Solo a este Papu (si lo dejas vacío, a todos)"))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("charla")
          .setDescription("Un Vocaloid escribe ahora mismo por su cuenta en #general (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addStringOption((o) => o.setName("vocaloid").setDescription("Quién habla (si lo dejas vacío, le toca al siguiente)").addChoices(...VOCALOID_CHOICES))
          .addStringOption((o) => o.setName("tema").setDescription("De qué habla (si lo dejas vacío, elige solo)").setMaxLength(300))
          .addStringOption((o) => o.setName("a").setDescription("A qué Vocaloid le pregunta con @ (le contesta una vez)").addChoices(...VOCALOID_CHOICES))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("nivel")
          .setDescription("Tu tarjeta de nivel (o la de otro Papu); desde aquí pones tu nivel en el apodo")
          .addUserOption((o) => o.setName("papu").setDescription("Ver la tarjeta de otro Papu"))
          .addBooleanOption((o) => o.setName("mostrar").setDescription("Publicarla en el canal para que todos la vean"))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("boda")
          .setDescription("Lanza una boda en #general: una Vocaloid deja su adivinanza (membresías, GyroP y Mods)")
          .addStringOption((o) => o.setName("vocaloid").setDescription("Quién la deja (vacío = al azar; elegir es de 📱 Celular y más)").addChoices(...BRIDE_CHOICES))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("adivinanza")
          .setDescription("Un Vocaloid suelta ahora una adivinanza al aire con pozo en este canal (GyroP y Mods)")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
          .addStringOption((o) => o.setName("vocaloid").setDescription("Quién la suelta (vacío = al azar)").addChoices(...VOCALOID_CHOICES))
          .addBooleanOption((o) => o.setName("dorada").setDescription("Forzar dorada (pozo ×2) o normal; vacío = al azar"))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("divorcio")
          .setDescription("Te divorcias de tu Vocaloid: conservas la XP y la cuota, pero pierdes el rol")
          .toJSON(),
        new SlashCommandBuilder().setName("ranking").setDescription("Ranking de Papus por nivel, con tu puesto (solo lo ves tú)").toJSON(),
        new SlashCommandBuilder().setName("ruleta").setDescription("Tus misiones del día y la ruleta de premios (hasta 3 tiradas al día)").toJSON(),
        new SlashCommandBuilder()
          .setName("trivia")
          .setDescription("Trivia Vocaloid en fácil, media o difícil: gana XP, supera todas y llévate un sobre")
          .addStringOption((o) =>
            o
              .setName("dificultad")
              .setDescription("Sin elegir, ves cuántas llevas superadas en cada una")
              .addChoices({ name: "🟢 Fácil", value: "facil" }, { name: "🟡 Media", value: "medio" }, { name: "🔴 Difícil", value: "dificil" }),
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName("donar")
          .setDescription("Regálale mensajes de tu cuota de hoy a otro Papu (tú los pierdes)")
          .addUserOption((o) => o.setName("papu").setDescription("A quién se los regalas").setRequired(true))
          .addIntegerOption((o) => o.setName("cantidad").setDescription("Cuántos mensajes").setRequired(true).setMinValue(1).setMaxValue(50))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("publicar-ranking")
          .setDescription("Teto publica el ranking de Papus en este canal para todos (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .toJSON(),
        // Desde el 13 nov. 2026 (pedido de GyroP) /tarjeta solo da el enlace a la web: ya no tiene opciones.
        new SlashCommandBuilder().setName("tarjeta").setDescription("Personaliza tu tarjeta de nivel en la web (enlace privado, solo lo ves tú)").toJSON(),
        new SlashCommandBuilder()
          .setName("redes")
          .setDescription("Tu Instagram y tu X para que salgan en tus fanarts (opcional; vacío = quitarlos)")
          .addStringOption((o) => o.setName("instagram").setDescription("Tu usuario de Instagram (sin @ ni enlaces)").setMaxLength(60))
          .addStringOption((o) => o.setName("x").setDescription("Tu usuario de X/Twitter (sin @ ni enlaces)").setMaxLength(60))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("aportar")
          .setDescription("Taller de los Papus: escribe contenido para el servidor, con tu nombre (membresías)")
          .addSubcommand((s) =>
            s
              .setName("pregunta")
              .setDescription("Una pregunta de trivia con 4 opciones (🐟 Atún y más)")
              .addStringOption((o) => o.setName("pregunta").setDescription("La pregunta").setRequired(true).setMinLength(10).setMaxLength(200))
              .addStringOption((o) => o.setName("correcta").setDescription("La respuesta correcta").setRequired(true).setMaxLength(80))
              .addStringOption((o) => o.setName("incorrecta1").setDescription("Una respuesta incorrecta").setRequired(true).setMaxLength(80))
              .addStringOption((o) => o.setName("incorrecta2").setDescription("Otra incorrecta").setRequired(true).setMaxLength(80))
              .addStringOption((o) => o.setName("incorrecta3").setDescription("Otra incorrecta").setRequired(true).setMaxLength(80))
              .addStringOption((o) => o.setName("dificultad").setDescription("Qué tan difícil es (por defecto, media)").addChoices({ name: "Fácil", value: "facil" }, { name: "Media", value: "medio" }, { name: "Difícil", value: "dificil" })),
          )
          .addSubcommand((s) =>
            s
              .setName("adivinanza")
              .setDescription("Una adivinanza de boda para un Vocaloid (🐟 Atún y más)")
              .addStringOption((o) => o.setName("vocaloid").setDescription("Quién la dice").setRequired(true).addChoices(...BRIDE_CHOICES))
              .addStringOption((o) => o.setName("adivinanza").setDescription("La adivinanza (sin decir la respuesta)").setRequired(true).setMinLength(15).setMaxLength(300))
              .addStringOption((o) => o.setName("respuestas").setDescription("Las respuestas que valen, separadas por comas").setRequired(true).setMaxLength(150)),
          )
          .addSubcommand((s) =>
            s
              .setName("frase")
              .setDescription("La frase del especial de un luchador del 1vs1 (🥖 Baguette y más)")
              .addStringOption((o) => o.setName("luchador").setDescription("De quién").setRequired(true).setAutocomplete(true))
              .addStringOption((o) => o.setName("texto").setDescription("Qué hace en su especial (ej.: «lanza baguettes a toda velocidad»)").setRequired(true).setMinLength(10).setMaxLength(120)),
          )
          .addSubcommand((s) =>
            s
              .setName("luchador")
              .setDescription("Propón un luchador invitado para el 1vs1 (📱 Celular y más; 1 por temporada)")
              .addStringOption((o) => o.setName("nombre").setDescription("Quién").setRequired(true).setMaxLength(60))
              .addStringOption((o) => o.setName("detalle").setDescription("De dónde es y cómo pelearía").setRequired(true).setMaxLength(500)),
          )
          .addSubcommand((s) =>
            s
              .setName("consumible")
              .setDescription("Propón un consumible para el mercado negro (💥 Triple Baka)")
              .addStringOption((o) => o.setName("nombre").setDescription("Cómo se llama").setRequired(true).setMaxLength(60))
              .addStringOption((o) => o.setName("detalle").setDescription("Qué hace").setRequired(true).setMaxLength(500)),
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName("color")
          .setDescription("Tu color con hex propio (membresías 📱 Celular y 💥 Triple Baka); vacío = quitarlo")
          .addStringOption((o) => o.setName("hex").setDescription("Ej.: #FF5FA2").setMinLength(6).setMaxLength(7))
          .toJSON(),
        new SlashCommandBuilder().setName("tienda").setDescription("Tienda de las Shaulitas: vitrina, sobres, tu membresía, tu colección y tu tarjeta (solo lo ves tú)").toJSON(),
        new SlashCommandBuilder()
          .setName("consumibles")
          .setDescription("Tus objetos del mercado negro: cuántos usos te quedan y el PC de Adachi Rei (solo lo ves tú)")
          .addBooleanOption((o) => o.setName("abrir_mercado").setDescription("Abrir el mercado negro ahora (solo GyroP)"))
          .addIntegerOption((o) => o.setName("minutos").setDescription("Cuánto rato lo abres (solo GyroP; si no, 60)").setMinValue(1).setMaxValue(240))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("intercambio")
          .setDescription("Intercambia Shaulitas, XP, niveles, cuota, sobres, objetos y consumibles con otros Papus")
          .addUserOption((o) => o.setName("papu").setDescription("Ofrecerle un intercambio a este Papu (si no, ves tus ofertas)"))
          .toJSON(),
        // Ruleta de Némesis (config/nemesis.json, PLAN §3.12): los límites de la apuesta los revisa el código.
        new SlashCommandBuilder()
          .setName("nemesis")
          .setDescription("Ruleta de Némesis: desafía a un Papu a la ruleta rusa por Shaulitas")
          .addUserOption((o) => o.setName("rival").setDescription("A quién desafías"))
          .addIntegerOption((o) => o.setName("apuesta").setDescription("Shaulitas que pone cada uno").setMinValue(1).setMaxValue(100_000))
          .addBooleanOption((o) => o.setName("cancelar").setDescription("Cancelar la ruleta en curso y devolver todo (GyroP y Mods)"))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("monedas")
          .setDescription("Shaulitas: dar o quitar Shaulitas o Ecos a un Papu (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addSubcommand((s) =>
            s
              .setName("dar")
              .setDescription("Dar Shaulitas o Ecos a un Papu")
              .addUserOption((o) => o.setName("papu").setDescription("A quién").setRequired(true))
              .addIntegerOption((o) => o.setName("cantidad").setDescription("Cuántas").setMinValue(1).setMaxValue(1_000_000).setRequired(true))
              .addStringOption((o) => o.setName("bolsillo").setDescription("Qué (por defecto, Shaulitas)").addChoices({ name: "Shaulitas", value: "monedas" }, { name: "Ecos", value: "ecos" }))
              .addStringOption((o) => o.setName("motivo").setDescription("Para el registro").setMaxLength(80)),
          )
          .addSubcommand((s) =>
            s
              .setName("quitar")
              .setDescription("Quitar Shaulitas o Ecos a un Papu")
              .addUserOption((o) => o.setName("papu").setDescription("A quién").setRequired(true))
              .addIntegerOption((o) => o.setName("cantidad").setDescription("Cuántas").setMinValue(1).setMaxValue(1_000_000).setRequired(true))
              .addStringOption((o) => o.setName("bolsillo").setDescription("Qué (por defecto, Shaulitas)").addChoices({ name: "Shaulitas", value: "monedas" }, { name: "Ecos", value: "ecos" }))
              .addStringOption((o) => o.setName("motivo").setDescription("Para el registro").setMaxLength(80)),
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName("sorteo")
          .setDescription("Sorteo: todos los Papus en la ruleta; tú decides si el ganador se queda el premio (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addStringOption((o) => o.setName("premio").setDescription("Qué se sortea (con XP, niveles o mensajes, es solo el nombre; vacío = al azar)").setMaxLength(80))
          .addIntegerOption((o) => o.setName("xp").setDescription("XP exacta para el ganador (se entrega sola)").setMinValue(1).setMaxValue(1_000_000))
          .addIntegerOption((o) => o.setName("niveles").setDescription("Niveles completos para el ganador (sin pasar del 99)").setMinValue(1).setMaxValue(98))
          .addIntegerOption((o) => o.setName("mensajes").setDescription("Mensajes extra con los Vocaloids, solo hoy").setMinValue(1).setMaxValue(100))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("pelea")
          .setDescription("Lanza un 1vs1 o un 2vs2 con apuestas de Shaulitas en #casino (membresías, prestigio, GyroP y Mods)")
          .addStringOption((o) => o.setName("modo").setDescription("1vs1 (por defecto) o 2vs2: se apuesta por un equipo").addChoices({ name: "1vs1", value: "1vs1" }, { name: "2vs2 (equipos)", value: "2vs2" }))
          // Autocompletar: son más de 25 luchadores (Vocaloids e invitados), el tope de opciones fijas de Discord.
          .addStringOption((o) => o.setName("vocaloid1").setDescription("Primer luchador; en 2vs2, del equipo 1 (vacío = al azar; elegir es de 🥖 Baguette y más)").setAutocomplete(true))
          .addStringOption((o) => o.setName("vocaloid2").setDescription("Segundo luchador; en 2vs2, compañero del 1 (vacío = al azar)").setAutocomplete(true))
          .addStringOption((o) => o.setName("vocaloid3").setDescription("Solo 2vs2: primero del equipo 2 (vacío = al azar)").setAutocomplete(true))
          .addStringOption((o) => o.setName("vocaloid4").setDescription("Solo 2vs2: segundo del equipo 2 (vacío = al azar)").setAutocomplete(true))
          .addBooleanOption((o) => o.setName("cancelar").setDescription("Cancelar la pelea en curso y devolver lo apostado (GyroP y Mods)"))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("cumple")
          .setDescription("Cumpleaños de los Papus (se registran en #tus-roles)")
          .addSubcommand((s) =>
            s
              .setName("ver")
              .setDescription("Ver tu cumpleaños o el de otro Papu")
              .addUserOption((o) => o.setName("papu").setDescription("De quién (vacío = el tuyo)")),
          )
          .addSubcommand((s) => s.setName("proximos").setDescription("Los cumpleaños de los próximos 30 días (Papus y Vocaloids), según Ruko"))
          .addSubcommand((s) =>
            s
              .setName("poner")
              .setDescription("Poner o cambiar el cumpleaños de un Papu (GyroP y Mods)")
              .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true))
              .addIntegerOption((o) => o.setName("dia").setDescription("Día").setMinValue(1).setMaxValue(31).setRequired(true))
              .addStringOption((o) =>
                o
                  .setName("mes")
                  .setDescription("Mes")
                  .setRequired(true)
                  .addChoices(...["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"].map((m, k) => ({ name: m, value: String(k + 1) }))),
              ),
          )
          .addSubcommand((s) =>
            s
              .setName("borrar")
              .setDescription("Borrar el cumpleaños de un Papu para que lo registre de nuevo (GyroP y Mods)")
              .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true)),
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName("carrera")
          .setDescription("Lanza una carrera de Vocaloids con apuestas de Shaulitas (membresías, GyroP y Mods)")
          .addBooleanOption((o) => o.setName("cancelar").setDescription("Cancelar la carrera en curso y devolver lo apostado (GyroP y Mods)"))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("evento")
          .setDescription("Evento de XP multiplicada; Miku lo anuncia en #general (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addNumberOption((o) =>
            o
              .setName("multiplicador")
              .setDescription("Cuánto vale la XP (0 = terminar el evento)")
              .setRequired(true)
              .addChoices({ name: "×1,5", value: 1.5 }, { name: "×2", value: 2 }, { name: "×3", value: 3 }, { name: "Terminar el evento", value: 0 }),
          )
          .addIntegerOption((o) => o.setName("horas").setDescription("Cuántas horas dura (por defecto 24)").setMinValue(1).setMaxValue(168))
          .toJSON(),
      ];
    case "miku":
      return [
        new SlashCommandBuilder()
          .setName("votacion")
          .setDescription("Votaciones con encuesta (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addSubcommand((s) => {
            s.setName("abrir")
              .setDescription("Abre una votación (Miku la anuncia, recuerda el cierre y anuncia el ganador)")
              .addStringOption((o) => o.setName("opcion1").setDescription("Opción 1").setRequired(true).setMaxLength(55))
              .addStringOption((o) => o.setName("opcion2").setDescription("Opción 2").setRequired(true).setMaxLength(55));
            for (let n = 3; n <= 6; n++) s.addStringOption((o) => o.setName(`opcion${n}`).setDescription(`Opción ${n}`).setMaxLength(55));
            return s
              .addStringOption((o) =>
                o
                  .setName("canal")
                  .setDescription("Dónde (por defecto, #votaciones de Puerro)")
                  .addChoices(
                    { name: "🗳️ votaciones (Puerro): tema del próximo video", value: "votaciones" },
                    { name: "📝 propuestas-de-temas (Atún): presentador o miniatura", value: "propuestas-de-temas" },
                    { name: "❓ preguntas-a-gyrop (Celular): tema del especial", value: "preguntas-a-gyrop" },
                    { name: "🏅 votacion-de-honor (Papus de honor): video de la semana", value: "votacion-de-honor" },
                  ),
              )
              .addStringOption((o) => o.setName("pregunta").setDescription("Pregunta de la encuesta (por defecto: el tema del próximo video)").setMaxLength(250))
              .addIntegerOption((o) => o.setName("dias").setDescription("Cuántos días dura (por defecto 3)").setMinValue(1).setMaxValue(14));
          })
          .addSubcommand((s) =>
            s
              .setName("cerrar")
              .setDescription("Cierra ya la votación abierta más reciente de un canal")
              .addStringOption((o) =>
                o
                  .setName("canal")
                  .setDescription("Canal de la votación")
                  .setRequired(true)
                  .addChoices(
                    { name: "🗳️ votaciones", value: "votaciones" },
                    { name: "📝 propuestas-de-temas", value: "propuestas-de-temas" },
                    { name: "❓ preguntas-a-gyrop", value: "preguntas-a-gyrop" },
                    { name: "🏅 votacion-de-honor", value: "votacion-de-honor" },
                  ),
              ),
          )
          .addSubcommand((s) =>
            s
              .setName("candidato")
              .setDescription("Agrega candidatos a la lista de espera de la votación semanal")
              .addStringOption((o) => o.setName("nombre").setDescription("Video candidato; varios separados con | (ej.: Video de Kafu | Video de Ruko)").setRequired(true).setMaxLength(500)),
          )
          .addSubcommand((s) => s.setName("candidatos").setDescription("Lista de la votación semanal: en votación, segundo lugar, en espera y ganadores"))
          .addSubcommand((s) =>
            s
              .setName("quitar")
              .setDescription("Saca un candidato de la lista de espera")
              .addStringOption((o) => o.setName("nombre").setDescription("Nombre exacto del candidato").setRequired(true).setMaxLength(55)),
          )
          .addSubcommand((s) => s.setName("semanal").setDescription("Abre ya la ronda semanal (normalmente Miku la abre sola)"))
          .addSubcommand((s) =>
            s
              .setName("listo")
              .setDescription("🏅 Agrega videos que tienes listos para subir a la votación de honor")
              .addStringOption((o) => o.setName("nombre").setDescription("Video listo; varios separados con |").setRequired(true).setMaxLength(500)),
          )
          .addSubcommand((s) => s.setName("listos").setDescription("🏅 Votación de honor: videos listos, ideas que van ganando y próxima fecha"))
          .addSubcommand((s) =>
            s
              .setName("quitar-listo")
              .setDescription("🏅 Saca un video de la lista de listos")
              .addStringOption((o) => o.setName("nombre").setDescription("Nombre exacto del video").setRequired(true).setMaxLength(55)),
          )
          .addSubcommand((s) => s.setName("honor").setDescription("🏅 Abre ya la votación de honor (normalmente Miku la abre sola cada 2 semanas, los lunes)"))
          .addSubcommand((s) =>
            s
              .setName("desempate")
              .setDescription("Elige el ganador cuando la ronda semanal termina en empate")
              .addStringOption((o) => o.setName("opcion").setDescription("La opción ganadora (tal cual aparece en la encuesta)").setRequired(true).setMaxLength(55)),
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName("estreno")
          .setDescription("Miku anuncia un video nuevo en #novedades (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addStringOption((o) => o.setName("titulo").setDescription("Título del video").setRequired(true).setMaxLength(150))
          .addStringOption((o) => o.setName("enlace").setDescription("Enlace al video").setRequired(true).setMaxLength(300))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("noticia")
          .setDescription("Miku comparte una noticia Vocaloid en #novedades (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addStringOption((o) => o.setName("texto").setDescription("La noticia (puedes incluir el enlace)").setRequired(true).setMaxLength(1500))
          .toJSON(),
      ];
    case "luka":
      return [
      ];
    case "neru":
      return [
        // Celular de Neru (PLAN §3.15): abre la Actividad desde cualquier canal de texto. Aparte del comando de punto de
        // entrada global (npm run celular:comando), que solo sale en el lanzador de Actividades.
        new SlashCommandBuilder().setName("celular").setDescription("Abre el celular de Neru: Vocaloidle, Silueta, tu tarjeta y más").toJSON(),
        new SlashCommandBuilder()
          .setName("machetear")
          .setDescription("Machetazo de mentira a quien quieras (con el Machete de Neru del mercado negro; no cuenta)")
          .addUserOption((o) => o.setName("papu").setDescription("A quién macheteas (de mentira)").setRequired(true))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("machetazos")
          .setDescription("Machetazos y advertencias activos de un Papu (GyroP y Mods)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("perdonar")
          .setDescription("Borra machetazos y advertencias, devuelve la XP y quita el silencio (GyroP y Mods)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("advertir")
          .setDescription("Advertencia de Neru, sin borrar; 3 en 3 días = 1 machetazo (GyroP y Mods)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true))
          .addStringOption((o) => o.setName("motivo").setDescription("Qué cuidar (sale citado bajo la frase de Neru)").setMaxLength(300))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("machetazo")
          .setDescription("Neru le da un machetazo a un Papu: silencio y sin la XP de hoy (GyroP y Mods)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true))
          .addStringOption((o) => o.setName("motivo").setDescription("Por qué (sale citado bajo la frase de Neru)").setMaxLength(300))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("reporte")
          .setDescription("Abre un ticket privado con GyroP: bugs, tu rol de Ko-fi, reclamos")
          .addStringOption((o) => o.setName("motivo").setDescription("Qué pasó, dónde y más o menos a qué hora").setRequired(true).setMaxLength(1000))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("cerrar-ticket")
          .setDescription("Cierra el ticket de este hilo (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .toJSON(),
      ];
    default:
      return [];
  }
}

/** Nombre del clic derecho sobre un mensaje → Apps → "Advertir (Neru)". */
export const WARN_MENU = "Advertir (Neru)";
/** Clic derecho sobre un mensaje → Apps → "Machetazo (Neru)": machetazo a mano, y Neru borra el mensaje. */
export const STRIKE_MENU = "Machetazo (Neru)";

/** Comandos de clic derecho (menu de Apps). */
export function contextMenusFor(bot: BotId): RESTPostAPIContextMenuApplicationCommandsJSONBody[] {
  if (bot !== "neru") return [];
  return [WARN_MENU, STRIKE_MENU].map((name) =>
    new ContextMenuCommandBuilder()
      .setName(name)
      .setType(ApplicationCommandType.Message)
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
  );
}
