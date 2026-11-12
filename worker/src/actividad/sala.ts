// Durable Object de la trivia multijugador: una sala por instancia de la Actividad (cada vez que alguien la abre en un
// canal). Recibe a los Papus por WebSocket, comprueba quien es cada uno con Discord, mueve la sala (juego.ts) con su
// reloj y guarda los aciertos en D1 para que Teto les de su XP (src/trivia/actividad.ts). Sin LLM (regla 4).
import poolJson from "./pool.json";
import { Sala } from "./juego";
import { identificar } from "./identidad";
import { xpDeAcierto, type Perfil } from "./perfil";
import type { Pedido, Pool } from "./tipos";
import { COOKIE_TOKEN, leerCookie } from "../mundo/web";

export interface SalaEnv {
  DB: D1Database;
  GUILD_ID: string;
  /** "1" = acepta Papus de prueba sin Discord (solo en `wrangler dev`). */
  ACTIVIDAD_PRUEBA?: string;
  /** "1" = partida sandbox: no consulta perfiles ni persiste aciertos/recompensas. */
  MUNDO_PREVIEW?: string;
}

const POOL = poolJson as unknown as Pool;

export class SalaTrivia implements DurableObject {
  private readonly sala: Sala;
  private readonly sockets = new Map<WebSocket, string | null>();
  /** Sesion OAuth HttpOnly al abrir la trivia desde la Plaza web. */
  private readonly tokens = new Map<WebSocket, string>();
  private readonly perfiles = new Map<string, Perfil>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private canal: string | null = null;
  private partida = "";
  private faseAnterior = "sala";

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: SalaEnv,
  ) {
    this.sala = new Sala({
      pool: POOL.preguntas,
      xp: (papu, racha) => {
        const p = this.perfiles.get(papu);
        if (!p) return null;
        const xp = xpDeAcierto(p, racha, POOL.racha);
        p.tope -= xp;
        return xp;
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Se espera un WebSocket", { status: 426 });
    const url = new URL(request.url);
    const canal = url.searchParams.get("canal");
    if (canal && /^\d{5,25}$/.test(canal)) this.canal = canal;
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    this.sockets.set(server, null);
    const token = leerCookie(request.headers.get("Cookie"), COOKIE_TOKEN);
    if (token) this.tokens.set(server, token);
    server.addEventListener("message", (e) => void this.mensaje(server, String(e.data)).catch((err) => this.enviar(server, { error: String(err?.message ?? err) })));
    const cerrar = () => {
      const id = this.sockets.get(server);
      this.sockets.delete(server);
      this.tokens.delete(server);
      // Si el mismo Papu sigue conectado desde otra pestaña, no sale.
      if (id && ![...this.sockets.values()].includes(id)) this.sala.salir(id);
      this.despues();
    };
    server.addEventListener("close", cerrar);
    server.addEventListener("error", cerrar);
    return new Response(null, { status: 101, webSocket: client });
  }

  private enviar(ws: WebSocket, data: unknown): void {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Socket cerrado: lo limpia su evento close.
    }
  }

  private async mensaje(ws: WebSocket, raw: string): Promise<void> {
    if (raw.length > 4000) return;
    const m = JSON.parse(raw) as Pedido;
    const id = this.sockets.get(ws);
    if (!id) {
      if (m.t !== "hola") return;
      const p = await identificar({ ...m, token: m.token ?? this.tokens.get(ws) }, this.env, "Esta trivia es del servidor de los Papus: entra al servidor para jugar. 🧠");
      if (!p) return this.enviar(ws, { error: "No pude comprobar quién eres. Cierra y vuelve a abrir la Actividad." });
      if ("motivo" in p) return this.enviar(ws, { error: p.motivo });
      const res = this.sala.unir(p);
      if (!res.ok) return this.enviar(ws, { error: res.motivo });
      this.sockets.set(ws, p.id);
      await this.pedirPerfil(p.id);
      return this.despues();
    }
    let aviso: string | undefined;
    if (m.t === "configurar") this.sala.configurar(id, m);
    else if (m.t === "empezar") aviso = this.sala.empezar(id).motivo;
    else if (m.t === "responder") this.sala.responder(id, m.nonce, m);
    else if (m.t === "otra") this.sala.otra(id);
    if (aviso) this.enviar(ws, { aviso });
    this.despues();
  }

  /** Pide a Teto la XP base y el tope del dia del Papu (los calcula el bot y los deja en D1). */
  private async pedirPerfil(papu: string): Promise<void> {
    const now = Date.now();
    await this.env.DB.prepare(
      "INSERT INTO actividad_perfiles (papu_id, pedido_at) VALUES (?, ?) ON CONFLICT(papu_id) DO UPDATE SET pedido_at = excluded.pedido_at",
    )
      .bind(papu, now)
      .run();
    await this.leerPerfiles([papu]);
  }

  /** Lee de D1 los perfiles que Teto ya calculo (solo los mas nuevos que los que tiene la sala). */
  private async leerPerfiles(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const rows = await this.env.DB.prepare(`SELECT papu_id, xp_base, tope, actualizado_at FROM actividad_perfiles WHERE actualizado_at > 0 AND papu_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ papu_id: string; xp_base: number; tope: number; actualizado_at: number }>();
    for (const r of rows.results) {
      const prev = this.perfiles.get(r.papu_id);
      if (!prev || r.actualizado_at > prev.at) this.perfiles.set(r.papu_id, { base: r.xp_base, tope: r.tope, at: r.actualizado_at });
    }
  }

  /** Tras cada cambio: guarda los aciertos, reparte la vista y arma el temporizador. */
  private despues(): void {
    const fase = this.sala.fase;
    if (fase === "pregunta" && this.faseAnterior !== "pregunta" && this.faseAnterior !== "revelar") this.partida = `${Date.now().toString(36)}-${this.state.id.toString().slice(0, 8)}`;
    // Al empezar cada pregunta se refrescan los perfiles (Teto pudo recalcularlos al aplicar la XP).
    if (fase === "pregunta" && this.faseAnterior !== "pregunta") this.state.waitUntil(this.leerPerfiles(this.sala.ids()).catch(() => {}));
    this.faseAnterior = fase;
    const aciertos = this.sala.sacarAciertos();
    if (aciertos.length) {
      const now = Date.now();
      const stmt = this.env.DB.prepare("INSERT INTO actividad_aciertos (partida, papu_id, pregunta, dificultad, racha, xp_mostrada, canal, creado_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      this.state.waitUntil(this.env.DB.batch(aciertos.map((a) => stmt.bind(this.partida, a.papu, a.pregunta, a.dificultad, a.racha, a.xp, this.canal, now))).then(() => undefined, (e) => console.error("actividad: aciertos a D1", e)));
    }
    for (const [ws, id] of this.sockets) if (id) this.enviar(ws, { vista: this.sala.vista(id) });
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const at = this.sala.proximo();
    if (at !== null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.sala.tick();
        this.despues();
      }, Math.max(0, at - Date.now()) + 20);
    }
  }
}
