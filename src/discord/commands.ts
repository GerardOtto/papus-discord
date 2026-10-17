// Comandos de barra por bot. Cada aplicacion registra SOLO los suyos en el servidor (registro por servidor:
// aparecen al instante). Los de administracion quedan ocultos para quien no es administrador.
import { PermissionFlagsBits, SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { BotId } from "../config";
import { OCCASIONS, PRODUCTS, type OccasionId } from "../orders/queue";

export interface CastMember {
  id: string;
  name: string;
}

const occasionChoices = (withTemaLibre: boolean) =>
  (Object.entries(OCCASIONS) as [OccasionId, string][])
    .filter(([id]) => withTemaLibre || id !== "tema_libre")
    .map(([value, name]) => ({ name, value }));

export function commandsFor(bot: BotId, cast: CastMember[] = []): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const castChoices = cast.slice(0, 25).map((c) => ({ name: c.name, value: c.id }));
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
      ];
    case "miku":
      return [
        new SlashCommandBuilder()
          .setName("pedido")
          .setDescription("Pide tu video personalizado con los Vocaloids (Triple Baka, uno al mes)")
          .addStringOption((o) => o.setName("ocasion").setDescription("¿Para qué es el video?").setRequired(true).addChoices(...occasionChoices(false)))
          .addStringOption((o) => o.setName("para").setDescription("Nombre de quien recibe el video").setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName("vocaloid").setDescription("Vocaloid principal (el que habla más)").setRequired(true).addChoices(...castChoices))
          .addStringOption((o) => o.setName("detalles").setDescription("Gustos, apodos o una anécdota corta").setRequired(true).setMaxLength(1000))
          .addStringOption((o) => o.setName("vocaloid2").setDescription("Segundo Vocaloid (opcional)").addChoices(...castChoices))
          .addStringOption((o) => o.setName("pronunciacion").setDescription("Si el nombre es difícil, cómo se pronuncia").setMaxLength(80))
          .addStringOption((o) => o.setName("fecha_limite").setDescription("Si hay una fecha, como un cumpleaños: AAAA-MM-DD").setMaxLength(10))
          .addBooleanOption((o) => o.setName("publicar").setDescription("¿Puede salir en el canal? (solo con tu permiso)"))
          .toJSON(),
        new SlashCommandBuilder().setName("mi-pedido").setDescription("Mira el estado y la posición de tu video personalizado").toJSON(),
        new SlashCommandBuilder()
          .setName("cola")
          .setDescription("Cola de videos personalizados (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addSubcommand((s) => s.setName("ver").setDescription("Todos los pedidos activos, con detalles"))
          .addSubcommand((s) =>
            s
              .setName("detalle")
              .setDescription("Todo sobre un pedido")
              .addIntegerOption((o) => o.setName("pedido").setDescription("Número del pedido").setRequired(true).setMinValue(1)),
          )
          .addSubcommand((s) =>
            s
              .setName("estado")
              .setDescription("Cambia el estado de un pedido (avisa al Papu)")
              .addIntegerOption((o) => o.setName("pedido").setDescription("Número del pedido").setRequired(true).setMinValue(1))
              .addStringOption((o) =>
                o
                  .setName("estado")
                  .setDescription("Nuevo estado")
                  .setRequired(true)
                  .addChoices(
                    { name: "🎬 En producción (o corrección)", value: "en_produccion" },
                    { name: "✅ Entregado", value: "entregado" },
                    { name: "⏳ De vuelta a la cola", value: "en_cola" },
                    { name: "🚫 Rechazado", value: "rechazado" },
                    { name: "✖️ Cancelado", value: "cancelado" },
                  ),
              )
              .addStringOption((o) => o.setName("motivo").setDescription("Motivo (se le cuenta al Papu si se rechaza)").setMaxLength(300)),
          )
          .addSubcommand((s) =>
            s
              .setName("agregar")
              .setDescription("Registra un pedido de la tienda de Ko-fi")
              .addStringOption((o) =>
                o
                  .setName("producto")
                  .setDescription("Producto comprado")
                  .setRequired(true)
                  .addChoices(
                    ...(["express", "personalizado", "especial"] as const).map((v) => ({ name: PRODUCTS[v].label, value: v })),
                  ),
              )
              .addStringOption((o) => o.setName("ocasion").setDescription("Ocasión o tema libre").setRequired(true).addChoices(...occasionChoices(true)))
              .addStringOption((o) => o.setName("para").setDescription("Nombre de quien recibe el video").setRequired(true).setMaxLength(80))
              .addStringOption((o) => o.setName("vocaloid").setDescription("Vocaloid principal").setRequired(true).addChoices(...castChoices))
              .addStringOption((o) => o.setName("detalles").setDescription("Lo que dejó el comprador").setRequired(true).setMaxLength(1000))
              .addStringOption((o) => o.setName("comprador").setDescription("Nombre en Ko-fi").setMaxLength(80))
              .addStringOption((o) => o.setName("vocaloid2").setDescription("Segundo Vocaloid").addChoices(...castChoices))
              .addStringOption((o) => o.setName("vocaloid3").setDescription("Tercer Vocaloid (solo el de 2 min)").addChoices(...castChoices))
              .addStringOption((o) => o.setName("pronunciacion").setDescription("Cómo se pronuncia el nombre").setMaxLength(80))
              .addStringOption((o) => o.setName("fecha_limite").setDescription("AAAA-MM-DD").setMaxLength(10))
              .addBooleanOption((o) => o.setName("publicar").setDescription("¿Dio permiso para publicarlo?"))
              .addUserOption((o) => o.setName("papu").setDescription("Si el comprador está en el servidor, para avisarle")),
          )
          .toJSON(),
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
          .setName("calendario")
          .setDescription("Miku publica el calendario en #calendario (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addStringOption((o) =>
            o.setName("texto").setDescription("Fechas y videos; separa líneas con | (ej.: Lun 20: Teto | Jue 23: Miku)").setRequired(true).setMaxLength(1500),
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName("estreno")
          .setDescription("Miku anuncia un video nuevo en #anuncios (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addStringOption((o) => o.setName("titulo").setDescription("Título del video").setRequired(true).setMaxLength(150))
          .addStringOption((o) => o.setName("enlace").setDescription("Enlace al video").setRequired(true).setMaxLength(300))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("noticia")
          .setDescription("Miku comparte una noticia Vocaloid en #anuncios (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addStringOption((o) => o.setName("texto").setDescription("La noticia (puedes incluir el enlace)").setRequired(true).setMaxLength(1500))
          .toJSON(),
      ];
    case "luka":
      return [
        new SlashCommandBuilder()
          .setName("tip")
          .setDescription("Comparte un tip o curiosidad para los videos (Atún y superiores), con su fuente")
          .addStringOption((o) => o.setName("texto").setDescription("El dato, claro y corto").setRequired(true).setMaxLength(500))
          .addStringOption((o) => o.setName("fuente").setDescription("Enlace a la fuente (VocaDB, wiki, entrevista, video…)").setRequired(true).setMaxLength(300))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("tip-usado")
          .setDescription("Marca un tip como usado en un video y lo lleva al Salón de la Fama (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addIntegerOption((o) => o.setName("tip").setDescription("Número del tip").setRequired(true).setMinValue(1))
          .addStringOption((o) => o.setName("video").setDescription("Título del video donde se usó").setRequired(true).setMaxLength(150))
          .toJSON(),
      ];
    case "neru":
      return [
        new SlashCommandBuilder()
          .setName("strikes")
          .setDescription("Strikes activos de un Papu (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true))
          .toJSON(),
        new SlashCommandBuilder()
          .setName("perdonar")
          .setDescription("Borra los strikes activos de un Papu, por un falso positivo (solo GyroP)")
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addUserOption((o) => o.setName("papu").setDescription("Papu").setRequired(true))
          .toJSON(),
      ];
    default:
      return [];
  }
}
