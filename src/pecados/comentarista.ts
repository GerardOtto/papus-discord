// El anfitrión del pecado comenta cuando un Papu gana Shaulitas en su semana (GyroP, 19 nov. 2026): por ahora Gallerian
// (Kaito) en la Avaricia. Frases fijas, sin LLM ni cuota. Los que ganan en el mismo evento salen en un solo mensaje.
// Topes por Papu (config/pecados.json > comentarista): una vez cada `esperaMin` y hasta `maxDiaPorPapu` al día.
import type { SendableChannels } from "discord.js";
import type { BotId } from "../config";
import { kvGet, kvSet, type Db } from "../db/database";
import type { Phrases } from "../phrases/catalog";
import { dayKey } from "../time";
import { semanaDe, tablaPecado, type PecadosSettings, type SemanaPecado } from "./rules";

export interface ComentaristaDeps {
  db: Db;
  settings: PecadosSettings;
  phrases: Phrases;
  timeZone: string;
  now?: () => number;
  /** Id del canal con ese nombre (sin acentos ni emojis), o null. */
  canal: (nombre: string) => string | null;
  /** Canal donde se jugó una ruleta de Némesis (id de la ruleta). */
  canalNemesis: (id: string) => string | null;
  /** Ids de los bots: nunca se comenta a un bot. */
  esBot: (userId: string) => boolean;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  /** Para las pruebas: en vez de setTimeout. */
  programar?: (fn: () => void, ms: number) => void;
  log: (text: string) => void;
}

interface Pendiente {
  semana: SemanaPecado;
  canalId: string;
  ganadores: Map<string, number>;
}

interface Tope {
  n: number;
  last: number;
}

/** Canal (nombre o "nemesis") según el motivo del movimiento; null si esa ganancia no se comenta. */
export function fuenteDe(settings: PecadosSettings, motivo: string): string | null {
  return settings.comentarista.fuentes.find((f) => new RegExp(f.motivo).test(motivo))?.canal ?? null;
}

const ordinal = (n: number) => `${n}.º`;

export class Comentarista {
  private readonly pendientes = new Map<string, Pendiente>();
  private readonly now: () => number;

  constructor(private readonly d: ComentaristaDeps) {
    this.now = d.now ?? Date.now;
  }

  private get c() {
    return this.d.settings.comentarista;
  }

  /** Lo llama el monedero cada vez que entran Shaulitas. Nunca lanza. */
  onGain(userId: string, cantidad: number, motivo: string): void {
    try {
      if (cantidad < this.c.minimo || this.d.esBot(userId)) return;
      const s = semanaDe(this.d.settings, dayKey(new Date(this.now()), this.d.timeZone));
      if (!s || !this.d.phrases.has("pecados", `${s.id}_ganancia`)) return;
      const fuente = fuenteDe(this.d.settings, motivo);
      if (!fuente) return;
      const id = fuente === "nemesis" ? motivo.match(/^ruleta de Némesis (\S+)/)?.[1] : null;
      const canalId = (id ? this.d.canalNemesis(id) : null) ?? this.d.canal(fuente === "nemesis" ? "casino" : fuente);
      if (!canalId) return;
      const p = this.pendientes.get(motivo);
      if (p) {
        p.ganadores.set(userId, (p.ganadores.get(userId) ?? 0) + cantidad);
        return;
      }
      this.pendientes.set(motivo, { semana: s, canalId, ganadores: new Map([[userId, cantidad]]) });
      const programar = this.d.programar ?? ((fn, ms) => void setTimeout(fn, ms));
      programar(() => void this.enviar(motivo).catch((e) => this.d.log(`⚠️ Comentario de la ${s.nombre}: ${String(e)}`)), this.c.retrasoSeg * 1000);
    } catch (e) {
      this.d.log(`⚠️ Comentario de los pecados: ${String(e)}`);
    }
  }

  private topeKey(userId: string, day: string): string {
    return `pecados:comentario:${day}:${userId}`;
  }

  /** Revisa y gasta el tope del Papu (una vez cada esperaMin, hasta maxDiaPorPapu al día). */
  private usarTope(userId: string): boolean {
    const t = this.now();
    const key = this.topeKey(userId, dayKey(new Date(t), this.d.timeZone));
    const raw = kvGet(this.d.db, key);
    const tope: Tope = raw ? (JSON.parse(raw) as Tope) : { n: 0, last: 0 };
    if (tope.n >= this.c.maxDiaPorPapu || t - tope.last < this.c.esperaMin * 60_000) return false;
    kvSet(this.d.db, key, JSON.stringify({ n: tope.n + 1, last: t }));
    return true;
  }

  async enviar(motivo: string): Promise<void> {
    const p = this.pendientes.get(motivo);
    this.pendientes.delete(motivo);
    if (!p) return;
    const ganadores = [...p.ganadores].sort((a, b) => b[1] - a[1]).filter(([userId]) => this.usarTope(userId));
    if (!ganadores.length) return;
    const tabla = tablaPecado(this.d.db, this.d.settings, p.semana, this.d.timeZone) ?? [];
    const puesto = (userId: string) => tabla.findIndex((x) => x.userId === userId) + 1;
    const s = p.semana;
    let texto: string;
    if (ganadores.length === 1) {
      const [userId, monto] = ganadores[0]!;
      texto = this.d.phrases.pick("pecados", `${s.id}_ganancia`, { papu: `<@${userId}>`, monedas: monto.toLocaleString("es-CL") });
    } else {
      const nombres = ganadores.map(([u]) => `<@${u}>`);
      texto = this.d.phrases.pick("pecados", `${s.id}_ganancia_varios`, { papus: `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` });
    }
    const puestos = ganadores.filter(([u]) => puesto(u) > 0).map(([u]) => (ganadores.length === 1 ? `va ${ordinal(puesto(u))}` : `<@${u}> ${ordinal(puesto(u))}`));
    if (puestos.length) texto += `\n-# ${s.emoji} ${s.nombre}: ${puestos.join(" · ")}`;
    const ch = await this.d.sendable(s.anfitrion, p.canalId);
    await ch.send({ content: texto, allowedMentions: { parse: [] } });
    this.d.log(`${s.emoji} ${s.anfitrion} comentó una ganancia (${motivo})`);
  }
}
