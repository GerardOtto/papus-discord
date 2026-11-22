// 1vs1 de los Vocaloids en Discord (PLAN §3.7). Teto publica el banner del VS con un boton por Vocaloid: al tocarlo
// se abre un cuadro para escribir cuantas Shaulitas apostar. Al cerrar las apuestas, la pelea se narra en
// un mensaje que se edita cada segundo (una linea por turno, con la vida de cada uno) y al final sale el GIF del
// ganador con lo que cobro cada Papu. Peleas automaticas a las horas de config/peleas.json y /pelea de GyroP.
import { existsSync, readFileSync } from "node:fs";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type ModalSubmitInteraction,
  type SendableChannels,
} from "discord.js";
import type { AmbientEvent } from "../ambiente/service";
import { BOT_IDS, type BotId } from "../config";
import { kvGet, kvSet, type Db } from "../db/database";
import type { CharacterInfo } from "../engine/reader";
import { logError, type LogFn } from "../log";
import { avatarFile, bannerImage, resultGif, teamAvatar, type FighterCard, type StatMax } from "../peleas/images";
import {
  clockIn,
  equipo,
  esEquipo,
  finalLine,
  finalLineTeams,
  maxTurnosEquipo,
  miembros,
  nextSlotAt,
  pickPair,
  pickTeams,
  turnLine,
  type FighterId,
  type Nombres,
  type Resultado,
  type ResultadoEquipos,
} from "../peleas/rules";
import type { Liquidacion, Pelea, PeleaService } from "../peleas/service";
import { conRelato, tabla, type LuchadorMarcador } from "../peleas/marcador";
import type { Phrases } from "../phrases/catalog";
import { weekStart } from "../coins/rules";
import { marcoDe } from "../membresias/marco";
import type { NivelMembresia } from "../membresias/rules";
import { viaLanzamiento, type LanzarPort } from "../membresias/service";
import { dayKey } from "../time";
import { avisoPing } from "./avisos";
import { findTextChannel } from "./channels";

const PREFIX = "pelea:";
const AUTO_KEY = "peleas:auto";
/** Cada cuanto, como mucho, se actualizan los montos apostados en el banner. */
const TOTALS_EVERY_MS = 4000;
/** Cuánto antes del cierre de las apuestas se etiqueta otra vez a los ⚔️ Ludópata. */
const LAST_CALL_MS = 15_000;
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
const fmtOdds = (n: number) => `×${n.toFixed(2).replace(".", ",")}`;
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
/** Nombre sin acentos, signos ni mayúsculas (para buscar luchadores: "Don Ramón" = "donramon"). */
const nameKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Papu que lanzó una pelea (membresía o prestigio). */
export interface Lanzador {
  userId: string;
  nivel: NivelMembresia | null;
  prestigio: boolean;
}

export interface PeleasDiscordDeps {
  /** Ambiente casual (PLAN §3.13): el que perdio (o otro Vocaloid) comenta la pelea en #general. */
  ambient?: (e: AmbientEvent) => void;
  peleas: PeleaService;
  phrases: Phrases;
  db: Db;
  characters: Record<BotId, CharacterInfo>;
  /** GyroP: lanza o cancela peleas a mano. */
  owners: ReadonlySet<string>;
  /** GyroP o un Mod: tambien lanzan o cancelan peleas (pedido de GyroP, 8 nov. 2026). Sin esto, solo GyroP. */
  isStaff?: (userId: string) => Promise<boolean>;
  /** Membresías y prestigio: lanzan peleas con /pelea (PLAN §2). Sin esto, solo GyroP y los Mods. */
  lanzar?: LanzarPort;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  timeZone: string;
  /** Emoji con la cara de un luchador (el de las carreras) para el marcador; null = sin cara. */
  cara?: (id: FighterId) => string | null;
  log: LogFn;
}

export class PeleasDiscord {
  /** Banner de la pelea en curso (para actualizar los montos y cerrar los botones). */
  private banner: Message | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCallTimer: ReturnType<typeof setTimeout> | null = null;
  private totalsTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Frase de Teto y mencion del aviso del banner de la pelea en curso. */
  private head: { id: string; text: string; ping?: string } | null = null;
  /** Quién lanzó la pelea en curso con su membresía o su prestigio (null = automática, GyroP o un Mod). */
  private lanzador: (Lanzador & { pelea: string }) | null = null;

  constructor(private readonly d: PeleasDiscordDeps) {}

  private get s(): PeleaService {
    return this.d.peleas;
  }

  /** Nombre del luchador: el del motor (Vocaloids del servidor) o el de config/peleas.json (invitados). Equipo: «Teto y Miku». */
  private name(id: FighterId): string {
    if (esEquipo(id)) return miembros(id).map((x) => this.name(x)).join(" y ");
    return this.d.characters[id as BotId]?.displayName ?? this.s.settings.luchadores[id]?.nombre ?? id;
  }

  /** Color del luchador (numero): el del motor o el de config/peleas.json. Equipo: el de su primer miembro. */
  private colorOf(id: FighterId): number {
    if (esEquipo(id)) return this.colorOf(miembros(id)[0]!);
    const c = this.d.characters[id as BotId]?.color;
    return c ?? parseInt((this.s.settings.luchadores[id]?.color ?? "#ffb020").slice(1), 16);
  }

  /** Vocaloids que pueden pelear: los de la config que tienen avatar. */
  private fighters(): FighterId[] {
    return this.s.fighters.filter((b) => existsSync(avatarFile(b)));
  }

  // ───────────────────────── arranque y horarios ─────────────────────────

  /** Al conectar: devuelve lo apostado en peleas que quedaron a medias (reinicio) y avisa en su banner. */
  async start(): Promise<void> {
    for (const { pelea, devueltas } of this.s.recover()) {
      const total = devueltas.reduce((a, x) => a + x.cantidad, 0);
      if (pelea.canal && pelea.mensaje) {
        const ch = await this.d.sendable("teto", pelea.canal).catch(() => null);
        const msg = ch && "messages" in ch ? await ch.messages.fetch(pelea.mensaje).catch(() => null) : null;
        await msg
          ?.edit({ content: `${msg.content}\n\n⚠️ Esta pelea se canceló (me reinicié a la mitad). Le devolví a cada Papu lo que apostó.`, components: [] })
          .catch(() => {});
      }
      await this.d.report(`⚔️ Pelea ${this.name(pelea.a)} vs ${this.name(pelea.b)} cancelada por reinicio: devolví ${fmt(total)} Shaulitas a ${devueltas.length} Papus.`);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.lastCallTimer) clearTimeout(this.lastCallTimer);
    if (this.totalsTimer) clearTimeout(this.totalsTimer);
  }

  /** Zona de los horarios de las peleas (config/peleas.json -> zona; si no, la de la cuota). */
  private get zone(): string {
    return this.s.settings.zona ?? this.d.timeZone;
  }

  /** Cada minuto: si toca una pelea automatica (en la zona de config/peleas.json), la abre en su canal. */
  async tick(now = Date.now()): Promise<void> {
    if (this.stopped || !this.s.settings.horarios.length) return;
    const hhmm = clockIn(new Date(now), this.zone);
    if (!this.s.settings.horarios.includes(hhmm)) return;
    const slot = `${dayKey(new Date(now), this.zone)} ${hhmm}`;
    if (kvGet(this.d.db, AUTO_KEY) === slot) return;
    kvSet(this.d.db, AUTO_KEY, slot);
    if (this.s.active()) return;
    const ch = findTextChannel(this.d.guild(), this.s.settings.canal, this.s.settings.respaldo);
    if (!ch) return void (await this.d.report(`⚔️ No encontré el canal #${this.s.settings.canal} (ni #${this.s.settings.respaldo}) para la pelea de las ${hhmm}.`));
    // 2 contra 2 (18 nov. 2026): parte de las automáticas sale en equipos (config/peleas.json -> equipos.probabilidad).
    const ids = this.fighters();
    const dos = Math.random() < (this.s.settings.equipos?.probabilidad ?? 0) && ids.length >= 4;
    const pair = dos ? pickTeams(ids) : pickPair(ids, this.s.lastPair());
    await this.launch(ch.id, pair[0], pair[1]);
  }

  /**
   * Los dos lados de /pelea: 1vs1 (vocaloid1 vs vocaloid2) o 2vs2 (vocaloid1 y vocaloid2 vs vocaloid3 y vocaloid4). Lo
   * que falte sale al azar sin repetir a nadie. `elige` = false: todo al azar. Devuelve el motivo si algo no sirve.
   */
  private sides(i: ChatInputCommandInteraction, elige: boolean): { pair: [FighterId, FighterId] } | { error: string } {
    const ids = this.fighters();
    const dos = i.options.getString("modo") === "2vs2";
    if (dos && ids.length < 4) return { error: "Faltan luchadores para un 2vs2." };
    const pedidos = elige ? ["vocaloid1", "vocaloid2", ...(dos ? ["vocaloid3", "vocaloid4"] : [])].map((o) => this.resolve(i.options.getString(o))) : [];
    for (const x of pedidos) if (x && !ids.includes(x)) return { error: `${this.name(x)} no está entre los luchadores (o le falta su avatar).` };
    const elegidos = pedidos.filter((x): x is FighterId => !!x);
    if (new Set(elegidos).size !== elegidos.length) return { error: "Elige luchadores distintos." };
    if (!dos) {
      const [a1, a2] = pedidos;
      if (a1 && a2) return { pair: [a1, a2] };
      if (a1 || a2) {
        const fixed = (a1 ?? a2)!;
        const rest = ids.filter((x) => x !== fixed);
        return { pair: [fixed, rest[Math.floor(Math.random() * rest.length)]!] };
      }
      return { pair: pickPair(ids, this.s.lastPair()) };
    }
    // 2vs2: los huecos se llenan al azar con los que no están.
    const libres = ids.filter((x) => !elegidos.includes(x));
    const slot = (k: number) => pedidos[k] ?? libres.splice(Math.floor(Math.random() * libres.length), 1)[0]!;
    const four = [0, 1, 2, 3].map(slot);
    return { pair: [equipo(four[0]!, four[1]!), equipo(four[2]!, four[3]!)] };
  }

  // ───────────────────────── /pelea (GyroP) ─────────────────────────

  /** Opciones de /pelea mientras GyroP escribe: luchadores con avatar cuyo nombre o id contiene lo escrito. */
  async autocomplete(i: AutocompleteInteraction): Promise<void> {
    const q = nameKey(String(i.options.getFocused()));
    const list = this.fighters()
      .map((id) => ({ id, name: this.name(id) }))
      .filter((f) => !q || nameKey(f.name).includes(q) || f.id.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .slice(0, 25);
    await i.respond(list.map((f) => ({ name: f.name, value: f.id })));
  }

  /** Id de un luchador a partir de lo que escribio GyroP (el id del autocompletar o el nombre a mano). */
  private resolve(text: string | null): FighterId | null {
    if (!text) return null;
    const ids = this.fighters();
    if (ids.includes(text)) return text;
    const k = nameKey(text);
    return ids.find((id) => nameKey(this.name(id)) === k || id === k) ?? text;
  }

  async pelea(i: ChatInputCommandInteraction): Promise<void> {
    const owner = this.d.owners.has(i.user.id);
    if (!owner && !(await this.d.isStaff?.(i.user.id))) return this.peleaMembresia(i);
    if (i.options.getBoolean("cancelar")) {
      const res = this.s.cancel();
      if (!res) return void (await i.reply({ content: "No hay ninguna pelea en curso.", flags: MessageFlags.Ephemeral }));
      this.stop();
      this.stopped = false;
      await this.banner?.edit({ content: `${this.banner.content}\n\n🚫 ${owner ? "GyroP" : "Un Mod"} canceló esta pelea: le devolví a cada Papu lo que apostó.`, components: [] }).catch(() => {});
      this.banner = null;
      const total = res.devueltas.reduce((a, x) => a + x.cantidad, 0);
      return void (await i.reply({ content: `🚫 Pelea cancelada: devolví ${fmt(total)} Shaulitas a ${res.devueltas.length} Papus.`, flags: MessageFlags.Ephemeral }));
    }
    if (this.s.active()) return void (await i.reply({ content: "Ya hay una pelea en curso: espera a que termine (o cancélala con `cancelar`).", flags: MessageFlags.Ephemeral }));
    const lados = this.sides(i, true);
    if ("error" in lados) return void (await i.reply({ content: lados.error, flags: MessageFlags.Ephemeral }));
    const pair = lados.pair;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const ok = await this.launch(i.channelId, pair[0], pair[1]);
    await i.editReply({ content: ok ? `⚔️ ¡Pelea lanzada! ${this.name(pair[0])} vs ${this.name(pair[1])}.` : "No pude lanzarla (¿ya hay otra en curso?)." });
  }

  /**
   * /pelea de un Papu con membresía (PLAN §2): según su nivel lanza 1 a 3 peleas al día, al azar o eligiendo a los
   * luchadores; el premio de prestigio da 1 a la semana eligiendo. Va siempre a #casino, con «lanzada por @Papu».
   */
  private async peleaMembresia(i: ChatInputCommandInteraction): Promise<void> {
    const l = this.d.lanzar;
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
    if (!l) return void (await reply("¡Eso solo lo usan GyroP y los Mods! 🥖"));
    if (i.options.getBoolean("cancelar")) return void (await reply("Cancelar peleas es solo de GyroP y los Mods. 🥖"));
    const n = await l.nivel(i.user.id);
    const day = dayKey(new Date(), this.d.timeZone);
    const via = viaLanzamiento(l, n, l.prestigio(i.user.id), i.user.id, "pelea", day, weekStart(day));
    if (!via) {
      const dia = n?.peleas.dia ?? 0;
      return void (await reply(
        dia
          ? `Ya lanzaste tus **${dia}** ${dia === 1 ? "pelea" : "peleas"} de hoy. ¡Mañana hay más! ⚔️`
          : "Lanzar peleas es un beneficio de las **membresías** de Ko-fi (y del **prestigio**: 1 por semana). Mira #💎・membresías. ⚔️",
      ));
    }
    if (this.s.active()) return void (await reply("Ya hay una pelea en curso: espera a que termine. ⚔️"));
    const ch = findTextChannel(this.d.guild(), this.s.settings.canal, this.s.settings.respaldo);
    if (!ch) return void (await reply(`No encontré #${this.s.settings.canal}.`));
    const pidio = ["vocaloid1", "vocaloid2", "vocaloid3", "vocaloid4"].some((o) => i.options.getString(o));
    const lados = this.sides(i, via.elige);
    if ("error" in lados) return void (await reply(lados.error));
    const pair = lados.pair;
    const last = this.s.lastPair();
    if (via.elige && last && new Set([...pair, ...last]).size === 2) return void (await reply("Esa pareja acaba de pelear: elige otra. ⚔️"));
    const nota = !via.elige && pidio ? `\n-# Con ${n ? `${n.emoji} ${n.nombre}` : "tu nivel"} los luchadores salen al azar (desde 🥖 Baguette los eliges).` : "";
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    l.membresias.anotarLanzamiento(i.user.id, via.key, via.day);
    const ok = await this.launch(ch.id, pair[0], pair[1], { userId: i.user.id, nivel: via.via === "prestigio" ? null : n, prestigio: via.via === "prestigio" }).catch((e) => {
      logError("pelea lanzada", e);
      return false;
    });
    if (!ok) l.membresias.devolverLanzamiento(i.user.id, via.key, via.day);
    await i.editReply({ content: ok ? `⚔️ ¡Lanzaste **${this.name(pair[0])}** vs **${this.name(pair[1])}** en <#${ch.id}>!${nota}` : "No pude lanzarla (¿ya hay otra en curso?). No se te descontó." });
  }

  // ───────────────────────── banner y apuestas ─────────────────────────

  /** Avatar de un lado: el del luchador o, en un 2vs2, las dos caras del equipo. */
  private async avatarOf(id: FighterId): Promise<Buffer> {
    if (!esEquipo(id)) return readFileSync(avatarFile(id));
    return teamAvatar(miembros(id).map((x) => ({ avatar: readFileSync(avatarFile(x)), color: hex(this.colorOf(x)) })));
  }

  /** Ficha del banner. Equipo: la vida sumada y el promedio de ataque, defensa y agilidad. */
  private async card(id: FighterId, cuota: number): Promise<FighterCard> {
    const ls = this.s.side(id);
    const avg = (k: "ataque" | "defensa" | "agilidad") => Math.round(ls.reduce((a, l) => a + l[k], 0) / ls.length);
    return { name: this.name(id), color: hex(this.colorOf(id)), avatar: await this.avatarOf(id), vida: ls.reduce((a, l) => a + l.vida, 0), ataque: avg("ataque"), defensa: avg("defensa"), agilidad: avg("agilidad"), cuota };
  }

  /** Máximos de las barras; en un 2vs2, la vida se compara contra la de dos. */
  private statMax(dos = false): StatMax {
    const all = Object.values(this.s.settings.luchadores);
    return {
      vida: Math.max(...all.map((l) => l!.vida)) * (dos ? 2 : 1),
      ataque: Math.max(...all.map((l) => l!.ataque)),
      defensa: Math.max(...all.map((l) => l!.defensa)),
      agilidad: Math.max(...all.map((l) => l!.agilidad)),
    };
  }

  /** Texto del banner. `ping` (la mencion del rol de avisos) va al principio y se conserva en cada edicion. */
  private bannerText(p: Pelea, open: boolean, ping?: string): string {
    const a = this.s.settings.apuestas;
    const [ta, tb] = this.s.totals(p);
    const vs = `${esEquipo(p.a) ? "👥 2 contra 2: " : ""}**${this.name(p.a)}** vs **${this.name(p.b)}**`;
    const pot = `📊 Apostado: **${this.name(p.a)}** ${fmt(ta.monto)} (${ta.papus} ${ta.papus === 1 ? "Papu" : "Papus"}) · **${this.name(p.b)}** ${fmt(tb.monto)} (${tb.papus} ${tb.papus === 1 ? "Papu" : "Papus"})`;
    // La frase y la mencion se eligen una vez por pelea: las ediciones del banner (montos, cierre) las conservan.
    if (this.head?.id !== p.id) this.head = { id: p.id, text: this.d.phrases.pick("teto", "pelea_anuncio", { texto: vs }), ping };
    const por = this.lanzador?.pelea === p.id ? this.lanzador : null;
    const lanzada = por ? `\n🎟️ Pelea lanzada por <@${por.userId}>${por.nivel ? ` · ${por.nivel.emoji} ${por.nivel.nombre}` : por.prestigio ? " · 🌟 prestigio" : ""}` : "";
    const head = (this.head.ping ? `🔔 ${this.head.ping}\n${this.head.text}` : this.head.text) + lanzada;
    if (!open) return [head, "🔒 **Apuestas cerradas**: ¡empieza la pelea!", pot].join("\n");
    return [
      head,
      `💰 Apuesta de **${a.minima} a ${a.maxima}** Shaulitas. Si aciertas, cobras tu apuesta × la cuota. Cierra <t:${Math.floor(p.cierraAt / 1000)}:R>.`,
      pot,
    ].join("\n");
  }

  private buttons(p: Pelea, open: boolean): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}a:${p.id}:${p.a}`)
        .setLabel(`Apostar por ${this.name(p.a)} · ${fmtOdds(p.cuotas[0])}`)
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!open),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}a:${p.id}:${p.b}`)
        .setLabel(`Apostar por ${this.name(p.b)} · ${fmtOdds(p.cuotas[1])}`)
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!open),
      new ButtonBuilder().setCustomId(`${PREFIX}mia:${p.id}`).setLabel("Mi apuesta").setEmoji("🪙").setStyle(ButtonStyle.Secondary),
    );
  }

  /**
   * Abre la pelea en `channelId`: banner con botones y, a los `minutos`, la pelea. `por` = el Papu que la lanzó con
   * su membresía o su prestigio (el banner lo dice, con el estilo de su nivel).
   */
  async launch(channelId: string, a: FighterId, b: FighterId, por?: Lanzador): Promise<boolean> {
    const p = this.s.open(a, b, channelId);
    if (!p) return false;
    this.lanzador = por ? { ...por, pelea: p.id } : null;
    try {
      const png = await bannerImage(await this.card(a, p.cuotas[0]), await this.card(b, p.cuotas[1]), this.statMax(esEquipo(a)), marcoDe(por?.nivel));
      const ch = await this.d.sendable("teto", channelId);
      // Etiqueta a los que eligieron el aviso de peleas en #tus-roles (solo al publicar: editar no vuelve a etiquetar).
      const ping = avisoPing(this.d.guild(), "peleas");
      this.banner = await ch.send({
        content: this.bannerText(p, true, ping?.mention),
        files: [new AttachmentBuilder(png, { name: "pelea.png" })],
        components: [this.buttons(p, true)],
        allowedMentions: ping ? { roles: [ping.roleId] } : { parse: [] },
      });
      this.s.setMessage(p.id, channelId, this.banner.id);
    } catch (e) {
      // Sin banner no se puede apostar: se cancela (no hay apuestas que devolver todavia).
      this.s.cancel();
      throw e;
    }
    this.d.log(`⚔️ Pelea abierta: ${this.name(a)} (${fmtOdds(p.cuotas[0])}) vs ${this.name(b)} (${fmtOdds(p.cuotas[1])})`);
    this.closeTimer = setTimeout(() => void this.run(p.id).catch((e) => logError("pelea", e)), Math.max(0, p.cierraAt - Date.now()));
    // Último aviso a los ⚔️ Ludópata a los 15 s del cierre (pedido de GyroP, 8 nov. 2026), respondiendo al banner.
    const lastCall = p.cierraAt - Date.now() - LAST_CALL_MS;
    if (lastCall > 0) this.lastCallTimer = setTimeout(() => void this.lastCall(p.id).catch((e) => logError("último aviso de la pelea", e)), lastCall);
    return true;
  }

  /** "¡Quedan 15 segundos!": etiqueta otra vez el rol de avisos de peleas, si la pelea sigue abierta. */
  private async lastCall(id: string): Promise<void> {
    this.lastCallTimer = null;
    const p = this.s.get(id);
    if (this.stopped || !p || p.estado !== "abierta" || !p.canal || !this.banner) return;
    const ping = avisoPing(this.d.guild(), "peleas");
    if (!ping) return;
    const ch = await this.d.sendable("teto", p.canal);
    await ch.send({
      content: `🔔 ${ping.mention} ¡Quedan **${LAST_CALL_MS / 1000} segundos** para apostar en **${this.name(p.a)}** vs **${this.name(p.b)}**! ⏳`,
      reply: { messageReference: this.banner.id, failIfNotExists: false },
      allowedMentions: { roles: [ping.roleId], repliedUser: false },
    });
  }

  private refreshTotals(id: string): void {
    if (this.totalsTimer) return;
    this.totalsTimer = setTimeout(() => {
      this.totalsTimer = null;
      const p = this.s.get(id);
      if (!p || p.estado !== "abierta" || !this.banner) return;
      void this.banner.edit({ content: this.bannerText(p, true) }).catch((e) => logError("banner de la pelea", e));
    }, TOTALS_EVERY_MS);
  }

  /** Botones del banner. Devuelve false si el boton no es de aqui. */
  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(PREFIX)) return false;
    const [, action, id, lado] = i.customId.split(":") as [string, string, string, FighterId | undefined];
    const p = this.s.get(id);
    if (action === "relato") return void (await this.verRelato(i, id)), true;
    if (action === "mia") {
      const mine = p ? this.s.betOf(p.id, i.user.id) : null;
      const ganadas = this.s.coinsOf(i.user.id);
      const text = !p
        ? "Esa pelea ya no existe."
        : mine
          ? `🪙 Apostaste **${fmt(mine.cantidad)}** a **${this.name(mine.lado)}** (paga ${fmtOdds(mine.lado === p.a ? p.cuotas[0] : p.cuotas[1])}: si gana, cobras **${fmt(Math.floor(mine.cantidad * (mine.lado === p.a ? p.cuotas[0] : p.cuotas[1])))}**). Tienes ${fmt(ganadas)} Shaulitas.${mine.seguro ? "\n🍆 Asegurada con Gakupo: si pierde, te la devuelve completa." : ""}`
          : `Todavía no apuestas en esta pelea. Tienes ${fmt(ganadas)} Shaulitas.`;
      await i.reply({ content: text, components: p && mine ? this.seguroRow(p, i.user.id) : [], flags: MessageFlags.Ephemeral });
      return true;
    }
    // Seguro de Gakupo (mercado negro): asegura la apuesta de esta pelea.
    if (action === "seg") {
      const r = this.s.insure(id, i.user.id);
      const content = r.ok
        ? `🍆 **Apuesta asegurada.** Gakupo: *«Si tu Vocaloid cae, yo respondo por ti. Palabra de samurái.»* Si pierde, te devuelve todo lo apostado (también lo que sumes). Te quedan ${r.usos} ${r.usos === 1 ? "uso" : "usos"} del seguro.`
        : `❌ ${r.motivo}`;
      await i.update({ content, components: [] }).catch(() => i.reply({ content, flags: MessageFlags.Ephemeral }));
      return true;
    }
    if (action !== "a" || !lado) return false;
    if (!p || p.estado !== "abierta" || Date.now() >= p.cierraAt) return void (await i.reply({ content: "Las apuestas de esta pelea ya se cerraron. ⚔️", flags: MessageFlags.Ephemeral })), true;
    const prev = this.s.betOf(p.id, i.user.id);
    if (prev && prev.lado !== lado) return void (await i.reply({ content: `Ya apostaste por **${this.name(prev.lado)}**: en cada pelea se apuesta a uno solo.`, flags: MessageFlags.Ephemeral })), true;
    const { minima, maxima } = this.s.settings.apuestas;
    const room = maxima - (prev?.cantidad ?? 0);
    if (room <= 0) return void (await i.reply({ content: `Ya apostaste el máximo (${maxima}) en esta pelea. ¡Suerte! 🍀`, flags: MessageFlags.Ephemeral })), true;
    const ganadas = this.s.coinsOf(i.user.id);
    const desde = prev ? 1 : minima;
    if (ganadas < desde) return void (await i.reply({ content: `No te alcanza: tienes ${fmt(ganadas)} Shaulitas y la apuesta mínima es de ${minima}. Se ganan participando en el servidor. 🪙`, flags: MessageFlags.Ephemeral })), true;
    const cuota = lado === p.a ? p.cuotas[0] : p.cuotas[1];
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}m:${p.id}:${lado}`)
      .setTitle(`Apostar por ${this.name(lado)} (paga ${fmtOdds(cuota)})`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("cantidad")
            .setLabel(prev ? `¿Cuántas sumas? (llevas ${prev.cantidad})` : "¿Cuántas Shaulitas apuestas?")
            .setPlaceholder(`De ${desde} a ${Math.min(room, ganadas)} · tienes ${fmt(ganadas)} Shaulitas`)
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(4)
            .setRequired(true),
        ),
      );
    await i.showModal(modal);
    return true;
  }

  /** Cuadro de la cantidad. Devuelve false si no es de aqui. */
  async modal(i: ModalSubmitInteraction): Promise<boolean> {
    if (!i.customId.startsWith(`${PREFIX}m:`)) return false;
    const [, , id, lado] = i.customId.split(":") as [string, string, string, FighterId];
    const raw = i.fields.getTextInputValue("cantidad").replace(/[.\s]/g, "");
    const cantidad = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const res = this.s.bet(id, i.user.id, lado, cantidad);
    if (!res.ok) return void (await i.reply({ content: `❌ ${res.motivo}`, flags: MessageFlags.Ephemeral })), true;
    const p = this.s.get(id);
    await i.reply({
      content: `✅ Apostaste **${fmt(cantidad)}** a **${this.name(lado)}**${res.total !== cantidad ? ` (en total, ${fmt(res.total)})` : ""}. Paga ${fmtOdds(res.cuota)}: si gana, cobras **${fmt(Math.floor(res.total * res.cuota))}** Shaulitas. Te quedan ${fmt(res.monedas)} Shaulitas. 🍀`,
      components: p ? this.seguroRow(p, i.user.id) : [],
      flags: MessageFlags.Ephemeral,
    });
    this.refreshTotals(id);
    return true;
  }

  /** Botón del Seguro de Gakupo (si tiene usos y su apuesta aún no está asegurada). */
  private seguroRow(p: Pelea, userId: string): ActionRowBuilder<ButtonBuilder>[] {
    const usos = this.s.seguroUsos(userId);
    const mine = this.s.betOf(p.id, userId);
    if (!usos || !mine || mine.seguro || p.estado !== "abierta") return [];
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}seg:${p.id}`).setLabel(`Asegurar con Gakupo (te quedan ${usos})`).setEmoji("🍆").setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  // ───────────────────────── la pelea ─────────────────────────

  /**
   * Marcador en vivo (GyroP, 18 nov. 2026): la cara y la barra de vida de cada luchador, quién se enfrenta y una línea
   * corta con lo último que pasó. El relato largo queda guardado para «📜 Ver relato».
   */
  private embedMarcador(p: Pelea, vidas: [number[], number[]], activos: [number, number] | null, ultimo: string[], turno: number, color: number, titulo?: string): EmbedBuilder {
    const dos = esEquipo(p.a);
    const lado = (id: FighterId, k: 0 | 1): LuchadorMarcador[] => miembros(id).map((x, i) => ({ nombre: this.name(x), cara: this.d.cara?.(x) ?? null, vida: vidas[k][i]!, max: this.s.fighter(x).vida }));
    const max = dos ? maxTurnosEquipo(this.s.settings) : this.s.settings.pelea.maxTurnos;
    return new EmbedBuilder()
      .setTitle(titulo ?? `${dos ? "👥" : "⚔️"} ${this.name(p.a)} vs ${this.name(p.b)}`)
      .setColor(color)
      .setDescription(conRelato(tabla([lado(p.a, 0), lado(p.b, 1)], activos), ultimo))
      .setFooter({ text: turno ? `Turno ${turno} de ${max} como mucho` : dos ? `Hasta ${max} turnos; pierde el equipo que se queda sin nadie en pie` : `Hasta ${max} turnos; si nadie cae, gana quien conserve más vida` });
  }

  /** Botón para leer el relato completo (privado). */
  private botonRelato(id: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}relato:${id}`).setLabel("Ver relato").setEmoji("📜").setStyle(ButtonStyle.Secondary));
  }

  /**
   * Cierra las apuestas y muestra la pelea en el marcador (un turno cada `lineaMs`, que se edita en el mismo mensaje),
   * guarda el relato completo, paga y publica el final. Igual para 1vs1 y 2vs2.
   */
  private async run(id: string): Promise<void> {
    this.closeTimer = null;
    if (this.stopped) return;
    const r = this.s.fight(id);
    const p = this.s.get(id);
    if (!r || !p || !p.canal) return;
    if (this.totalsTimer) clearTimeout(this.totalsTimer);
    this.totalsTimer = null;
    await this.banner?.edit({ content: this.bannerText(p, false), components: [this.buttons(p, false)] }).catch((e) => logError("banner de la pelea", e));
    const A = miembros(p.a), B = miembros(p.b);
    // Los turnos del 1vs1 y del 2vs2 en un solo formato: quiénes se enfrentan, el intercambio y la vida de todos.
    const pasos = esEquipo(p.a)
      ? (r as ResultadoEquipos).turnos.map((t) => ({ par: t.par, t: t.turno, vidas: t.vidas, caen: t.caen }))
      : (r as Resultado).turnos.map((t) => ({ par: [0, 0] as [number, number], t, vidas: [[t.vida[0]], [t.vida[1]]] as [number[], number[]], caen: [] as [0 | 1, number][] }));
    const ch = await this.d.sendable("teto", p.canal);
    const neutral = 0xffb020;
    const inicio: [number[], number[]] = [A.map((x) => this.s.fighter(x).vida), B.map((x) => this.s.fighter(x).vida)];
    const msg = await ch.send({ embeds: [this.embedMarcador(p, inicio, null, [], 0, neutral)], allowedMentions: { parse: [] } });
    const relato: string[] = [];
    const step = this.s.settings.pelea.lineaMs;
    for (const x of pasos) {
      await sleep(step);
      if (this.stopped) return;
      const a = A[x.par[0]]!, b = B[x.par[1]]!;
      const n: Nombres = { nombres: [this.name(a), this.name(b)], luchadores: [this.s.fighter(a), this.s.fighter(b)] };
      const fuera = x.caen.map(([k, i]) => `💀 ¡**${this.name((k === 0 ? A : B)[i]!)}** queda fuera!`);
      relato.push([turnLine(x.t, n), ...fuera].join(" · "));
      // Tabla arriba y, debajo, el relato línea por línea como antes (GyroP, 18 nov. 2026).
      const ultimo = relato;
      await msg.edit({ embeds: [this.embedMarcador(p, x.vidas, x.par, ultimo, x.t.n, neutral)] }).catch((e) => logError("turno de la pelea", e));
    }
    await sleep(step);
    if (this.stopped) return;
    const fin = esEquipo(p.a) ? finalLineTeams(r as ResultadoEquipos, [this.name(p.a), this.name(p.b)]) : finalLine(r as Resultado, { nombres: [this.name(p.a), this.name(p.b)], luchadores: [this.s.fighter(p.a), this.s.fighter(p.b)] });
    relato.push(fin);
    this.s.setRelato(id, relato.join("\n"));
    const winner = r.ganador === 0 ? p.a : p.b;
    const last = pasos[pasos.length - 1]!;
    const titulo = `🏆 ¡${this.name(winner)} ${esEquipo(winner) ? "ganan" : "gana"}!`;
    await msg.edit({ embeds: [this.embedMarcador(p, last.vidas, null, relato, last.t.n, this.colorOf(winner), titulo)], components: [this.botonRelato(id)] }).catch((e) => logError("final de la pelea", e));
    const liq = this.s.settle(id);
    this.banner = null;
    if (liq) await this.publish(liq);
  }

  /** «📜 Ver relato»: el relato completo de una pelea, solo para quien lo pide (en partes si es largo). */
  private async verRelato(i: ButtonInteraction, id: string): Promise<void> {
    const relato = this.s.relato(id);
    const p = this.s.get(id);
    if (!relato || !p) return void (await i.reply({ content: "Esa pelea no tiene relato guardado. 📜", flags: MessageFlags.Ephemeral }));
    // Hasta 4.000 caracteres por recuadro y 6.000 por mensaje: se reparte en recuadros y, si hace falta, en varios mensajes.
    const partes: string[] = [];
    let actual = "";
    for (const linea of relato.split("\n")) {
      if (actual.length + linea.length + 1 > 3900) {
        partes.push(actual);
        actual = "";
      }
      actual += `${actual ? "\n" : ""}${linea}`;
    }
    if (actual) partes.push(actual);
    const titulo = `📜 ${this.name(p.a)} vs ${this.name(p.b)}`;
    const embeds = partes.map((d, k) => new EmbedBuilder().setTitle(partes.length > 1 ? `${titulo} (${k + 1}/${partes.length})` : titulo).setDescription(d).setColor(this.colorOf(p.ganador ?? p.a)));
    await i.reply({ embeds: [embeds[0]!], flags: MessageFlags.Ephemeral });
    for (const e of embeds.slice(1)) await i.followUp({ embeds: [e], flags: MessageFlags.Ephemeral });
  }

  private async publish(liq: Liquidacion): Promise<void> {
    const { pelea: p, resultado: r } = liq;
    const winner = r.ganador === 0 ? p.a : p.b;
    const loser = r.ganador === 0 ? p.b : p.a;
    const cuota = r.ganador === 0 ? p.cuotas[0] : p.cuotas[1];
    const dos = esEquipo(winner);
    const gif = await resultGif({
      winner: { name: this.name(winner), color: hex(this.colorOf(winner)), avatar: await this.avatarOf(winner) },
      loser: { name: this.name(loser), color: hex(this.colorOf(loser)), avatar: await this.avatarOf(loser) },
      subtitle: r.porPuntos ? `por puntos tras ${r.turnos.length} turnos` : `${dos ? "2 contra 2" : "por K.O."} en ${r.turnos.length} ${r.turnos.length === 1 ? "turno" : "turnos"}`,
      plural: dos,
      seed: Date.now() % 1_000_000,
    });
    const out = [this.d.phrases.pick("teto", "pelea_ganador", { ganador: `**${this.name(winner)}**` })];
    if (!liq.ganadores.length && !liq.perdedores.length) out.push("Nadie apostó en esta pelea. ¡La próxima, Papus! 🪙");
    if (liq.ganadores.length) {
      out.push(`🪙 **Cobran** (${this.name(winner)} pagaba ${fmtOdds(cuota)}):`);
      const shown = liq.ganadores.slice(0, 20);
      for (const x of shown) out.push(`• <@${x.userId}> gana **${fmt(x.pago)}** Shaulitas (apostó ${fmt(x.cantidad)})`);
      if (liq.ganadores.length > shown.length) out.push(`…y ${liq.ganadores.length - shown.length} Papus más.`);
    } else if (liq.perdedores.length) out.push(`Nadie le apostó a ${this.name(winner)}. 😱`);
    const sinSeguro = liq.perdedores.filter((x) => !x.seguro);
    const asegurados = liq.perdedores.filter((x) => x.seguro);
    if (sinSeguro.length) {
      const lost = sinSeguro.reduce((a, x) => a + x.cantidad, 0);
      out.push(`💸 ${sinSeguro.length} ${sinSeguro.length === 1 ? "Papu perdió" : "Papus perdieron"} ${fmt(lost)} Shaulitas apostando por ${this.name(loser)}.`);
    }
    // Seguro de Gakupo (mercado negro): recuperaron su apuesta.
    if (asegurados.length) out.push(`🍆 Gakupo le devolvió su apuesta a ${asegurados.map((x) => `<@${x.userId}> (${fmt(x.cantidad)})`).join(", ")}.`);
    // Cuando es la proxima pelea automatica (pedido de los Papus: "a veces no alcanzamos a llegar").
    const next = nextSlotAt(this.s.settings.horarios, this.zone, Date.now());
    if (next) {
      const roles = findTextChannel(this.d.guild(), "tus-roles");
      const where = roles ? ` ¿Quieres que te avise? Elige el aviso en <#${roles.id}> 🔔` : "";
      out.push(`⏰ Próxima pelea: <t:${Math.floor(next / 1000)}:F> (<t:${Math.floor(next / 1000)}:R>).${where}`);
    }
    let content = out.join("\n");
    if (content.length > 1990) content = `${content.slice(0, 1985)}…`;
    const ch = await this.d.sendable("teto", p.canal!);
    await ch.send({ content, files: [new AttachmentBuilder(gif, { name: "ganador.gif" })], allowedMentions: { parse: [] } });
    const apostado = [...liq.ganadores, ...liq.perdedores].reduce((a, x) => a + x.cantidad, 0);
    const pagado = liq.ganadores.reduce((a, x) => a + x.pago, 0);
    await this.d.report(`⚔️ Pelea ${this.name(p.a)} vs ${this.name(p.b)}: ganó ${this.name(winner)} (${r.turnos.length} turnos${r.porPuntos ? ", por puntos" : ""}). Apostado ${fmt(apostado)} · pagado ${fmt(pagado)}.`);
    this.d.log(`⚔️ Ganó ${this.name(winner)} vs ${this.name(loser)} · apostado ${apostado}, pagado ${pagado}`);
    this.d.ambient?.({
      tipo: "pelea",
      situacion: dos
        ? `En el 2 contra 2 de #casino, el equipo ${this.name(winner)} le ganó al equipo ${this.name(loser)} ${r.porPuntos ? "por puntos" : "dejándolos fuera"} y los Papus apostaron ${fmt(apostado)} Shaulitas. Si tú estabas en el equipo ${this.name(loser)}, perdiste: echa la culpa a tu compañero o pide la revancha; si estabas en el equipo ${this.name(winner)}, presume.`
        : `En el 1vs1 de #casino, ${this.name(winner)} le ganó a ${this.name(loser)} ${r.porPuntos ? "por puntos" : "por K.O."} y los Papus apostaron ${fmt(apostado)} Shaulitas. Si tú eres ${this.name(loser)}, perdiste: pon excusas o pide la revancha; si eres ${this.name(winner)}, presume.`,
      bots: [...miembros(loser), ...miembros(winner)].filter((x): x is BotId => (BOT_IDS as readonly string[]).includes(x)),
      comenta: "involucrado",
    });
  }
}
