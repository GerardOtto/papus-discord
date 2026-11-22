// Ruleta de Némesis (PLAN §3.12): desafíos entre dos Papus, la apuesta de cada uno (solo Shaulitas), el
// revólver (una bala en una recámara al azar) y el pago al que sobrevive, menos la tajada de Némesis. Una partida a la
// vez en todo el servidor. Si el bot se reinicia a la mitad, se devuelve todo (recover). Sin Discord:
// src/discord/nemesis.ts es el canal.
import { randomBytes } from "node:crypto";
import type { CoinService } from "../coins/service";
import { transaction, type Db } from "../db/database";
import { apuestaCasa, checkApuesta, reparto, shooterAt, type NemesisSettings } from "./rules";

export type EstadoDuelo = "pendiente" | "jugando" | "terminada" | "rechazada" | "vencida" | "devuelta";

export interface Duelo {
  id: string;
  retador: string;
  rival: string;
  apuesta: number;
  estado: EstadoDuelo;
  /** Recámara con la bala (0 = la primera que se dispara); null mientras no acepta. */
  bala: number | null;
  /** Quién jala primero: 0 = el retador, 1 = el rival. */
  primero: 0 | 1 | null;
  /** Turno en curso (0, 1, 2…) = recámaras ya disparadas. */
  turno: number;
  ganador: string | null;
  tajada: number | null;
  premio: number | null;
  canal: string | null;
  mensaje: string | null;
  mesa: string | null;
  /** El retador es un Vocaloid (desafío de la casa): no pone Shaulitas y, si gana, no cobra nada. */
  casa: boolean;
  creadaAt: number;
  venceAt: number;
}

export type Resultado<T> = ({ ok: true } & T) | { ok: false; motivo: string };

export interface Disparo {
  duelo: Duelo;
  /** Turno de este disparo y quién jaló (su id). */
  turno: number;
  quien: string;
  bang: boolean;
  /** Jaló Némesis porque se le acabó el tiempo. */
  auto: boolean;
}

export interface NemesisServiceDeps {
  db: Db;
  settings: NemesisSettings;
  coins: CoinService;
  now?: () => number;
  rnd?: () => number;
}

interface Row {
  id: string;
  retador: string;
  rival: string;
  apuesta: number;
  estado: EstadoDuelo;
  bala: number | null;
  primero: number | null;
  turno: number;
  ganador: string | null;
  tajada: number | null;
  premio: number | null;
  canal: string | null;
  mensaje: string | null;
  mesa: string | null;
  casa: number;
  creada_at: number;
  vence_at: number;
}

const toDuelo = (r: Row): Duelo => ({
  id: r.id,
  retador: r.retador,
  rival: r.rival,
  apuesta: r.apuesta,
  estado: r.estado,
  bala: r.bala,
  primero: r.primero === null ? null : (r.primero as 0 | 1),
  turno: r.turno,
  ganador: r.ganador,
  tajada: r.tajada,
  premio: r.premio,
  canal: r.canal,
  mensaje: r.mensaje,
  mesa: r.mesa,
  casa: r.casa === 1,
  creadaAt: r.creada_at,
  venceAt: r.vence_at,
});

export class NemesisService {
  private readonly now: () => number;
  private readonly rnd: () => number;

  constructor(private readonly d: NemesisServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  get settings(): NemesisSettings {
    return this.d.settings;
  }

  get(id: string): Duelo | null {
    const r = this.d.db.prepare("SELECT * FROM nemesis WHERE id = ?").get(id) as unknown as Row | undefined;
    return r ? toDuelo(r) : null;
  }

  /** La partida en curso (pendiente o jugando), si hay: una a la vez en todo el servidor. */
  active(): Duelo | null {
    const r = this.d.db.prepare("SELECT * FROM nemesis WHERE estado IN ('pendiente', 'jugando') ORDER BY creada_at DESC LIMIT 1").get() as unknown as Row | undefined;
    return r ? toDuelo(r) : null;
  }

  /** Shaulitas de un Papu (lo único que se apuesta). */
  coinsOf(userId: string): number {
    return this.d.coins.wallet(userId).monedas;
  }

  /** Id del Papu que jala en el turno en curso. */
  shooter(x: Duelo): string {
    return shooterAt(x.primero ?? 0, x.turno) === 0 ? x.retador : x.rival;
  }

  // ───────────────────────── desafío ─────────────────────────

  /** El retador desafía al rival: se le cobra su apuesta en el momento (se devuelve si no acepta). */
  challenge(retador: string, rival: string, apuesta: number, canal: string | null): Resultado<{ duelo: Duelo }> {
    if (retador === rival) return { ok: false, motivo: "No puedes desafiarte a ti mism@. Némesis no dispara dos veces al mismo pecador. 🔫" };
    if (this.active()) return { ok: false, motivo: "Ya hay una Ruleta de Némesis en curso: espera a que termine." };
    const check = checkApuesta(this.d.settings, apuesta, this.coinsOf(retador));
    if (!check.ok) return check;
    return transaction(this.d.db, () => {
      if (!this.d.coins.spend(retador, apuesta, "apuesta ruleta de Némesis")) return { ok: false as const, motivo: "No te alcanzan las Shaulitas." };
      const id = randomBytes(5).toString("hex");
      const t = this.now();
      this.d.db
        .prepare("INSERT INTO nemesis (id, retador, rival, apuesta, canal, creada_at, vence_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, retador, rival, apuesta, canal, t, t + this.d.settings.aceptarMinutos * 60_000);
      return { ok: true as const, duelo: this.get(id)! };
    });
  }

  /**
   * Un Vocaloid (la casa) desafía a un Papu: al bot no se le cobra nada. La apuesta la decide la racha de la casa
   * (apuestaCasa); el Papu la paga si acepta, como siempre.
   */
  challengeHouse(botUserId: string, rival: string, canal: string | null): Resultado<{ duelo: Duelo }> {
    if (botUserId === rival) return { ok: false, motivo: "Un Vocaloid no se desafía a sí mismo." };
    if (this.active()) return { ok: false, motivo: "Ya hay una Ruleta de Némesis en curso." };
    const apuesta = this.houseBet();
    const check = checkApuesta(this.d.settings, apuesta, this.coinsOf(rival));
    if (!check.ok) return check;
    const id = randomBytes(5).toString("hex");
    const t = this.now();
    this.d.db
      .prepare("INSERT INTO nemesis (id, retador, rival, apuesta, canal, casa, creada_at, vence_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
      .run(id, botUserId, rival, apuesta, canal, t, t + this.d.settings.aceptarMinutos * 60_000);
    return { ok: true, duelo: this.get(id)! };
  }

  /** Victorias seguidas de la casa (desde su última derrota). Los rechazos y vencidos no cuentan. */
  houseStreak(): number {
    const rows = this.d.db.prepare("SELECT retador, ganador FROM nemesis WHERE casa = 1 AND estado = 'terminada' ORDER BY terminada_at DESC, rowid DESC LIMIT 50").all() as unknown as { retador: string; ganador: string }[];
    let n = 0;
    for (const r of rows) {
      if (r.ganador !== r.retador) break;
      n++;
    }
    return n;
  }

  /** Apuesta del próximo desafío de los Vocaloids: sube con cada victoria de la casa y vuelve al inicio si pierde. */
  houseBet(): number {
    return apuestaCasa(this.d.settings, this.houseStreak());
  }

  /** Desafíos de la casa creados desde `since` (ms). */
  houseChallengesSince(since: number): { rival: string; creadaAt: number }[] {
    return (this.d.db.prepare("SELECT rival, creada_at FROM nemesis WHERE casa = 1 AND creada_at >= ? ORDER BY creada_at DESC").all(since) as unknown as { rival: string; creada_at: number }[]).map((r) => ({ rival: r.rival, creadaAt: r.creada_at }));
  }

  setMessage(id: string, canal: string, mensaje: string): void {
    this.d.db.prepare("UPDATE nemesis SET canal = ?, mensaje = ? WHERE id = ?").run(canal, mensaje, id);
  }

  setMesa(id: string, mesa: string): void {
    this.d.db.prepare("UPDATE nemesis SET mesa = ? WHERE id = ?").run(mesa, id);
  }

  /** El rival acepta: paga su apuesta, se carga el revólver (bala al azar) y se sortea quién empieza. */
  accept(id: string, userId: string): Resultado<{ duelo: Duelo }> {
    const x = this.get(id);
    if (!x || x.estado !== "pendiente") return { ok: false, motivo: "Este desafío ya no está abierto." };
    if (userId !== x.rival) return { ok: false, motivo: "Este desafío no es para ti. 🔫" };
    if (this.now() >= x.venceAt) return { ok: false, motivo: "El desafío ya venció." };
    const check = checkApuesta(this.d.settings, x.apuesta, this.coinsOf(userId));
    if (!check.ok) return { ok: false, motivo: `${check.motivo.replace(/^No te alcanza/, "No te alcanza para aceptar")}` };
    return transaction(this.d.db, () => {
      if (!this.d.coins.spend(userId, x.apuesta, "apuesta ruleta de Némesis")) return { ok: false as const, motivo: "No te alcanzan las Shaulitas." };
      const bala = Math.min(this.d.settings.recamaras - 1, Math.floor(this.rnd() * this.d.settings.recamaras));
      const primero = this.rnd() < 0.5 ? 0 : 1;
      this.d.db.prepare("UPDATE nemesis SET estado = 'jugando', bala = ?, primero = ?, turno = 0 WHERE id = ?").run(bala, primero, id);
      return { ok: true as const, duelo: this.get(id)! };
    });
  }

  /** El rival rechaza (o el retador lo retira): se le devuelve la apuesta al retador. */
  reject(id: string, userId: string): Resultado<{ duelo: Duelo; retirado: boolean }> {
    const x = this.get(id);
    if (!x || x.estado !== "pendiente") return { ok: false, motivo: "Este desafío ya no está abierto." };
    if (userId !== x.rival && userId !== x.retador) return { ok: false, motivo: "Este desafío no es para ti. 🔫" };
    this.close(x, "rechazada");
    return { ok: true, duelo: this.get(id)!, retirado: userId === x.retador };
  }

  /** Desafío sin respuesta a tiempo: vence y se devuelve la apuesta. null si no venció ninguno. */
  expire(): Duelo | null {
    const x = this.active();
    if (!x || x.estado !== "pendiente" || this.now() < x.venceAt) return null;
    this.close(x, "vencida");
    return this.get(x.id);
  }

  private close(x: Duelo, estado: "rechazada" | "vencida"): void {
    transaction(this.d.db, () => {
      if (!x.casa) this.d.coins.adjust(x.retador, "monedas", x.apuesta, `ruleta de Némesis ${estado} (devolución)`);
      this.d.db.prepare("UPDATE nemesis SET estado = ?, terminada_at = ? WHERE id = ?").run(estado, this.now(), x.id);
    });
  }

  // ───────────────────────── el revólver ─────────────────────────

  /**
   * Jala el gatillo en el turno `turno` (el botón lo lleva, así un doble clic no dispara dos veces). `userId` = quien
   * tocó el botón (null = Némesis jala por él porque se le acabó el tiempo). Si sale la bala, paga al otro.
   */
  pull(id: string, turno: number, userId: string | null): Resultado<{ disparo: Disparo }> {
    return transaction(this.d.db, () => {
      const x = this.get(id);
      if (!x || x.estado !== "jugando" || x.bala === null) return { ok: false as const, motivo: "Esta partida ya terminó." };
      if (x.turno !== turno) return { ok: false as const, motivo: "Ese turno ya pasó." };
      const quien = this.shooter(x);
      if (userId !== null && userId !== quien) return { ok: false as const, motivo: userId === x.retador || userId === x.rival ? "No es tu turno: espera a que jale el otro. 🔫" : "No estás en esta partida. 🔫" };
      const bang = x.turno === x.bala;
      if (bang) {
        const ganador = quien === x.retador ? x.rival : x.retador;
        const { tajada, premio } = reparto(this.d.settings, x.apuesta);
        // Desafío de la casa: si gana el Vocaloid, la apuesta del Papu sale de circulación (al bot no se le paga).
        if (!(x.casa && ganador === x.retador)) this.d.coins.adjust(ganador, "monedas", premio, `ruleta de Némesis ${id} ganada`);
        this.d.db.prepare("UPDATE nemesis SET estado = 'terminada', ganador = ?, tajada = ?, premio = ?, terminada_at = ? WHERE id = ?").run(ganador, tajada, premio, this.now(), id);
      } else this.d.db.prepare("UPDATE nemesis SET turno = turno + 1 WHERE id = ?").run(id);
      return { ok: true as const, disparo: { duelo: this.get(id)!, turno, quien, bang, auto: userId === null } };
    });
  }

  // ───────────────────────── reinicios ─────────────────────────

  /**
   * Partidas que quedaron a medias (el bot se reinició, o GyroP la canceló): se devuelve lo que puso cada uno y se
   * marcan 'devuelta'. Se llama al arrancar.
   */
  recover(): { duelo: Duelo; devuelto: number }[] {
    const rows = this.d.db.prepare("SELECT * FROM nemesis WHERE estado IN ('pendiente', 'jugando')").all() as unknown as Row[];
    return rows.map((row) =>
      transaction(this.d.db, () => {
        const x = toDuelo(row);
        let devuelto = 0;
        if (!x.casa) {
          this.d.coins.adjust(x.retador, "monedas", x.apuesta, `ruleta de Némesis ${x.id} cancelada (devolución)`);
          devuelto += x.apuesta;
        }
        if (x.estado === "jugando") {
          this.d.coins.adjust(x.rival, "monedas", x.apuesta, `ruleta de Némesis ${x.id} cancelada (devolución)`);
          devuelto += x.apuesta;
        }
        this.d.db.prepare("UPDATE nemesis SET estado = 'devuelta', terminada_at = ? WHERE id = ?").run(this.now(), x.id);
        return { duelo: { ...x, estado: "devuelta" as const }, devuelto };
      }),
    );
  }

  /** GyroP o un Mod cancelan la partida en curso: se devuelve todo. */
  cancel(): { duelo: Duelo; devuelto: number } | null {
    const x = this.active();
    if (!x) return null;
    return this.recover().find((r) => r.duelo.id === x.id) ?? null;
  }
}
