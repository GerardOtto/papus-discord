// Trivia multijugador (Actividad de Discord de Teto, PLAN §3.4): la sala corre en el worker de Cloudflare
// (worker/src/actividad/) y deja en su base D1 los aciertos de cada partida. Teto, cada pocos segundos:
// 1) calcula el perfil de los Papus que entraron a una sala (XP base por acierto y tope del dia que le queda), para
//    que la Actividad muestre la XP de cada acierto como la da /trivia;
// 2) toma los aciertos nuevos y les da todo lo de /trivia (TriviaService.answerShared: XP con la misma regla, partidas
//    con XP y tope del dia, preguntas superadas, sobres, hitos, secreto y mejor racha); avisa niveles y premios. Cada acierto se marca antes de dar la XP: nunca se da dos veces.
import path from "node:path";
import { d1Client, workerDatabaseId, type D1Query } from "../cloud/d1";
import type { LevelChange } from "../levels/service";
import type { Dificultad } from "./rules";
import type { Milestone, TriviaService } from "./service";

/** Premio que gano con un acierto (sobre por completar una dificultad, hito o el secreto): Teto lo anuncia como en /trivia. */
export interface PremioActividad {
  completed: Dificultad | null;
  secret: boolean;
  milestone: Milestone | null;
}

/** Aciertos por vuelta (los demas quedan para la siguiente). */
const LOTE = 200;

export interface ActividadDeps {
  query: D1Query;
  trivia: TriviaService;
  now?: () => number;
}

export class ActividadTrivia {
  private readonly now: () => number;
  /** Subio o bajo de nivel: apodo, rol y la frase de Teto (canal de la Actividad, si se sabe). Lo conecta Discord. */
  onChange: ((change: LevelChange, channelId: string | null) => Promise<void>) | null = null;
  /** Gano un premio de la trivia (sobre, hito o el secreto del Papu Lince). Lo conecta Discord. */
  onPremio: ((userId: string, premio: PremioActividad, channelId: string | null) => Promise<void>) | null = null;

  constructor(private readonly d: ActividadDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Una vuelta: aciertos pendientes y perfiles pedidos. Devuelve cuantos aciertos aplico. */
  async sync(): Promise<number> {
    const aplicados = await this.aplicar();
    await this.perfiles();
    return aplicados;
  }

  private async aplicar(): Promise<number> {
    // Se marcan primero (RETURNING): si Teto se cae a mitad, a lo sumo se pierde la XP de un lote, nunca se repite.
    const rows = await this.d.query<{ id: number; partida: string; papu_id: string; pregunta: string; racha: number; canal: string | null }>(
      `UPDATE actividad_aciertos SET aplicado = 1 WHERE id IN (SELECT id FROM actividad_aciertos WHERE aplicado = 0 ORDER BY id LIMIT ${LOTE}) RETURNING id, partida, papu_id, pregunta, racha, canal`,
    );
    const tocados = new Map<string, string>();
    for (const r of rows.sort((a, b) => a.id - b.id)) {
      const res = this.d.trivia.answerShared(r.papu_id, r.partida, r.pregunta, r.racha);
      tocados.set(r.papu_id, r.partida);
      await this.d.query("UPDATE actividad_aciertos SET xp = ? WHERE id = ?", res.xp, r.id);
      if (res.change && this.onChange) await this.onChange(res.change, r.canal).catch(() => {});
      if ((res.completed || res.secret || res.milestone) && this.onPremio) await this.onPremio(r.papu_id, res, r.canal).catch(() => {});
    }
    // Su tope del dia cambio: perfil nuevo para la sala.
    for (const [id, partida] of tocados) await this.guardarPerfil(id, partida);
    return rows.length;
  }

  private async perfiles(): Promise<void> {
    const rows = await this.d.query<{ papu_id: string }>("SELECT papu_id FROM actividad_perfiles WHERE pedido_at >= actualizado_at LIMIT 50");
    for (const r of rows) await this.guardarPerfil(r.papu_id);
  }

  private async guardarPerfil(papu: string, partida: string | null = null): Promise<void> {
    const p = this.d.trivia.sharedProfile(papu, partida);
    await this.d.query(
      "INSERT INTO actividad_perfiles (papu_id, xp_base, tope, pedido_at, actualizado_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(papu_id) DO UPDATE SET xp_base = excluded.xp_base, tope = excluded.tope, actualizado_at = excluded.actualizado_at",
      papu,
      p.base,
      p.tope,
      this.now() + 1,
    );
  }
}

/** null si falta el token de Cloudflare o el worker no esta desplegado: la Actividad no da XP (la sala igual funciona). */
export function actividadFromEnv(env: NodeJS.ProcessEnv, trivia: TriviaService, root = path.resolve(import.meta.dirname, "../..")): ActividadTrivia | null {
  const token = env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = workerDatabaseId(root);
  if (!token || !accountId || !databaseId) return null;
  return new ActividadTrivia({ query: d1Client({ accountId, token, databaseId }), trivia });
}
