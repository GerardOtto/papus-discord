// Reinicios del día con el PC de Adachi Rei (mercado negro, PLAN §3.9). No se borra nada de lo ganado: se guarda lo
// que el Papu llevaba al usarlo (tabla reinicios, migración 16) y la ruleta, la trivia y las monedas cuentan desde ahí.
import type { Db } from "../db/database";

export interface Reinicio {
  /** Veces que usó el PC ese día. */
  veces: number;
  /** Tiradas de la ruleta que ya había usado. */
  ruleta: number;
  /** Partidas de trivia que ya había jugado y XP de la trivia que ya había ganado. */
  triviaPartidas: number;
  triviaXp: number;
  /** XP del día al reiniciar y monedas por actividad ya ganadas antes (con su propio tope cada tramo). */
  monedasXp: number;
  monedasPrevia: number;
}

export const SIN_REINICIO: Reinicio = { veces: 0, ruleta: 0, triviaPartidas: 0, triviaXp: 0, monedasXp: 0, monedasPrevia: 0 };

/** Lo que llevaba el Papu ese día al usar el PC por última vez (todo en 0 si no lo usó). */
export function reinicioDe(db: Db, userId: string, day: string): Reinicio {
  const r = db.prepare("SELECT * FROM reinicios WHERE user_id = ? AND day = ?").get(userId, day) as
    | { veces: number; ruleta: number; trivia_partidas: number; trivia_xp: number; monedas_xp: number; monedas_previa: number }
    | undefined;
  if (!r) return SIN_REINICIO;
  return { veces: r.veces, ruleta: r.ruleta, triviaPartidas: r.trivia_partidas, triviaXp: r.trivia_xp, monedasXp: r.monedas_xp, monedasPrevia: r.monedas_previa };
}

export function guardarReinicio(db: Db, userId: string, day: string, r: Reinicio): void {
  db.prepare(
    `INSERT INTO reinicios (user_id, day, veces, ruleta, trivia_partidas, trivia_xp, monedas_xp, monedas_previa) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET veces = excluded.veces, ruleta = excluded.ruleta, trivia_partidas = excluded.trivia_partidas,
       trivia_xp = excluded.trivia_xp, monedas_xp = excluded.monedas_xp, monedas_previa = excluded.monedas_previa`,
  ).run(userId, day, r.veces, r.ruleta, r.triviaPartidas, r.triviaXp, r.monedasXp, r.monedasPrevia);
}
