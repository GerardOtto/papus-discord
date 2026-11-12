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
  /** "1" = partida sandbox: sincroniza perfiles, aciertos y consumibles exclusivamente con el ledger preview. */
  MUNDO_PREVIEW?: string;
}

const POOL = poolJson as unknown as Pool;

export class SalaTrivia implements DurableObject {
  private readonly sala: Sala;
  private readonly sockets = new Map<WebSocket, string | null>();
  /** Sesion OAuth HttpOnly al abrir la trivia desde la Plaza web. */
  private readonly tokens = new Map<WebSocket, string>();
  private readonly perfiles = new Map<string, Perfil>();
  private readonly rescatandoBaguette = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistAttempts = 0;
  private canal: string | null = null;
  private partida = "";
  private faseAnterior = "sala";

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: SalaEnv,
  ) {
    this.sala = new Sala({
      pool: POOL.preguntas,
      xp: (papu, racha, factor) => {
        const p = this.perfiles.get(papu);
        if (!p) return null;
        const xp = xpDeAcierto(p, racha, POOL.racha, factor);
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
    server.addEventListener("message", (e) => void this.mensaje(server, String(e.data)).catch((err) => { this.enviar(server, { error: String(err?.message ?? err) }); this.programarReintentoAciertos(); }));
    const cerrar = () => {
      const id = this.sockets.get(server);
      this.sockets.delete(server);
      this.tokens.delete(server);
      // Si el mismo Papu sigue conectado desde otra pestaña, no sale.
      if (id && ![...this.sockets.values()].includes(id)) this.sala.salir(id);
      void this.despues().catch((e) => { console.error("actividad: al salir", e); this.programarReintentoAciertos(); });
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
      if (this.env.MUNDO_PREVIEW === "1") this.sala.setConsumibles(p.id, await this.estadoConsumibles(p.id));
      return this.despues();
    }
    let aviso: string | undefined;
    if (m.t === "configurar") this.sala.configurar(id, m);
    else if (m.t === "empezar") aviso = this.sala.empezar(id).motivo;
    else if (m.t === "responder") this.sala.responder(id, m.nonce, m);
    else if (m.t === "otra") this.sala.otra(id);
    else if (m.t === "consumible") await this.usarConsumible(id,m,ws);
    if (aviso) this.enviar(ws, { aviso });
    await this.despues();
  }


  private async estadoConsumibles(papu: string): Promise<{celular:number;guitarra:number;zanahoria:number;baguette:number}> {
    const row=await this.env.DB.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id = ?").bind(papu).first<{estado:string}>();
    const usos=(JSON.parse(row?.estado??"{}") as {consumibles?:Record<string,number>}).consumibles??{};
    return {celular:usos["celular-neru"]??0,guitarra:usos["guitarra-flower"]??0,zanahoria:usos["zanahoria-gumi"]??0,baguette:usos["baguette-teto"]??0};
  }

  private async modificarUso(papu:string,objeto:string,delta:number):Promise<boolean>{
    for(let i=0;i<6;i++){
      const row=await this.env.DB.prepare("SELECT estado,revision FROM mundo_sandbox WHERE papu_id = ?").bind(papu).first<{estado:string;revision:number}>();
      if(!row)return false;
      const state=JSON.parse(row.estado) as {version:number;consumibles?:Record<string,number>};
      if(state.version!==1)return false;
      state.consumibles??={};
      const usos=state.consumibles[objeto]??0;
      if(delta<0&&usos<=0)return false;
      state.consumibles[objeto]=usos+delta;
      const result=await this.env.DB.prepare("UPDATE mundo_sandbox SET estado = ?, revision = revision + 1, actualizado_at = ? WHERE papu_id = ? AND revision = ? RETURNING revision")
        .bind(JSON.stringify(state),Date.now(),papu,row.revision).first<{revision:number}>();
      if(result)return true;
    }
    return false;
  }

  private async usarConsumible(papu:string,m:Extract<Pedido,{t:"consumible"}>,ws:WebSocket):Promise<void>{
    if(this.env.MUNDO_PREVIEW!=="1")return this.enviar(ws,{aviso:"Los consumibles de trivia solo se habilitan en el preview sandbox."});
    const objeto=m.objeto==="celular"?"celular-neru":m.objeto==="guitarra"?"guitarra-flower":"zanahoria-gumi";
    const valido=m.objeto==="celular"?this.sala.puedeCelular(papu,m.nonce):m.objeto==="guitarra"?this.sala.puedeGuitarra(papu,m.nonce):!!m.tema&&this.sala.puedeZanahoria(papu,m.nonce,m.tema);
    if(!valido)return this.enviar(ws,{aviso:"Ese consumible no se puede usar en esta pregunta."});
    if(!await this.modificarUso(papu,objeto,-1))return this.enviar(ws,{aviso:"No te quedan usos de ese consumible en tu inventario de prueba."});
    const aplicado=m.objeto==="celular"?this.sala.usarCelular(papu,m.nonce):m.objeto==="guitarra"?this.sala.usarGuitarra(papu,m.nonce):this.sala.usarZanahoria(papu,m.nonce,m.tema!);
    if(!aplicado){await this.modificarUso(papu,objeto,1);return this.enviar(ws,{aviso:"La pregunta cambió mientras activabas el objeto; no se consumió el uso."});}
    this.sala.setConsumibles(papu,await this.estadoConsumibles(papu));
    this.enviar(ws,{aviso:m.objeto==="celular"?"📱 Neru eliminó dos opciones incorrectas solo para ti.":m.objeto==="guitarra"?"🎸 ¡Guitarra de flower activada! Tus aciertos de esta partida dan el doble de XP, respetando el tope.":`🥕 Gumi eligió el tema ${m.tema} para la siguiente pregunta de todo el equipo.`});
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
      if (this.env.MUNDO_PREVIEW === "1") this.sala.setConsumibles(r.papu_id, await this.estadoConsumibles(r.papu_id));
    }
  }

  /** La Baguette salva automáticamente hasta dos fallos de quien la tenga; no pausa la ronda compartida. */
  private async rescatarConBaguette(): Promise<void> {
    for (const id of this.sala.pendientesRescateBaguette()) {
      if (this.rescatandoBaguette.has(id)) continue;
      this.rescatandoBaguette.add(id);
      try {
        if (!this.sala.baguetteActiva(id)) {
          if (!await this.modificarUso(id, "baguette-teto", -1)) continue;
          this.sala.activarBaguette(id);
          this.sala.setConsumibles(id, await this.estadoConsumibles(id));
        }
        this.sala.rescatarBaguette(id);
      } finally {
        this.rescatandoBaguette.delete(id);
      }
    }
  }

  private programarReintentoAciertos(): void {
    if (this.persistTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.persistAttempts++, 5));
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.despues().catch((e) => { console.error("actividad: reintento de sala", e); this.programarReintentoAciertos(); });
    }, delay);
  }

  /** Tras cada cambio: guarda los aciertos, reparte la vista y arma el temporizador. */
  private async despues(): Promise<void> {
    if (this.env.MUNDO_PREVIEW === "1" && this.sala.fase === "revelar") await this.rescatarConBaguette();
    const fase = this.sala.fase;
    if (fase === "pregunta" && this.faseAnterior !== "pregunta" && this.faseAnterior !== "revelar") this.partida = `${Date.now().toString(36)}-${this.state.id.toString().slice(0, 8)}`;
    // Al empezar cada pregunta se refrescan los perfiles (Teto pudo recalcularlos al aplicar la XP).
    if (fase === "pregunta" && this.faseAnterior !== "pregunta") this.state.waitUntil(this.leerPerfiles(this.sala.ids()).catch(() => {}));
    this.faseAnterior = fase;
    const aciertos = this.sala.sacarAciertos();
    if (aciertos.length) {
      const now = Date.now();
      const preview = this.env.MUNDO_PREVIEW === "1";
      const previewStmt = this.env.DB.prepare("INSERT OR IGNORE INTO actividad_aciertos_preview (partida, papu_id, pregunta, dificultad, racha, xp_mostrada, canal, creado_at, multiplicador) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const productionStmt = this.env.DB.prepare("INSERT INTO actividad_aciertos (partida, papu_id, pregunta, dificultad, racha, xp_mostrada, canal, creado_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM actividad_aciertos WHERE partida = ? AND papu_id = ? AND pregunta = ?)");
      try {
        // El preview usa índice único; producción usa NOT EXISTS. Ambos toleran reintentos tras una respuesta D1 ambigua.
        await this.env.DB.batch(aciertos.map((a) => preview
          ? previewStmt.bind(this.partida, a.papu, a.pregunta, a.dificultad, a.racha, a.xp, this.canal, now, a.factor ?? 1)
          : productionStmt.bind(this.partida, a.papu, a.pregunta, a.dificultad, a.racha, a.xp, this.canal, now, this.partida, a.papu, a.pregunta)));
        if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
        this.persistAttempts = 0;
      } catch (error) {
        this.sala.devolverAciertos(aciertos);
        console.error("actividad: no se pudieron persistir los aciertos; se reintentará", error);
        this.programarReintentoAciertos();
      }
    }
    for (const [ws, id] of this.sockets) if (id) this.enviar(ws, { vista: this.sala.vista(id) });
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const at = this.sala.proximo();
    if (at !== null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.sala.tick();
        void this.despues().catch((e) => { console.error("actividad: temporizador", e); this.programarReintentoAciertos(); });
      }, Math.max(0, at - Date.now()) + 20);
    }
  }
}
