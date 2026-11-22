// Cumpleaños en Discord (config/cumpleanos.json; GyroP, 18 nov. 2026): cada minuto, la insignia del pastel a quien
// cumple hoy y, una vez al día desde las 12:00, el aviso de Ruko en #general con los de hoy (con @) y los de los
// próximos 7 días (sin @). /cumple de Teto: ver el de un Papu; GyroP y los Mods lo cambian o lo borran.
import { MessageFlags, type ChatInputCommandInteraction, type Guild, type SendableChannels } from "discord.js";
import type { BotId } from "../config";
import type { CoinService } from "../coins/service";
import { lineaProximo, type CumpleService } from "../cumpleanos/service";
import { logError, type LogFn } from "../log";
import type { Phrases } from "../phrases/catalog";
import { fechaTexto, leerFecha } from "../setup/cumple";
import { findTextChannel } from "./channels";

/** Días que muestra /cumple proximos. */
const PROXIMOS_DIAS = 30;

export interface CumpleDiscordDeps {
  cumple: CumpleService;
  coins?: CoinService | null;
  phrases: Phrases;
  guild: () => Guild;
  /** Bots conectados (Ruko es opcional: si no está, escribe el respaldo). */
  online: () => readonly BotId[];
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  displayName: (bot: BotId) => string;
  owners: ReadonlySet<string>;
  isStaff: (userId: string) => Promise<boolean>;
  report: (text: string) => Promise<void>;
  log: LogFn;
}

export class CumpleDiscord {
  constructor(private readonly d: CumpleDiscordDeps) {}

  private get c(): CumpleService {
    return this.d.cumple;
  }

  /** Cada minuto. */
  async tick(now = Date.now()): Promise<void> {
    if (!this.c.settings.activo) return;
    await this.c.refrescar().catch((e) => logError("cumpleaños (D1)", e));
    for (const id of this.c.insigniasPendientes(now)) {
      this.c.marcarInsignia(id, now);
      const o = this.d.coins?.giftBadge(id, this.c.settings.insignia, "cumpleaños");
      if (o) this.d.log(`🎂 Insignia del pastel para ${id}`);
    }
    if (this.c.tocaAviso(now)) await this.aviso(now);
  }

  /** El aviso del día (si no hay cumpleaños hoy ni en los próximos días, no escribe nada). */
  async aviso(now = Date.now()): Promise<boolean> {
    const g = this.d.guild();
    const a = this.c.aviso((id) => g.members.cache.has(id), now);
    if (!a) return false;
    const canal = findTextChannel(g, this.c.settings.canal);
    if (!canal) return void (await this.d.report(`🎂 No encontré #${this.c.settings.canal} para el aviso de cumpleaños.`)), false;
    const s = this.c.settings;
    const bot = this.d.online().includes(s.bot) ? s.bot : s.respaldo;
    const ruko = bot === "ruko";
    const out: string[] = [];
    if (a.hoyPapus.length) {
      const papus = a.hoyPapus.map((id) => `<@${id}>`).join(", ");
      out.push(`🎂 ${ruko ? this.d.phrases.pick("ruko", "cumple_hoy", { papus }) : this.d.phrases.pick("teto", "cumpleanos", { papu: papus })}`);
      out.push(`-# XP ×${s.multiplicador} todo el día y la insignia del pastel en su tarjeta.`);
    }
    for (const b of a.hoyVocaloids) {
      const vocaloid = `**${this.d.displayName(b)}**`;
      out.push(`🎶 ${ruko ? this.d.phrases.pick("ruko", "cumple_vocaloid", { vocaloid }) : `¡Hoy es el cumpleaños de ${vocaloid}! 🎂`}`);
    }
    if (a.pronto.length) {
      out.push("", `📅 ${ruko ? this.d.phrases.pick("ruko", "cumple_proximos") : "Próximos cumpleaños:"}`);
      for (const x of a.pronto.slice(0, 20)) out.push(lineaProximo(x, x.quien.tipo === "papu" ? `<@${x.quien.id}>` : `**${this.d.displayName(x.quien.id)}**`));
    }
    const roles = findTextChannel(g, "tus-roles");
    if (roles) out.push(`-# ¿Quieres que te saluden? Registra tu cumpleaños en <#${roles.id}> 🎂`);
    let content = out.join("\n");
    if (content.length > 1990) content = `${content.slice(0, 1985)}…`;
    const ch = await this.d.sendable(bot, canal.id);
    // Solo se etiqueta a los que cumplen hoy (los de los próximos días salen sin notificar).
    await ch.send({ content, allowedMentions: { users: a.hoyPapus } });
    this.d.log(`🎂 Aviso de cumpleaños: ${a.hoyPapus.length} Papus y ${a.hoyVocaloids.length} Vocaloids hoy, ${a.pronto.length} pronto`);
    return true;
  }

  /** /cumple ver|poner|borrar. */
  async command(i: ChatInputCommandInteraction): Promise<void> {
    const sub = i.options.getSubcommand();
    const papu = i.options.getUser("papu") ?? i.user;
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    await this.c.refrescar(true).catch((e) => logError("cumpleaños (D1)", e));
    if (sub === "proximos") {
      // Lista privada de los próximos 30 días, firmada por Ruko (sin etiquetar a nadie).
      const g = this.d.guild();
      const a = this.c.aviso((id) => g.members.cache.has(id), Date.now(), PROXIMOS_DIAS);
      const nombre = (x: { quien: { tipo: "papu"; id: string } | { tipo: "vocaloid"; id: BotId } }) => (x.quien.tipo === "papu" ? `<@${x.quien.id}>` : `**${this.d.displayName(x.quien.id)}**`);
      const hoy = a ? [...a.hoyPapus.map((id) => `<@${id}>`), ...a.hoyVocaloids.map((b) => `**${this.d.displayName(b)}**`)] : [];
      const lineas = [
        `🌓 **Ruko:** ${this.d.phrases.pick("ruko", "cumple_proximos")}`,
        ...(hoy.length ? [`🎂 **Hoy:** ${hoy.join(", ")}`] : []),
        ...(a?.pronto ?? []).slice(0, 30).map((x) => lineaProximo(x, nombre(x))),
      ];
      if (!a) lineas.push(`No hay cumpleaños en los próximos ${PROXIMOS_DIAS} días. Hmm.`);
      lineas.push("-# ¿Falta el tuyo? Regístralo en #tus-roles 🎂");
      let content = lineas.join("\n");
      if (content.length > 1990) content = `${content.slice(0, 1985)}…`;
      return void (await reply(content));
    }
    if (sub === "ver") {
      const f = this.c.fechaDe(papu.id);
      const quien = papu.id === i.user.id ? "Tu cumpleaños" : `El cumpleaños de <@${papu.id}>`;
      return void (await reply(f ? `🎂 ${quien}: **${fechaTexto(f)}**.` : papu.id === i.user.id ? "🎂 Aún no registras tu cumpleaños: hazlo en #tus-roles." : `🎂 <@${papu.id}> no ha registrado su cumpleaños.`));
    }
    if (!this.d.owners.has(i.user.id) && !(await this.d.isStaff(i.user.id))) return void (await reply("Cambiar cumpleaños es solo de GyroP y los Mods. 🎂"));
    if (sub === "borrar") {
      const tenia = await this.c.borrar(papu.id);
      await this.d.report(`🎂 <@${i.user.id}> borró el cumpleaños de <@${papu.id}>.`);
      return void (await reply(tenia ? `🎂 Borré el cumpleaños de <@${papu.id}>: puede registrarlo de nuevo en #tus-roles.` : `🎂 <@${papu.id}> no tenía cumpleaños registrado.`));
    }
    const r = leerFecha(String(i.options.getInteger("dia", true)), i.options.getString("mes", true));
    if (!r.ok) return void (await reply(`❌ ${r.motivo}`));
    await this.c.poner(papu.id, r.fecha, i.user.id);
    await this.d.report(`🎂 <@${i.user.id}> puso el cumpleaños de <@${papu.id}>: ${fechaTexto(r.fecha)}.`);
    await reply(`🎂 Listo: el cumpleaños de <@${papu.id}> quedó el **${fechaTexto(r.fecha)}**.`);
  }
}
