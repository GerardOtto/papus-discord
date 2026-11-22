// Puente del celular de Neru (PLAN §3.15): la página y sus retos corren en el worker de Cloudflare
// (worker/src/celular/); los datos de los Papus viven aquí. Neru, cada pocos segundos:
// 1) toma los retos del día resueltos (celular_premios) y da su XP: N aciertos de trivia con la misma fórmula, aparte
//    del tope de la trivia (decisión de GyroP, 17 nov. 2026). Cada premio se marca ANTES de dar la XP: nunca dos veces;
// 2) deja el perfil que pidió la página (Shaulitas y la tarjeta de nivel como PNG);
// 3) cada 2 s, resuelve los pedidos de las apps con datos del bot (Mi tarjeta, Tienda…; src/discord/celular.ts).
import path from "node:path";
import { d1Client, workerDatabaseId, type D1Query } from "../cloud/d1";
import type { LevelChange } from "../levels/service";
import type { TriviaService } from "../trivia/service";

const LOTE = 100;
/** Tarjetas por vuelta: dibujarlas cuesta CPU en la VM chica. */
const PERFILES_POR_VUELTA = 4;

export interface PuenteDeps {
  query: D1Query;
  trivia: Pick<TriviaService, "dailyGameXp">;
  now?: () => number;
}

/** Un pedido de una app del celular (worker/src/celular/api.ts). */
export interface PedidoCelular {
  id: number;
  papu: string;
  nombre: string;
  app: string;
  accion: string;
  datos: unknown;
}

/** Lo que no se puede hacer y se le dice tal cual al Papu (sin registrarlo como error). */
export class NoSePuede extends Error {}

/** Shaulitas y tarjeta (PNG) del Papu; null si ya no está en el servidor. */
export type PerfilFn = (userId: string) => Promise<{ shaulitas: number; tarjeta: Buffer } | null>;

export class PuenteCelular {
  private readonly now: () => number;
  /** Subió de nivel con la XP de un reto: apodo, rol y la frase. Lo conecta Discord. */
  onChange: ((change: LevelChange) => Promise<void>) | null = null;
  /** Lo conecta Discord (necesita la tarjeta y el monedero). Sin él, el perfil queda vacío. */
  perfil: PerfilFn | null = null;
  /** Resuelve un pedido de una app (lo conecta Discord). Lanza NoSePuede con el mensaje para el Papu. */
  manejar: ((p: PedidoCelular) => Promise<unknown>) | null = null;

  constructor(private readonly d: PuenteDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Pedidos de las apps (vuelta rápida, cada 2 s). */
  pedidos(log?: (msg: string) => void): Promise<number> {
    return resolverPedidos({ query: this.d.query, now: this.now, log }, this.manejar);
  }

  /** Una vuelta. Devuelve cuántos premios aplicó y cuántos perfiles dejó. */
  async sync(): Promise<{ premios: number; perfiles: number }> {
    return { premios: await this.premios(), perfiles: await this.perfiles() };
  }

  private async premios(): Promise<number> {
    const rows = await this.d.query<{ id: number; papu_id: string; aciertos: number }>(
      `UPDATE celular_premios SET aplicado = 1 WHERE id IN (SELECT id FROM celular_premios WHERE aplicado = 0 ORDER BY id LIMIT ${LOTE}) RETURNING id, papu_id, aciertos`,
    );
    for (const r of rows.sort((a, b) => a.id - b.id)) {
      if (/^prueba-/.test(r.papu_id)) continue;
      const { xp, change } = this.d.trivia.dailyGameXp(r.papu_id, r.aciertos);
      await this.d.query("UPDATE celular_premios SET xp = ? WHERE id = ?", xp, r.id);
      if (change && this.onChange) await this.onChange(change).catch(() => {});
    }
    return rows.length;
  }

  private async perfiles(): Promise<number> {
    const rows = await this.d.query<{ papu_id: string }>(
      `SELECT papu_id FROM celular_perfiles WHERE pedido_at > actualizado_at ORDER BY pedido_at LIMIT ${PERFILES_POR_VUELTA}`,
    );
    let n = 0;
    for (const r of rows) {
      const p = /^prueba-/.test(r.papu_id) ? null : await (this.perfil?.(r.papu_id) ?? Promise.resolve(null)).catch(() => null);
      await this.d.query(
        "UPDATE celular_perfiles SET shaulitas = ?, tarjeta = ?, actualizado_at = ? WHERE papu_id = ?",
        p?.shaulitas ?? null,
        p ? `data:image/png;base64,${p.tarjeta.toString("base64")}` : null,
        this.now(),
        r.papu_id,
      );
      n++;
    }
    // Sesiones vencidas y retos de hace más de 40 días: la base queda chica.
    if (n || Math.random() < 0.01) {
      await this.d.query("DELETE FROM celular_sesiones WHERE vence_at < ?", this.now());
      await this.d.query("DELETE FROM celular_retos WHERE actualizado_at < ?", this.now() - 40 * 86_400_000);
    }
    return n;
  }
}

/** Pedidos por vuelta. */
const PEDIDOS_LOTE = 10;

export async function resolverPedidos(
  d: { query: D1Query; now: () => number; log?: (msg: string) => void },
  manejar: ((p: PedidoCelular) => Promise<unknown>) | null,
): Promise<number> {
  if (!manejar) return 0;
  const rows = await d.query<{ id: number; papu_id: string; nombre: string; app: string; accion: string; datos: string }>(
    `UPDATE celular_pedidos SET estado = 'tomado' WHERE id IN (SELECT id FROM celular_pedidos WHERE estado = 'pendiente' ORDER BY id LIMIT ${PEDIDOS_LOTE}) RETURNING id, papu_id, nombre, app, accion, datos`,
  );
  for (const r of rows.sort((a, b) => a.id - b.id)) {
    let estado = "listo";
    let resultado: unknown;
    try {
      resultado = await manejar({ id: r.id, papu: r.papu_id, nombre: r.nombre, app: r.app, accion: r.accion, datos: JSON.parse(r.datos) as unknown });
    } catch (e) {
      estado = "error";
      const nos = e instanceof NoSePuede;
      if (!nos) d.log?.(`celular ${r.app}/${r.accion}: ${(e as Error).message}`);
      resultado = { mensaje: nos ? (e as Error).message : "Algo falló de mi lado. Prueba otra vez en un rato." };
    }
    await d.query("UPDATE celular_pedidos SET estado = ?, resultado = ?, hecho_at = ? WHERE id = ?", estado, JSON.stringify(resultado ?? null), d.now(), r.id);
  }
  if (rows.length || Math.random() < 0.002) await d.query("DELETE FROM celular_pedidos WHERE creado_at < ?", d.now() - 3_600_000);
  return rows.length;
}

/** null si falta el token de Cloudflare o el worker no está desplegado: el celular no da XP (los retos igual andan). */
export function puenteFromEnv(
  env: NodeJS.ProcessEnv,
  deps: Omit<PuenteDeps, "query">,
  root = path.resolve(import.meta.dirname, "../.."),
): PuenteCelular | null {
  const token = env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = workerDatabaseId(root);
  if (!token || !accountId || !databaseId) return null;
  return new PuenteCelular({ ...deps, query: d1Client({ accountId, token, databaseId }) });
}
