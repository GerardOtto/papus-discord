// Sala de la trivia multijugador (Actividad de Discord, PLAN §3.4): funciones puras, sin red ni Discord. El Durable
// Object (sala.ts) le pasa lo que hacen los Papus y el reloj, y reparte la vista a cada uno.
// - Todos ven la misma pregunta con su temporizador; en las de opciones se ve en vivo quien eligio cada una.
// - Si todos los que juegan ya contestaron, la pregunta termina al instante; si no, al acabarse el tiempo.
// - Se revela la correcta y cada acierto da XP (la aplica Teto, src/trivia/actividad.ts, con la regla de /trivia).
// Modos: eliminatoria (quien falla queda fuera; si fallan todos los que quedan, nadie cae) y cooperativo (el equipo
// pierde cuando todos fallaron al menos una vez). Las respuestas las revisa el codigo, nunca el LLM (regla 4).
import { isCorrect } from "../../../src/bodas/answer";
import type { Dificultad, Eleccion, JugadorVista, Modo, PreguntaPool, ResultadoVista, Vista } from "./tipos";

/**
 * Cuanto se muestra la respuesta antes de la siguiente pregunta: 3 s, con o sin dato curioso (pedido de GyroP, 9 nov.
 * 2026; antes 4,5 s y 2,5 s mas con dato).
 */
export const REVELAR_MS = 3000;
export const REVELAR_DATO_MS = 0;
/** Margen tras el limite (lo que tarda en llegar el clic). */
export const GRACIA_MS = 600;
export const MAX_JUGADORES = 30;
const ELECCIONES: Eleccion[] = ["mezcla", "facil", "medio", "dificil"];

/** Un acierto para que Teto le de su XP (tabla actividad_aciertos de D1). */
export interface Acierto {
  papu: string;
  pregunta: string;
  dificultad: Dificultad;
  racha: number;
  xp: number | null;
  factor?: number;
}

interface Jugador {
  id: string;
  nombre: string;
  avatar: string;
  conectado: boolean;
  juega: boolean;
  vivo: boolean;
  fallo: boolean;
  racha: number;
  aciertos: number;
  xp: number;
  orden: number;
  rachaFallida: number;
  baguetteActiva: boolean;
  rescatesBaguette: number;
}

interface Respuesta {
  opcion?: number;
  texto?: string;
  salvado?: boolean;
}

interface Ronda {
  pregunta: PreguntaPool;
  n: number;
  opciones: string[];
  correcta: number;
  nonce: string;
  deadline: number;
  respuestas: Map<string, Respuesta>;
  /** Al revelar. */
  resultados?: Record<string, ResultadoVista>;
  caen?: string[];
  nadieCae?: boolean;
  hasta?: number;
}

export interface SalaDeps {
  pool: PreguntaPool[];
  now?: () => number;
  rnd?: () => number;
  /** XP de un acierto con esa racha (null = aun no se sabe; Teto la calcula igual al aplicarla). */
  xp?: (papu: string, racha: number, factor?: number) => number | null;
  /** Ruta de los archivos de imagen y audio. */
  mediaBase?: string;
}

export function barajar<T>(list: readonly T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export class Sala {
  fase: Vista["fase"] = "sala";
  modo: Modo = "eliminatoria";
  eleccion: Eleccion = "mezcla";
  host: string | null = null;
  private readonly jugadores = new Map<string, Jugador>();
  private orden: PreguntaPool[] = [];
  private ronda: Ronda | null = null;
  private jugadas = 0;
  /** Cuantos empezaron la partida (en eliminatoria, con 2 o mas gana el ultimo en pie). */
  private empezaron = 0;
  private finInfo: Vista["fin"] | null = null;
  private contador = 0;
  private aciertos: Acierto[] = [];
  private readonly extras = new Map<string, { celular: number; guitarra: number; zanahoria: number; baguette: number }>();
  private readonly ocultas = new Map<string, { nonce: string; indices: number[] }>();
  private readonly guitarras = new Set<string>();
  private readonly zanahorias = new Map<string, string>();
  private zanahoriaRonda = "";
  private readonly now: () => number;
  private readonly rnd: () => number;

  constructor(private readonly d: SalaDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  // ───────────────────────── Papus ─────────────────────────

  setConsumibles(id: string, x: { celular: number; guitarra: number; zanahoria: number; baguette: number }): void { this.extras.set(id, x); }
  puedeCelular(id: string, nonce: string): boolean { const r=this.ronda,j=this.jugadores.get(id); return !!r&&this.fase==="pregunta"&&r.nonce===nonce&&!!j?.juega&&(this.modo==="cooperativo"||j.vivo)&&r.pregunta.tipo==="opciones"&&r.opciones.length>=4&&!r.respuestas.has(id)&&this.ocultas.get(id)?.nonce!==nonce&&(this.extras.get(id)?.celular??0)>0; }
  usarCelular(id: string, nonce: string): boolean { if(!this.puedeCelular(id,nonce))return false;const r=this.ronda!,wrong=r.opciones.map((_,i)=>i).filter(i=>i!==r.correcta);for(let i=wrong.length-1;i>0;i--){const j=Math.floor(this.rnd()*(i+1));[wrong[i],wrong[j]]=[wrong[j]!,wrong[i]!];}this.ocultas.set(id,{nonce,indices:wrong.slice(0,2)});return true; }
  puedeGuitarra(id:string,nonce:string):boolean {const j=this.jugadores.get(id);return !!this.ronda&&this.fase==="pregunta"&&this.ronda.nonce===nonce&&!!j?.juega&&(this.modo==="cooperativo"||j.vivo)&&!this.guitarras.has(id)&&(this.extras.get(id)?.guitarra??0)>0;}
  usarGuitarra(id:string,nonce:string):boolean {if(!this.puedeGuitarra(id,nonce))return false;this.guitarras.add(id);return true;}
  puedeZanahoria(id:string,nonce:string,tema:string):boolean {const j=this.jugadores.get(id);return !!this.ronda&&this.fase==="pregunta"&&this.ronda.nonce===nonce&&!!j?.juega&&(this.modo==="cooperativo"||j.vivo)&&this.zanahoriaRonda!==nonce&&(this.extras.get(id)?.zanahoria??0)>0&&this.orden.some(q=>(q.tema??q.categoria)===tema);}
  usarZanahoria(id:string,nonce:string,tema:string):boolean {if(!this.puedeZanahoria(id,nonce,tema))return false;const i=this.orden.findIndex(q=>(q.tema??q.categoria)===tema);const [q]=this.orden.splice(i,1);this.orden.unshift(q!);this.zanahorias.set(id,nonce);this.zanahoriaRonda=nonce;return true;}
  pendientesRescateBaguette(): string[] { if(this.fase!=="revelar"||!this.ronda?.resultados)return [];return Object.entries(this.ronda.resultados).filter(([id,r])=>!r.ok&&!r.salvado&&(this.jugadores.get(id)?.rescatesBaguette??2)<2).map(([id])=>id); }
  baguetteActiva(id:string):boolean {return !!this.jugadores.get(id)?.baguetteActiva;}
  activarBaguette(id:string):void {const j=this.jugadores.get(id);if(j)j.baguetteActiva=true;}
  desactivarBaguette(id:string):void {const j=this.jugadores.get(id);if(j)j.baguetteActiva=false;}
  rescatarBaguette(id:string):boolean {const j=this.jugadores.get(id),r=this.ronda?.resultados?.[id];if(this.fase!=="revelar"||!j||!r||r.ok||r.salvado||!j.baguetteActiva||j.rescatesBaguette>=2)return false;j.rescatesBaguette++;j.racha=j.rachaFallida;j.vivo=true;j.fallo=false;r.salvado=true;if(this.ronda?.caen)this.ronda.caen=this.ronda.caen.filter(x=>x!==id);return true;}
  /** Entra (o vuelve) un Papu. Si la partida ya empezo y no jugaba, mira hasta la siguiente. */
  unir(p: { id: string; nombre: string; avatar: string }): { ok: boolean; motivo?: string } {
    const prev = this.jugadores.get(p.id);
    if (prev) {
      Object.assign(prev, { nombre: p.nombre, avatar: p.avatar, conectado: true });
    } else {
      if (this.jugadores.size >= MAX_JUGADORES) return { ok: false, motivo: `La sala está llena (${MAX_JUGADORES} Papus).` };
      const enJuego = this.fase === "pregunta" || this.fase === "revelar";
      this.jugadores.set(p.id, { ...p, conectado: true, juega: !enJuego, vivo: !enJuego, fallo: false, racha: 0, aciertos: 0, xp: 0, orden: this.contador++, rachaFallida: 0, baguetteActiva: false, rescatesBaguette: 0 });
    }
    if (!this.host || !this.jugadores.get(this.host)?.conectado) this.host = p.id;
    return { ok: true };
  }

  /** Se fue (cerro la Actividad). Si era el anfitrion, pasa al siguiente; si ya no queda nadie, la partida se cierra. */
  salir(id: string): void {
    const j = this.jugadores.get(id);
    if (!j) return;
    j.conectado = false;
    if (this.fase === "sala" || this.fase === "fin") this.jugadores.delete(id);
    if (this.host === id) this.host = this.conectados()[0]?.id ?? null;
    if ((this.fase === "pregunta" || this.fase === "revelar") && !this.conectados().some((x) => x.juega)) {
      this.terminar("abandonaron");
      return;
    }
    if (this.fase === "pregunta" && this.todosRespondieron()) this.revelar();
  }

  private conectados(): Jugador[] {
    return [...this.jugadores.values()].filter((j) => j.conectado).sort((a, b) => a.orden - b.orden);
  }

  /** Los que deben contestar la pregunta en pantalla (eliminatoria: los que siguen en pie). */
  private participantes(): Jugador[] {
    return [...this.jugadores.values()].filter((j) => j.juega && (this.modo === "cooperativo" || j.vivo));
  }

  // ───────────────────────── sala ─────────────────────────

  /** El anfitrion elige modo y preguntas (antes de empezar o al terminar). */
  configurar(by: string, c: { modo?: Modo; eleccion?: Eleccion }): boolean {
    if (by !== this.host || (this.fase !== "sala" && this.fase !== "fin")) return false;
    if (c.modo === "eliminatoria" || c.modo === "cooperativo") this.modo = c.modo;
    if (c.eleccion && ELECCIONES.includes(c.eleccion)) this.eleccion = c.eleccion;
    return true;
  }

  private cuentas: Record<Eleccion, number> | null = null;

  /** Cuantas preguntas hay para cada eleccion (se calcula una vez: el pool completo tiene miles). */
  disponibles(): Record<Eleccion, number> {
    if (!this.cuentas) {
      const n = (e: Eleccion) => this.d.pool.filter((q) => e === "mezcla" || q.dificultad === e).length;
      this.cuentas = { mezcla: n("mezcla"), facil: n("facil"), medio: n("medio"), dificil: n("dificil") };
    }
    return this.cuentas;
  }

  /** Empieza la partida con todos los conectados (solo el anfitrion). */
  empezar(by: string): { ok: boolean; motivo?: string } {
    if (by !== this.host) return { ok: false, motivo: "Solo el anfitrión puede empezar." };
    if (this.fase !== "sala" && this.fase !== "fin") return { ok: false, motivo: "La partida ya empezó." };
    const preguntas = this.d.pool.filter((q) => this.eleccion === "mezcla" || q.dificultad === this.eleccion);
    if (!preguntas.length) return { ok: false, motivo: "No hay preguntas de esa dificultad." };
    for (const j of this.jugadores.values()) {
      if (!j.conectado) this.jugadores.delete(j.id);
      else Object.assign(j, { juega: true, vivo: true, fallo: false, racha: 0, aciertos: 0, xp: 0, rachaFallida: 0, baguetteActiva: false, rescatesBaguette: 0 });
    }
    this.empezaron = this.jugadores.size;
    this.guitarras.clear(); this.ocultas.clear(); this.zanahorias.clear();
    this.orden = barajar(preguntas, this.rnd);
    this.jugadas = 0;
    this.finInfo = null;
    this.siguiente();
    return { ok: true };
  }

  /** Vuelve a la sala para elegir otra partida (solo el anfitrion, al terminar). */
  otra(by: string): boolean {
    if (by !== this.host || this.fase !== "fin") return false;
    this.fase = "sala";
    this.finInfo = null;
    this.ronda = null;
    for (const j of this.jugadores.values()) Object.assign(j, { juega: true, vivo: true, fallo: false, racha: 0 });
    return true;
  }

  // ───────────────────────── preguntas ─────────────────────────

  private siguiente(): void {
    const pregunta = this.orden.shift()!;
    this.jugadas++;
    const opciones = pregunta.tipo === "opciones" ? barajar([pregunta.respuesta, ...pregunta.otras], this.rnd) : [];
    this.ronda = {
      pregunta,
      n: this.jugadas,
      opciones,
      correcta: opciones.indexOf(pregunta.respuesta),
      nonce: `${this.now().toString(36)}${(this.contador++).toString(36)}`,
      deadline: this.now() + pregunta.segundos * 1000,
      respuestas: new Map(),
    };
    this.fase = "pregunta";
  }

  /** Contesta la pregunta en pantalla (una sola vez). Devuelve false si no vale (vieja, fuera de tiempo, ya contesto…). */
  responder(id: string, nonce: string, r: { opcion?: number; texto?: string }): boolean {
    const ronda = this.ronda;
    if (this.fase !== "pregunta" || !ronda || ronda.nonce !== nonce) return false;
    if (this.now() > ronda.deadline + GRACIA_MS) return false;
    if (!this.participantes().some((j) => j.id === id) || ronda.respuestas.has(id)) return false;
    if (ronda.pregunta.tipo === "opciones") {
      if (!Number.isInteger(r.opcion) || r.opcion! < 0 || r.opcion! >= ronda.opciones.length) return false;
      ronda.respuestas.set(id, { opcion: r.opcion });
    } else {
      const texto = (r.texto ?? "").trim().slice(0, 100);
      if (!texto) return false;
      ronda.respuestas.set(id, { texto });
    }
    if (this.todosRespondieron()) this.revelar();
    return true;
  }

  /** ¿Ya contestaron todos los que siguen conectados y deben contestar? */
  private todosRespondieron(): boolean {
    const r = this.ronda!;
    const faltan = this.participantes().filter((j) => j.conectado && !r.respuestas.has(j.id));
    return faltan.length === 0;
  }

  private revelar(): void {
    const r = this.ronda!;
    const q = r.pregunta;
    const resultados: Record<string, ResultadoVista> = {};
    const fallaron: Jugador[] = [];
    const participantes = this.participantes();
    for (const j of participantes) {
      const resp = r.respuestas.get(j.id);
      const ok = !!resp && (q.tipo === "opciones" ? resp.opcion === r.correcta : isCorrect(resp.texto ?? "", q.aceptadas));
      let xp: number | null = 0;
      if (ok) {
        j.racha++;
        j.aciertos++;
        const factor = this.guitarras.has(j.id) ? 2 : 1;
        xp = this.d.xp ? this.d.xp(j.id, j.racha, factor) : null;
        if (xp) j.xp += xp;
        this.aciertos.push({ papu: j.id, pregunta: q.id, dificultad: q.dificultad, racha: j.racha, xp, ...(factor > 1 ? { factor } : {}) });
      } else {
        j.rachaFallida = j.racha;
        j.racha = 0;
        fallaron.push(j);
      }
      resultados[j.id] = { ok, xp: ok ? xp : 0, ...(resp?.opcion !== undefined ? { opcion: resp.opcion } : {}), ...(resp?.texto !== undefined ? { texto: resp.texto } : {}) };
    }
    let caen: string[] = [];
    let nadieCae = false;
    if (this.modo === "eliminatoria") {
      // Con 2 o mas en pie, si fallan todos nadie cae (asi siempre hay un ganador). Solo, fallar es perder.
      if (participantes.length >= 2 && fallaron.length === participantes.length) nadieCae = true;
      else for (const j of fallaron) (j.vivo = false), caen.push(j.id);
    } else {
      for (const j of fallaron) j.fallo = true;
      caen = [];
    }
    Object.assign(r, { resultados, caen, nadieCae, hasta: this.now() + REVELAR_MS + (q.dato ? REVELAR_DATO_MS : 0) });
    this.fase = "revelar";
  }

  /** Tras revelar: la siguiente pregunta o el final. */
  private avanzar(): void {
    const juegan = [...this.jugadores.values()].filter((j) => j.juega);
    if (this.modo === "eliminatoria") {
      const vivos = juegan.filter((j) => j.vivo);
      if (vivos.length === 0) return this.terminar("eliminados");
      if (this.empezaron >= 2 && vivos.length === 1) return this.terminar("ganador", vivos[0]!.id);
    } else if (juegan.length && juegan.every((j) => j.fallo)) return this.terminar("todos-fallaron");
    if (!this.orden.length) return this.terminar("sin-preguntas");
    this.siguiente();
  }

  private terminar(motivo: NonNullable<Vista["fin"]>["motivo"], ganador?: string): void {
    this.fase = "fin";
    this.finInfo = { motivo, preguntas: this.jugadas, ...(ganador ? { ganador } : {}) };
    this.orden = [];
    for (const j of this.jugadores.values()) if (!j.conectado) this.jugadores.delete(j.id);
    if (this.host && !this.jugadores.has(this.host)) this.host = this.conectados()[0]?.id ?? null;
  }

  // ───────────────────────── reloj ─────────────────────────

  /** Lo llama el temporizador: cierra la pregunta vencida o pasa de la respuesta a la siguiente. */
  tick(): void {
    const t = this.now();
    if (this.fase === "pregunta" && this.ronda && t >= this.ronda.deadline + GRACIA_MS) this.revelar();
    else if (this.fase === "revelar" && this.ronda?.hasta !== undefined && t >= this.ronda.hasta) this.avanzar();
  }

  /** Cuando hay que llamar a tick (null = nada pendiente). */
  proximo(): number | null {
    if (this.fase === "pregunta" && this.ronda) return this.ronda.deadline + GRACIA_MS;
    if (this.fase === "revelar" && this.ronda?.hasta !== undefined) return this.ronda.hasta;
    return null;
  }

  /** Aciertos nuevos desde la ultima vez (para guardarlos en D1). */
  sacarAciertos(): Acierto[] {
    const a = this.aciertos;
    this.aciertos = [];
    return a;
  }

  /** Devuelve al buffer los aciertos si D1 no confirmó su escritura. */
  devolverAciertos(aciertos: readonly Acierto[]): void {
    if (aciertos.length) this.aciertos = [...aciertos, ...this.aciertos];
  }

  /** Ids de quienes juegan la partida en curso. */
  ids(): string[] {
    return [...this.jugadores.values()].filter((j) => j.conectado).map((j) => j.id);
  }

  // ───────────────────────── vista ─────────────────────────

  vista(yo: string): Vista {
    const r = this.ronda;
    const t = this.now();
    const jugadores: JugadorVista[] = [...this.jugadores.values()]
      .sort((a, b) => a.orden - b.orden)
      .map((j) => ({
        id: j.id,
        nombre: j.nombre,
        avatar: j.avatar,
        conectado: j.conectado,
        juega: j.juega,
        vivo: j.vivo,
        fallo: j.fallo,
        racha: j.racha,
        aciertos: j.aciertos,
        xp: j.xp,
        respondio: this.fase === "pregunta" && !!r?.respuestas.has(j.id),
      }));
    const v: Vista = { fase: this.fase, modo: this.modo, eleccion: this.eleccion, host: this.host, yo, jugadores, disponibles: this.disponibles() };
    if (r && (this.fase === "pregunta" || this.fase === "revelar")) {
      const q = r.pregunta;
      const elecciones = r.opciones.map(() => [] as string[]);
      for (const [id, resp] of r.respuestas) if (resp.opcion !== undefined) elecciones[resp.opcion]?.push(id);
      v.pregunta = {
        n: r.n,
        nonce: r.nonce,
        dificultad: q.dificultad,
        tema: q.tema ?? q.categoria,
        tipo: q.tipo,
        texto: q.texto,
        opciones: r.opciones,
        ocultas: this.ocultas.get(yo)?.nonce===r.nonce ? this.ocultas.get(yo)!.indices : [],
        temas: [...new Set(this.orden.map(q=>q.tema??q.categoria))].map(tema=>({tema,n:this.orden.filter(q=>(q.tema??q.categoria)===tema).length})).sort((a,b)=>b.n-a.n),
        ...(q.media ? { media: { tipo: q.media.tipo, url: `${this.d.mediaBase ?? "media/"}${q.media.archivo}` } } : {}),
        segundos: q.segundos,
        restante: Math.max(0, r.deadline - t),
        elecciones,
      };
      if (this.fase === "revelar") {
        v.revelar = {
          correcta: r.correcta,
          respuesta: q.respuesta,
          ...(q.dato ? { dato: q.dato } : {}),
          resultados: r.resultados ?? {},
          caen: r.caen ?? [],
          nadieCae: r.nadieCae ?? false,
          restante: Math.max(0, (r.hasta ?? t) - t),
        };
      }
    }
    v.consumibles = { celular:this.extras.get(yo)?.celular??0, guitarra:this.extras.get(yo)?.guitarra??0, zanahoria:this.extras.get(yo)?.zanahoria??0, baguette:this.extras.get(yo)?.baguette??0, guitarraActiva:this.guitarras.has(yo) };
    if (this.fase === "fin" && this.finInfo) v.fin = this.finInfo;
    return v;
  }
}
