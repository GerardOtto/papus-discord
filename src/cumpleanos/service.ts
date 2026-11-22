// Cumpleaños de los Papus y de los Vocaloids (config/cumpleanos.json; GyroP, 18 nov. 2026). Los Papus los registran en
// #tus-roles (worker, tabla D1 cumpleanos); aquí, en la VM: el aviso diario de Ruko, la XP ×2 del día y la insignia del
// pastel. Sin Discord: src/discord/app.ts publica el texto. Lo de los Papus se lee de D1 cada 10 min (en memoria).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";
import type { D1Query } from "../cloud/d1";
import { kvGet, kvSet, type Db } from "../db/database";
import { cuando, deClave, esCumple, fechaTexto, proximos, type Fecha } from "../setup/cumple";
import { dayKey } from "../time";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const REFRESCO_MS = 10 * 60_000;
const AVISO_KEY = "cumple:aviso";
const INSIGNIA_KEY = "cumple:insignia";

export interface CumpleSettings {
  activo: boolean;
  hora: number;
  dias: number;
  canal: string;
  bot: BotId;
  respaldo: BotId;
  multiplicador: number;
  insignia: string;
  /** MM-DD de cada Vocaloid (null = sin fecha confirmada). */
  vocaloids: Partial<Record<BotId, string | null>>;
}

export function loadCumpleSettings(file = path.join(REPO_ROOT, "config/cumpleanos.json")): CumpleSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as CumpleSettings;
  if (!(s.hora >= 0 && s.hora <= 23) || !(s.dias >= 0 && s.dias <= 31)) throw new Error("config/cumpleanos.json: hora va de 0 a 23 y dias de 0 a 31");
  if (!(s.multiplicador >= 1)) throw new Error("config/cumpleanos.json: multiplicador >= 1");
  for (const b of [s.bot, s.respaldo]) if (!BOT_IDS.includes(b)) throw new Error(`config/cumpleanos.json: ${b} no es un Vocaloid del servidor`);
  for (const [b, f] of Object.entries(s.vocaloids)) {
    if (!BOT_IDS.includes(b as BotId)) throw new Error(`config/cumpleanos.json: ${b} no es un Vocaloid del servidor`);
    if (f !== null && !deClave(f!)) throw new Error(`config/cumpleanos.json: la fecha de ${b} va como MM-DD`);
  }
  return s;
}

/** Quién cumple: un Papu (id de Discord) o un Vocaloid. */
export type Quien = { tipo: "papu"; id: string } | { tipo: "vocaloid"; id: BotId };

/** Lo que Ruko publica hoy (sin texto de frases: lo arma Discord con las frases fijas). */
export interface AvisoCumple {
  hoyPapus: string[];
  hoyVocaloids: BotId[];
  /** Los de los próximos días (sin hoy), del más cercano al más lejano. */
  pronto: { quien: Quien; fecha: Fecha; en: number }[];
}

export interface CumpleDeps {
  db: Db;
  /** Base D1 del worker (null sin token de Cloudflare: solo los Vocaloids). */
  query: D1Query | null;
  settings: CumpleSettings;
  timeZone: string;
  now?: () => number;
}

export class CumpleService {
  private readonly now: () => number;
  private papus = new Map<string, Fecha>();
  private cargadoAt = 0;

  constructor(private readonly d: CumpleDeps) {
    this.now = d.now ?? Date.now;
  }

  get settings(): CumpleSettings {
    return this.d.settings;
  }

  /** Vuelve a leer los cumpleaños de los Papus de D1 (como mucho cada 10 min, salvo `forzar`). */
  async refrescar(forzar = false): Promise<void> {
    if (!this.d.query || (!forzar && this.now() - this.cargadoAt < REFRESCO_MS)) return;
    const rows = await this.d.query<{ papu_id: string; dia: number; mes: number }>("SELECT papu_id, dia, mes FROM cumpleanos");
    this.papus = new Map(rows.map((r) => [r.papu_id, { dia: r.dia, mes: r.mes }]));
    this.cargadoAt = this.now();
  }

  /** Para las pruebas y /cumple: deja la lista en memoria tal cual. */
  cargar(lista: Map<string, Fecha>): void {
    this.papus = new Map(lista);
    this.cargadoAt = this.now();
  }

  fechaDe(userId: string): Fecha | null {
    return this.papus.get(userId) ?? null;
  }

  private day(at = this.now()): string {
    return dayKey(new Date(at), this.d.timeZone);
  }

  /** ¿Es su cumpleaños hoy (zona de la cuota)? */
  esHoy(userId: string, at = this.now()): boolean {
    const f = this.papus.get(userId);
    return !!f && this.d.settings.activo && esCumple(f, this.day(at));
  }

  /** Multiplicador de XP de su cumpleaños (1 si no es hoy). Se suma al de su membresía (se multiplican). */
  boost(userId: string, at = this.now()): number {
    return this.esHoy(userId, at) ? this.d.settings.multiplicador : 1;
  }

  /** Papus que cumplen hoy. */
  hoy(at = this.now()): string[] {
    const day = this.day(at);
    return [...this.papus].filter(([, f]) => esCumple(f, day)).map(([id]) => id);
  }

  /** Cumpleaños de hoy y de los próximos días (Papus que siguen en el servidor según `sigue`, y Vocaloids). */
  aviso(sigue: (userId: string) => boolean, at = this.now(), dias = this.d.settings.dias): AvisoCumple | null {
    const s = { ...this.d.settings, dias };
    const lista: { quien: Quien; fecha: Fecha }[] = [
      ...[...this.papus].filter(([id]) => sigue(id)).map(([id, fecha]) => ({ quien: { tipo: "papu", id } as Quien, fecha })),
      ...Object.entries(s.vocaloids).flatMap(([id, f]) => {
        const fecha = f ? deClave(f) : null;
        return fecha ? [{ quien: { tipo: "vocaloid", id: id as BotId } as Quien, fecha }] : [];
      }),
    ];
    const todos = proximos(lista, this.day(at), s.dias);
    const hoy = todos.filter((x) => x.en === 0);
    const a: AvisoCumple = {
      hoyPapus: hoy.flatMap((x) => (x.quien.tipo === "papu" ? [x.quien.id] : [])),
      hoyVocaloids: hoy.flatMap((x) => (x.quien.tipo === "vocaloid" ? [x.quien.id] : [])),
      pronto: todos.filter((x) => x.en > 0),
    };
    return a.hoyPapus.length || a.hoyVocaloids.length || a.pronto.length ? a : null;
  }

  /**
   * ¿Toca el aviso de hoy? (una vez al día, desde `hora`). Lo marca como hecho al devolver true, así un reinicio no lo
   * repite.
   */
  tocaAviso(at = this.now()): boolean {
    const s = this.d.settings;
    if (!s.activo) return false;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: this.d.timeZone }).format(new Date(at)));
    const day = this.day(at);
    if (hour < s.hora || kvGet(this.d.db, AVISO_KEY) === day) return false;
    kvSet(this.d.db, AVISO_KEY, day);
    return true;
  }

  /** Papus de cumpleaños hoy a los que aún no se les revisó la insignia (una vez al día por Papu). */
  insigniasPendientes(at = this.now()): string[] {
    const day = this.day(at);
    const hechos = new Set((kvGet(this.d.db, INSIGNIA_KEY) ?? "").split(",").filter((x) => x.startsWith(`${day}:`)).map((x) => x.slice(day.length + 1)));
    return this.hoy(at).filter((id) => !hechos.has(id));
  }

  marcarInsignia(userId: string, at = this.now()): void {
    const day = this.day(at);
    const prev = (kvGet(this.d.db, INSIGNIA_KEY) ?? "").split(",").filter((x) => x.startsWith(`${day}:`));
    kvSet(this.d.db, INSIGNIA_KEY, [...prev, `${day}:${userId}`].join(","));
  }

  // ───────────────────────── /cumple (GyroP y Mods) ─────────────────────────

  /** Pone (o cambia) el cumpleaños de un Papu en D1. */
  async poner(userId: string, f: Fecha, por: string): Promise<void> {
    if (!this.d.query) throw new Error("sin conexión a la base del worker (CLOUDFLARE_DEPLOY_TOKEN)");
    await this.d.query(
      "INSERT INTO cumpleanos (papu_id, dia, mes, creado_at, por) VALUES (?, ?, ?, ?, ?) ON CONFLICT(papu_id) DO UPDATE SET dia = excluded.dia, mes = excluded.mes, por = excluded.por",
      userId,
      f.dia,
      f.mes,
      this.now(),
      por,
    );
    this.papus.set(userId, f);
  }

  /** Borra el cumpleaños de un Papu (podrá registrarlo de nuevo en #tus-roles). Devuelve si tenía. */
  async borrar(userId: string): Promise<boolean> {
    if (!this.d.query) throw new Error("sin conexión a la base del worker (CLOUDFLARE_DEPLOY_TOKEN)");
    await this.d.query("DELETE FROM cumpleanos WHERE papu_id = ?", userId);
    return this.papus.delete(userId);
  }
}

/** Línea de la lista de próximos: «• 20 de noviembre — **Miku** (en 2 días)». */
export function lineaProximo(x: { fecha: Fecha; en: number }, nombre: string): string {
  return `• ${fechaTexto(x.fecha)} — ${nombre} (${cuando(x.en)})`;
}
