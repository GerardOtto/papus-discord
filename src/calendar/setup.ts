// Arma el CalendarService con lo que hay en el PC: carpeta "1. Videos finales" (títulos del calendario del motor, que
// conservan los "¿?" y ":" que Windows quita de los nombres de carpeta), base D1 del worker y config del calendario.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseFolderName } from "../catalog/videos";
import { d1Client, workerDatabaseId } from "../cloud/d1";
import type { Db } from "../db/database";
import { parseHonorSettings, parseRoundSettings } from "../votes/rounds";
import { CalendarService, type CalendarSettings, type FinalVideo } from "./service";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Videos de la carpeta de finales: número y título (el del motor si el número coincide). */
export function finalVideos(deliveryDir: string, finalesPath: string, engineCalendar: string | null): FinalVideo[] {
  const dir = path.join(deliveryDir, finalesPath);
  if (!existsSync(dir)) return [];
  const engineTitles = new Map<number, string>();
  if (engineCalendar && existsSync(engineCalendar)) {
    try {
      const cal = JSON.parse(readFileSync(engineCalendar, "utf8")) as { reels?: { finalNumber?: number; title?: string }[] };
      for (const r of cal.reels ?? []) if (r.finalNumber && r.title) engineTitles.set(r.finalNumber, r.title);
    } catch {
      // Calendario del motor ilegible: se usan los nombres de carpeta.
    }
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => parseFolderName(e.name))
    .filter((v): v is { title: string; order: number } => !!v && v.order > 0)
    .map((v) => ({ order: v.order, title: engineTitles.get(v.order) ?? v.title }));
}

/** null si falta algo (token de Cloudflare, worker sin desplegar o carpeta de entrega): el calendario queda apagado. */
export function buildCalendar(opts: { db: Db; env: NodeJS.ProcessEnv; deliveryDir: string | null; engineDir: string }): { service: CalendarService; channel: string } | null {
  const token = opts.env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
  const accountId = opts.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = workerDatabaseId(ROOT);
  if (!token || !accountId || !databaseId || !opts.deliveryDir) return null;
  const read = (f: string) => JSON.parse(readFileSync(path.join(ROOT, f), "utf8"));
  const settings = read("config/calendario.json") as CalendarSettings;
  const votes = read("config/votaciones.json");
  const paths = read("config/engine-paths.json") as { engine: { calendario?: { path: string } }; delivery: { finales: { path: string } } };
  const engineCalendar = paths.engine.calendario ? path.join(opts.engineDir, paths.engine.calendario.path) : null;
  const deliveryDir = opts.deliveryDir;
  const service = new CalendarService({
    db: opts.db,
    query: d1Client({ accountId, token, databaseId }),
    finales: () => finalVideos(deliveryDir, paths.delivery.finales.path, engineCalendar),
    rounds: parseRoundSettings(votes),
    honor: parseHonorSettings(votes.honor),
    settings,
  });
  return { service, channel: settings.canal };
}
