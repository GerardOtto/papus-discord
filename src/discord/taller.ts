// Taller de los Papus en Discord (PLAN §2): /aportar de Teto. Lo escrito pasa por el filtro fijo de Neru (nunca el
// LLM), queda pendiente y llega a #registro-bots con «Aprobar» y «Rechazar» (GyroP o un Mod). Lo aprobado se usa al
// tiro y al reiniciar (las preguntas en /trivia, las adivinanzas en las bodas, la frase en el 1vs1), siempre con
// crédito; a quien lo escribió, Teto le avisa por privado. Las reglas y el estado viven en src/taller/.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type SendableChannels,
} from "discord.js";
import type { BrideId } from "../bodas/rules";
import type { WeddingService } from "../bodas/service";
import { stripNickTag } from "../levels/rules";
import { logError } from "../log";
import type { NivelMembresia } from "../membresias/rules";
import type { PeleaService } from "../peleas/service";
import { DESDE, NOMBRE_APORTE, puedeAportar, type Aporte, type DatosAporte, type DatosAdivinanza, type DatosFrase, type DatosPregunta, type DatosPropuesta, type TallerService, type TipoAporte } from "../taller/service";
import type { Question } from "../trivia/rules";
import type { TriviaService } from "../trivia/service";
import { CHANNELS, findTextChannel } from "./channels";

const P = "taller:";
/** Pendientes por Papu a la vez (para que no llene la revisión). */
const MAX_PENDIENTES = 5;

export interface TallerDiscordDeps {
  taller: TallerService;
  niveles: readonly NivelMembresia[];
  nivel: (userId: string) => Promise<NivelMembresia | null>;
  owners: ReadonlySet<string>;
  isStaff: (userId: string) => Promise<boolean>;
  /** Filtro fijo de Neru: el motivo si no pasa, o null. */
  filtro: (text: string) => string | null;
  /** Inicio de la temporada de la tienda (1 luchador propuesto por temporada). */
  temporadaDesde: () => number;
  trivia?: TriviaService | null;
  weddings?: WeddingService | null;
  peleas?: PeleaService | null;
  /** Nombre de cada Vocaloid y luchador (para los textos). */
  nombreDe: (id: string) => string;
  teto: Client;
  guild: () => Guild;
  sendable: (channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
}

const limpio = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

export class TallerDiscord {
  constructor(private readonly d: TallerDiscordDeps) {}

  /** Al conectar: lo aprobado vuelve a la trivia, las bodas y las peleas (viven en memoria). */
  start(): void {
    for (const a of this.d.taller.aprobados()) this.aplicar(a);
  }

  /** Usa un aporte aprobado. */
  private aplicar(a: Aporte): void {
    try {
      if (a.tipo === "pregunta" && this.d.trivia) {
        const p = a.datos as DatosPregunta;
        const q: Question = {
          id: `taller-${a.id}`,
          kind: "opciones",
          topic: "papus",
          level: p.dificultad,
          text: p.texto,
          answer: p.correcta,
          wrong: [...p.incorrectas],
          accepted: [p.correcta],
          fact: `✍️ Pregunta escrita por ${a.nombre}`,
        };
        this.d.trivia.addQuestion(q);
      } else if (a.tipo === "adivinanza" && this.d.weddings) {
        const r = a.datos as DatosAdivinanza;
        this.d.weddings.addRiddle(r.vocaloid as BrideId, { adivinanza: `${r.adivinanza} *(adivinanza de ${a.nombre})*`, respuestas: r.respuestas });
      } else if (a.tipo === "frase" && this.d.peleas) {
        const f = a.datos as DatosFrase;
        this.d.peleas.setEspecial(f.luchador, `${f.texto} *(frase de ${a.nombre})*`);
      }
    } catch (e) {
      logError(`aporte ${a.id}`, e);
    }
  }

  /** /aportar <tipo> …: valida, guarda y manda a revisión. */
  async aportar(i: ChatInputCommandInteraction): Promise<void> {
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const tipo = i.options.getSubcommand() as TipoAporte;
    const n = await this.d.nivel(i.user.id);
    const staff = this.d.owners.has(i.user.id) || (await this.d.isStaff(i.user.id));
    if (!staff && !puedeAportar(this.d.niveles, n, tipo)) {
      const desde = this.d.niveles.find((x) => x.id === DESDE[tipo]);
      return void (await reply(`Escribir una **${NOMBRE_APORTE[tipo]}** es de las membresías desde ${desde ? `${desde.emoji} ${desde.nombre}` : "un nivel más alto"}. Mira #💎・membresías. ✍️`));
    }
    if (this.d.taller.pendientes(i.user.id) >= MAX_PENDIENTES) return void (await reply(`Ya tienes ${MAX_PENDIENTES} aportes esperando revisión. Cuando los revisen, mandas más. ✍️`));
    if (tipo === "luchador" && !staff && this.d.taller.contar(i.user.id, "luchador", this.d.temporadaDesde()) >= 1)
      return void (await reply("Ya propusiste tu luchador de esta temporada. ¡En la próxima, otro! ⚔️"));
    const datos = this.datos(i, tipo);
    if (typeof datos === "string") return void (await reply(datos));
    const textos = Object.values(datos).flat().filter((v): v is string => typeof v === "string");
    for (const t of textos) {
      const malo = this.d.filtro(t);
      if (malo) return void (await reply(`No puedo mandar eso a revisión (${malo}). Cámbialo y vuelve a intentarlo. ✍️`));
    }
    const nombre = stripNickTag(i.member && "displayName" in i.member ? i.member.displayName : i.user.displayName);
    const a = this.d.taller.crear(i.user.id, nombre, tipo, datos);
    await this.revision(a).catch((e) => logError("revisión del taller", e));
    await reply(`¡Gracias! Tu **${NOMBRE_APORTE[tipo]}** (#${a.id}) quedó en revisión. Te aviso por privado cuando GyroP o un Mod la revise. ✨`);
  }

  private datos(i: ChatInputCommandInteraction, tipo: TipoAporte): DatosAporte | string {
    const s = (k: string) => limpio(i.options.getString(k));
    switch (tipo) {
      case "pregunta": {
        const p: DatosPregunta = { texto: s("pregunta"), correcta: s("correcta"), incorrectas: [s("incorrecta1"), s("incorrecta2"), s("incorrecta3")], dificultad: (i.options.getString("dificultad") as DatosPregunta["dificultad"]) ?? "medio" };
        const todas = [p.correcta, ...p.incorrectas].map((x) => x.toLowerCase());
        if (!p.texto.endsWith("?")) p.texto += "?";
        if (new Set(todas).size < 4) return "Las cuatro respuestas tienen que ser distintas.";
        return p;
      }
      case "adivinanza": {
        const respuestas = s("respuestas").split(/[,;\/]/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
        if (!respuestas.length) return "Escribe al menos una respuesta.";
        return { vocaloid: s("vocaloid"), adivinanza: s("adivinanza"), respuestas } satisfies DatosAdivinanza;
      }
      case "frase": {
        const luchador = s("luchador");
        if (!this.d.peleas?.fighters.includes(luchador)) return "Ese luchador no está en el 1vs1 (elígelo de la lista).";
        return { luchador, texto: s("texto") } satisfies DatosFrase;
      }
      default:
        return { nombre: s("nombre"), detalle: s("detalle") } satisfies DatosPropuesta;
    }
  }

  private describir(a: Aporte): string {
    switch (a.tipo) {
      case "pregunta": {
        const p = a.datos as DatosPregunta;
        return `❓ **${p.texto}** (${p.dificultad})\n✅ ${p.correcta}\n❌ ${p.incorrectas.join(" · ")}`;
      }
      case "adivinanza": {
        const r = a.datos as DatosAdivinanza;
        return `💍 Para **${this.d.nombreDe(r.vocaloid)}**: ${r.adivinanza}\n✅ ${r.respuestas.join(" · ")}`;
      }
      case "frase": {
        const f = a.datos as DatosFrase;
        return `⚔️ Especial de **${this.d.nombreDe(f.luchador)}**: ${f.texto}`;
      }
      default: {
        const p = a.datos as DatosPropuesta;
        return `**${p.nombre}**\n${p.detalle}`;
      }
    }
  }

  /** Aviso en #registro-bots con los botones de revisión. */
  private async revision(a: Aporte): Promise<void> {
    const ch = findTextChannel(this.d.guild(), CHANNELS.registro);
    if (!ch) return this.d.report(`✍️ Aporte #${a.id} de <@${a.userId}> (${NOMBRE_APORTE[a.tipo]}) sin canal de revisión.`);
    const send = await this.d.sendable(ch.id);
    const manual = a.tipo === "luchador" || a.tipo === "consumible";
    await send.send({
      content: `✍️ **Aporte #${a.id}** · ${NOMBRE_APORTE[a.tipo]} de <@${a.userId}>\n${this.describir(a)}${manual ? "\n-# Si lo apruebas, se le avisa al Papu; agregarlo es a mano (config)." : ""}`.slice(0, 2000),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${P}ok:${a.id}`).setLabel("Aprobar").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${P}no:${a.id}`).setLabel("Rechazar").setStyle(ButtonStyle.Danger),
        ),
      ],
      allowedMentions: { parse: [] },
    });
  }

  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [accion, id] = i.customId.slice(P.length).split(":");
    if (!this.d.owners.has(i.user.id) && !(await this.d.isStaff(i.user.id))) return void (await i.reply({ content: "Eso lo revisan GyroP y los Mods. ✍️", flags: MessageFlags.Ephemeral })), true;
    const a = this.d.taller.resolver(Number(id), accion === "ok", i.user.id);
    if (!a) return void (await i.update({ content: `${i.message.content}\n(ya estaba revisado)`, components: [] })), true;
    if (a.estado === "aprobado") this.aplicar(a);
    await i.update({ content: `${i.message.content}\n${a.estado === "aprobado" ? "✅ Aprobado" : "❌ Rechazado"} por <@${i.user.id}>.`.slice(0, 2000), components: [], allowedMentions: { parse: [] } });
    const user = await this.d.teto.users.fetch(a.userId).catch(() => null);
    const aviso =
      a.estado === "aprobado"
        ? `✅ ¡Aprobaron tu **${NOMBRE_APORTE[a.tipo]}** (#${a.id})! ${a.tipo === "pregunta" ? "Ya sale en /trivia con tu nombre." : a.tipo === "adivinanza" ? "Ya puede salir en las bodas, con tu nombre." : a.tipo === "frase" ? "Ya suena en el 1vs1, con tu nombre." : "GyroP lo va a agregar."} ¡Gracias, Papu! ✨`
        : `Tu **${NOMBRE_APORTE[a.tipo]}** (#${a.id}) no quedó esta vez. ¡Prueba con otra idea! ✍️`;
    await user?.send({ content: aviso }).catch(() => {});
    return true;
  }
}
