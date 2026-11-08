// 1vs1 de los Vocaloids en Discord (PLAN §3.7). Teto publica el banner del VS con un boton por Vocaloid: al tocarlo
// se abre un cuadro para escribir cuantas Shaula-coins ganadas apostar. Al cerrar las apuestas, la pelea se narra en
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
import type { BotId } from "../config";
import { kvGet, kvSet, type Db } from "../db/database";
import type { CharacterInfo } from "../engine/reader";
import { logError, type LogFn } from "../log";
import { avatarFile, bannerImage, resultGif, type FighterCard, type StatMax } from "../peleas/images";
import { clockIn, finalLine, hpBar, nextSlotAt, pickPair, turnLine, type FighterId, type Nombres } from "../peleas/rules";
import type { Liquidacion, Pelea, PeleaService } from "../peleas/service";
import type { Phrases } from "../phrases/catalog";
import { dayKey } from "../time";
import { avisoPing } from "./avisos";
import { findTextChannel } from "./channels";

const PREFIX = "pelea:";
const AUTO_KEY = "peleas:auto";
/** Cada cuanto, como mucho, se actualizan los montos apostados en el banner. */
const TOTALS_EVERY_MS = 4000;
const MAX_LOG_LINES = 20;
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

export interface PeleasDiscordDeps {
  peleas: PeleaService;
  phrases: Phrases;
  db: Db;
  characters: Record<BotId, CharacterInfo>;
  /** GyroP: el unico que lanza o cancela peleas a mano. */
  owners: ReadonlySet<string>;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  timeZone: string;
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

  constructor(private readonly d: PeleasDiscordDeps) {}

  private get s(): PeleaService {
    return this.d.peleas;
  }

  /** Nombre del luchador: el del motor (Vocaloids del servidor) o el de config/peleas.json (invitados). */
  private name(id: FighterId): string {
    return this.d.characters[id as BotId]?.displayName ?? this.s.settings.luchadores[id]?.nombre ?? id;
  }

  /** Color del luchador (numero): el del motor o el de config/peleas.json. */
  private colorOf(id: FighterId): number {
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
      await this.d.report(`⚔️ Pelea ${this.name(pelea.a)} vs ${this.name(pelea.b)} cancelada por reinicio: devolví ${fmt(total)} Shaula-coins a ${devueltas.length} Papus.`);
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
    const pair = pickPair(this.fighters(), this.s.lastPair());
    await this.launch(ch.id, pair[0], pair[1]);
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
    if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral }));
    if (i.options.getBoolean("cancelar")) {
      const res = this.s.cancel();
      if (!res) return void (await i.reply({ content: "No hay ninguna pelea en curso.", flags: MessageFlags.Ephemeral }));
      this.stop();
      this.stopped = false;
      await this.banner?.edit({ content: `${this.banner.content}\n\n🚫 GyroP canceló esta pelea: le devolví a cada Papu lo que apostó.`, components: [] }).catch(() => {});
      this.banner = null;
      const total = res.devueltas.reduce((a, x) => a + x.cantidad, 0);
      return void (await i.reply({ content: `🚫 Pelea cancelada: devolví ${fmt(total)} Shaula-coins a ${res.devueltas.length} Papus.`, flags: MessageFlags.Ephemeral }));
    }
    if (this.s.active()) return void (await i.reply({ content: "Ya hay una pelea en curso: espera a que termine (o cancélala con `cancelar`).", flags: MessageFlags.Ephemeral }));
    const ids = this.fighters();
    const a1 = this.resolve(i.options.getString("vocaloid1"));
    const a2 = this.resolve(i.options.getString("vocaloid2"));
    for (const x of [a1, a2]) if (x && !ids.includes(x)) return void (await i.reply({ content: `${this.name(x)} no está en config/peleas.json (o le falta su avatar).`, flags: MessageFlags.Ephemeral }));
    if (a1 && a1 === a2) return void (await i.reply({ content: "Elige dos Vocaloids distintos.", flags: MessageFlags.Ephemeral }));
    let pair: [FighterId, FighterId];
    if (a1 && a2) pair = [a1, a2];
    else if (a1 || a2) {
      const fixed = (a1 ?? a2)!;
      const rest = ids.filter((x) => x !== fixed);
      pair = [fixed, rest[Math.floor(Math.random() * rest.length)]!];
    } else pair = pickPair(ids, this.s.lastPair());
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const ok = await this.launch(i.channelId, pair[0], pair[1]);
    await i.editReply({ content: ok ? `⚔️ ¡Pelea lanzada! ${this.name(pair[0])} vs ${this.name(pair[1])}.` : "No pude lanzarla (¿ya hay otra en curso?)." });
  }

  // ───────────────────────── banner y apuestas ─────────────────────────

  private card(bot: FighterId, cuota: number): FighterCard {
    const l = this.s.fighter(bot);
    return { name: this.name(bot), color: hex(this.colorOf(bot)), avatar: readFileSync(avatarFile(bot)), vida: l.vida, ataque: l.ataque, defensa: l.defensa, agilidad: l.agilidad, cuota };
  }

  private statMax(): StatMax {
    const all = Object.values(this.s.settings.luchadores);
    return {
      vida: Math.max(...all.map((l) => l!.vida)),
      ataque: Math.max(...all.map((l) => l!.ataque)),
      defensa: Math.max(...all.map((l) => l!.defensa)),
      agilidad: Math.max(...all.map((l) => l!.agilidad)),
    };
  }

  /** Texto del banner. `ping` (la mencion del rol de avisos) va al principio y se conserva en cada edicion. */
  private bannerText(p: Pelea, open: boolean, ping?: string): string {
    const a = this.s.settings.apuestas;
    const [ta, tb] = this.s.totals(p);
    const vs = `**${this.name(p.a)}** vs **${this.name(p.b)}**`;
    const pot = `📊 Apostado: **${this.name(p.a)}** ${fmt(ta.monto)} (${ta.papus} ${ta.papus === 1 ? "Papu" : "Papus"}) · **${this.name(p.b)}** ${fmt(tb.monto)} (${tb.papus} ${tb.papus === 1 ? "Papu" : "Papus"})`;
    // La frase y la mencion se eligen una vez por pelea: las ediciones del banner (montos, cierre) las conservan.
    if (this.head?.id !== p.id) this.head = { id: p.id, text: this.d.phrases.pick("teto", "pelea_anuncio", { texto: vs }), ping };
    const head = this.head.ping ? `🔔 ${this.head.ping}\n${this.head.text}` : this.head.text;
    if (!open) return [head, "🔒 **Apuestas cerradas**: ¡empieza la pelea!", pot].join("\n");
    return [
      head,
      `💰 Apuesta de **${a.minima} a ${a.maxima}** Shaula-coins **ganadas** (las compradas no se apuestan). Si aciertas, cobras tu apuesta × la cuota. Cierra <t:${Math.floor(p.cierraAt / 1000)}:R>.`,
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

  /** Abre la pelea en `channelId`: banner con botones y, a los `minutos`, la pelea. */
  async launch(channelId: string, a: FighterId, b: FighterId): Promise<boolean> {
    const p = this.s.open(a, b, channelId);
    if (!p) return false;
    try {
      const png = await bannerImage(this.card(a, p.cuotas[0]), this.card(b, p.cuotas[1]), this.statMax());
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
    if (action === "mia") {
      const mine = p ? this.s.betOf(p.id, i.user.id) : null;
      const ganadas = this.s.coinsOf(i.user.id);
      const text = !p
        ? "Esa pelea ya no existe."
        : mine
          ? `🪙 Apostaste **${fmt(mine.cantidad)}** a **${this.name(mine.lado)}** (paga ${fmtOdds(mine.lado === p.a ? p.cuotas[0] : p.cuotas[1])}: si gana, cobras **${fmt(Math.floor(mine.cantidad * (mine.lado === p.a ? p.cuotas[0] : p.cuotas[1])))}**). Tienes ${fmt(ganadas)} Shaula-coins ganadas.`
          : `Todavía no apuestas en esta pelea. Tienes ${fmt(ganadas)} Shaula-coins ganadas.`;
      await i.reply({ content: text, flags: MessageFlags.Ephemeral });
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
    if (ganadas < desde) return void (await i.reply({ content: `No te alcanza: tienes ${fmt(ganadas)} Shaula-coins ganadas y la apuesta mínima es de ${minima}. Se ganan participando en el servidor. 🪙`, flags: MessageFlags.Ephemeral })), true;
    const cuota = lado === p.a ? p.cuotas[0] : p.cuotas[1];
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}m:${p.id}:${lado}`)
      .setTitle(`Apostar por ${this.name(lado)} (paga ${fmtOdds(cuota)})`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("cantidad")
            .setLabel(prev ? `¿Cuántas sumas? (llevas ${prev.cantidad})` : "¿Cuántas Shaula-coins apuestas?")
            .setPlaceholder(`De ${desde} a ${Math.min(room, ganadas)} · tienes ${fmt(ganadas)} ganadas`)
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
    await i.reply({
      content: `✅ Apostaste **${fmt(cantidad)}** a **${this.name(lado)}**${res.total !== cantidad ? ` (en total, ${fmt(res.total)})` : ""}. Paga ${fmtOdds(res.cuota)}: si gana, cobras **${fmt(Math.floor(res.total * res.cuota))}** Shaula-coins. Te quedan ${fmt(res.ganadas)} ganadas. 🍀`,
      flags: MessageFlags.Ephemeral,
    });
    this.refreshTotals(id);
    return true;
  }

  // ───────────────────────── la pelea ─────────────────────────

  private embed(n: Nombres, vida: [number, number], lines: string[], turno: number, color: number): EmbedBuilder {
    // La descripcion admite 4096 caracteres: si no caben, se quitan las primeras lineas.
    let shown = lines.slice(-MAX_LOG_LINES - 2);
    while (shown.join("\n").length > 3900) shown = shown.slice(1);
    const max = this.s.settings.pelea.maxTurnos;
    return new EmbedBuilder()
      .setTitle(`⚔️ ${n.nombres[0]} vs ${n.nombres[1]}`)
      .setColor(color)
      .addFields(
        { name: `${n.nombres[0]} ❤️`, value: `\`${hpBar(vida[0], n.luchadores[0].vida)}\``, inline: true },
        { name: `${n.nombres[1]} ❤️`, value: `\`${hpBar(vida[1], n.luchadores[1].vida)}\``, inline: true },
      )
      .setDescription(shown.join("\n") || "🔔 ¡Suena la campana!")
      .setFooter({ text: turno ? `Turno ${turno} de ${max} como mucho` : `Hasta ${max} turnos; si nadie cae, gana quien conserve más vida` });
  }

  /** Cierra las apuestas, narra la pelea (una linea por segundo), paga y publica el final. */
  private async run(id: string): Promise<void> {
    this.closeTimer = null;
    if (this.stopped) return;
    const r = this.s.fight(id);
    const p = this.s.get(id);
    if (!r || !p || !p.canal) return;
    if (this.totalsTimer) clearTimeout(this.totalsTimer);
    this.totalsTimer = null;
    await this.banner?.edit({ content: this.bannerText(p, false), components: [this.buttons(p, false)] }).catch((e) => logError("banner de la pelea", e));
    const n: Nombres = { nombres: [this.name(p.a), this.name(p.b)], luchadores: [this.s.fighter(p.a), this.s.fighter(p.b)] };
    const ch = await this.d.sendable("teto", p.canal);
    const neutral = 0xffb020;
    const lines: string[] = [];
    const msg = await ch.send({ embeds: [this.embed(n, [n.luchadores[0].vida, n.luchadores[1].vida], lines, 0, neutral)], allowedMentions: { parse: [] } });
    const step = this.s.settings.pelea.lineaMs;
    for (const t of r.turnos) {
      await sleep(step);
      if (this.stopped) return;
      lines.push(turnLine(t, n));
      await msg.edit({ embeds: [this.embed(n, t.vida, lines, t.n, neutral)] }).catch((e) => logError("línea de la pelea", e));
    }
    await sleep(step);
    if (this.stopped) return;
    lines.push(finalLine(r, n));
    const winner = r.ganador === 0 ? p.a : p.b;
    const last = r.turnos[r.turnos.length - 1]!;
    await msg.edit({ embeds: [this.embed(n, last.vida, lines, last.n, this.colorOf(winner))] }).catch((e) => logError("final de la pelea", e));
    const liq = this.s.settle(id);
    this.banner = null;
    if (liq) await this.publish(liq);
  }

  private async publish(liq: Liquidacion): Promise<void> {
    const { pelea: p, resultado: r } = liq;
    const winner = r.ganador === 0 ? p.a : p.b;
    const loser = r.ganador === 0 ? p.b : p.a;
    const cuota = r.ganador === 0 ? p.cuotas[0] : p.cuotas[1];
    const gif = await resultGif({
      winner: { name: this.name(winner), color: hex(this.colorOf(winner)), avatar: readFileSync(avatarFile(winner)) },
      loser: { name: this.name(loser), color: hex(this.colorOf(loser)), avatar: readFileSync(avatarFile(loser)) },
      subtitle: r.porPuntos ? `por puntos tras ${r.turnos.length} turnos` : `por K.O. en ${r.turnos.length} ${r.turnos.length === 1 ? "turno" : "turnos"}`,
      seed: Date.now() % 1_000_000,
    });
    const out = [this.d.phrases.pick("teto", "pelea_ganador", { ganador: `**${this.name(winner)}**` })];
    if (!liq.ganadores.length && !liq.perdedores.length) out.push("Nadie apostó en esta pelea. ¡La próxima, Papus! 🪙");
    if (liq.ganadores.length) {
      out.push(`🪙 **Cobran** (${this.name(winner)} pagaba ${fmtOdds(cuota)}):`);
      const shown = liq.ganadores.slice(0, 20);
      for (const x of shown) out.push(`• <@${x.userId}> gana **${fmt(x.pago)}** Shaula-coins (apostó ${fmt(x.cantidad)})`);
      if (liq.ganadores.length > shown.length) out.push(`…y ${liq.ganadores.length - shown.length} Papus más.`);
    } else if (liq.perdedores.length) out.push(`Nadie le apostó a ${this.name(winner)}. 😱`);
    if (liq.perdedores.length) {
      const lost = liq.perdedores.reduce((a, x) => a + x.cantidad, 0);
      out.push(`💸 ${liq.perdedores.length} ${liq.perdedores.length === 1 ? "Papu perdió" : "Papus perdieron"} ${fmt(lost)} Shaula-coins apostando por ${this.name(loser)}.`);
    }
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
  }
}
