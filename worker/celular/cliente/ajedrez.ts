// App ♟️ Ajedrez del celular de Neru (config/ajedrez.json; idea de Mango9374, 18 nov. 2026). Tablero táctil: se toca
// una pieza (se marcan sus jugadas) y luego la casilla. Contra un Vocaloid se juega aquí mismo (src/ajedrez/ia.ts, sin
// servidor ni premios); contra un Papu, el worker valida cada jugada y la página pregunta el estado cada 1,5 s.
import { elegirJugada, type Nivel } from "../../../src/ajedrez/ia";
import { aplicar, clavePosicion, colorDe, enJaque, escribirFen, final, INICIAL, leerFen, legales, nombreCasilla, uci, type Color, type Jugada, type Posicion } from "../../../src/ajedrez/motor";
import type { Vista } from "../../../src/ajedrez/partidas";

export interface CtxAjedrez {
  app: HTMLElement;
  yo: () => { id: string; nombre: string };
  api: <T>(ruta: string, cuerpo?: unknown) => Promise<T>;
  esc: (s: string) => string;
  aviso: (t: string) => void;
  cabeza: (titulo: string, sub: string, color: string) => string;
  alVolver: () => void;
  cargando: (t: string) => string;
  elegirPapu: (titulo: string, alElegir: (p: { id: string; nombre: string }) => void) => void;
  enPantalla: () => boolean;
}

interface Rival {
  id: string;
  nivel: Nivel;
  frase: string;
}

interface EstadoAjedrez {
  activo: boolean;
  apuesta: { minima: number; maxima: number };
  relojMin: number;
  comision: number;
  rivales: Rival[];
  mias: Vista[];
}

const COLOR = "#8fd3ff";
const PIEZA: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const NIVEL = { 1: "Fácil", 2: "Media", 3: "Difícil" } as const;
const NOMBRES: Record<string, string> = { teto: "Teto", miku: "Miku", luka: "Luka", neru: "Neru", kaito: "Kaito", rin: "Rin", len: "Len", gumi: "Gumi", meiko: "Meiko", gakupo: "Gakupo", ia: "IA", adachirei: "Adachi Rei", haku: "Haku", flower: "flower", ruko: "Ruko" };
const MOTIVO: Record<string, string> = {
  jaque_mate: "jaque mate",
  ahogado: "rey ahogado: tablas",
  material: "sin material: tablas",
  cincuenta: "50 jugadas sin capturas: tablas",
  repeticion: "triple repetición: tablas",
  tiempo: "se acabó el tiempo",
  abandono: "abandono",
  retirado: "retirado",
  sin_shaulitas: "a alguien no le alcanzaban las Shaulitas",
};

let ctx: CtxAjedrez;
let sondeo: ReturnType<typeof setInterval> | null = null;
let reloj: ReturnType<typeof setInterval> | null = null;
let estado: EstadoAjedrez | null = null;

export function cerrarAjedrez(): void {
  if (sondeo) clearInterval(sondeo);
  if (reloj) clearInterval(reloj);
  sondeo = reloj = null;
  document.querySelector(".hoja")?.remove();
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ───────────────────────── tablero ─────────────────────────

interface Tablero {
  pos: Posicion;
  /** Desde qué lado se mira (el color del Papu). */
  lado: Color;
  /** ¿Puede mover ahora? */
  puede: boolean;
  ultima: { de: number; a: number } | null;
  alJugar: (j: Jugada) => void;
}

let sel: number | null = null;

function tableroHtml(t: Tablero): string {
  const legalesSel = sel === null ? [] : legales(t.pos).filter((j) => j.de === sel);
  const destinos = new Set(legalesSel.map((j) => j.a));
  const jaque = enJaque(t.pos) ? t.pos.tablero.indexOf(t.pos.turno === "w" ? "K" : "k") : -1;
  const filas = t.lado === "w" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const cols = t.lado === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  let h = "";
  for (const f of filas)
    for (const c of cols) {
      const sq = f * 8 + c;
      const p = t.pos.tablero[sq]!;
      const cls = [
        "casilla",
        (f + c) % 2 ? "clara" : "oscura",
        sq === sel ? "sel" : "",
        t.ultima && (sq === t.ultima.de || sq === t.ultima.a) ? "ultima" : "",
        destinos.has(sq) ? (p ? "captura" : "destino") : "",
        sq === jaque ? "jaque" : "",
      ].join(" ");
      const etiqueta = `${nombreCasilla(sq)}${p ? ` ${colorDe(p) === "w" ? "blanca" : "negra"}` : ""}`;
      h += `<button class="${cls}" data-sq="${sq}" aria-label="${etiqueta}">${p ? `<span class="pieza ${colorDe(p) === "w" ? "pb" : "pn"}">${PIEZA[p.toLowerCase()]}</span>` : ""}</button>`;
    }
  return `<div class="ajedrez-tablero">${h}</div>`;
}

function conectarTablero(t: Tablero, redibujar: () => void): void {
  for (const b of ctx.app.querySelectorAll<HTMLButtonElement>(".ajedrez-tablero .casilla")) {
    b.onclick = () => {
      if (!t.puede) return;
      const sq = Number(b.dataset.sq);
      const pz = t.pos.tablero[sq]!;
      if (sel !== null) {
        const js = legales(t.pos).filter((j) => j.de === sel && j.a === sq);
        if (js.length) {
          sel = null;
          if (js.length > 1) return elegirCorona(js, t.alJugar);
          return t.alJugar(js[0]!);
        }
      }
      sel = pz && colorDe(pz) === t.pos.turno && sel !== sq ? sq : null;
      redibujar();
    };
  }
}

function elegirCorona(js: Jugada[], alJugar: (j: Jugada) => void): void {
  const capa = document.createElement("div");
  capa.className = "hoja";
  capa.innerHTML = `<div class="hoja-caja"><div class="hoja-tit">¿A qué corona tu peón?</div><div class="ajedrez-corona">${["q", "r", "b", "n"].map((c) => `<button data-c="${c}">${PIEZA[c]}</button>`).join("")}</div></div>`;
  document.body.append(capa);
  for (const b of capa.querySelectorAll<HTMLButtonElement>("button"))
    b.onclick = () => {
      capa.remove();
      alJugar(js.find((j) => j.corona === b.dataset.c)!);
    };
}

// ───────────────────────── menú ─────────────────────────

export async function abrirAjedrez(c: CtxAjedrez, nota = ""): Promise<void> {
  ctx = c;
  cerrarAjedrez();
  ctx.app.innerHTML = `${ctx.cabeza("Ajedrez", "Contra un Vocaloid o contra un Papu", COLOR)}${ctx.cargando("Acomodando las piezas…")}`;
  ctx.alVolver();
  try {
    estado = await ctx.api<EstadoAjedrez>("ajedrez");
  } catch (e) {
    ctx.app.innerHTML = `${ctx.cabeza("Ajedrez", "", COLOR)}<p class="nota">${ctx.esc((e as Error).message)}</p>`;
    return ctx.alVolver();
  }
  if (!ctx.enPantalla()) return;
  dibujarMenu(nota);
}

function tarjetaPartida(v: Vista): string {
  const yo = ctx.yo().id;
  const otro = v.retador.id === yo ? v.rival : v.retador;
  const apuesta = v.apuesta ? ` · 🪙 ${v.apuesta}` : "";
  let linea = "", botones = "";
  if (v.estado === "reto" && v.rival.id === yo) {
    linea = `<b>${ctx.esc(otro.nombre)}</b> te retó${apuesta}`;
    botones = `<button class="boton" data-acc="aceptar" data-id="${v.id}">Aceptar</button><button class="boton suave" data-acc="rechazar" data-id="${v.id}">Rechazar</button>`;
  } else if (v.estado === "reto") {
    linea = `Retaste a <b>${ctx.esc(otro.nombre)}</b>${apuesta} · esperando`;
    botones = `<button class="boton suave" data-acc="cancelar" data-id="${v.id}">Cancelar</button>`;
  } else if (v.estado === "aceptada" || v.estado === "jugando") {
    linea = `En juego contra <b>${ctx.esc(otro.nombre)}</b>${apuesta}`;
    botones = `<button class="boton" data-ver="${v.id}">Abrir</button>`;
  } else {
    const res = v.estado === "terminada" ? (v.ganador === "tablas" ? "Tablas" : v.ganador === yo ? "Ganaste" : "Perdiste") : v.estado === "rechazada" ? "Rechazado" : v.estado === "vencida" ? "Venció" : "Cancelado";
    linea = `${res} contra <b>${ctx.esc(otro.nombre)}</b>${apuesta}${v.motivo ? ` · ${ctx.esc(MOTIVO[v.motivo] ?? v.motivo)}` : ""}`;
    if (v.estado === "terminada") botones = `<button class="boton suave" data-ver="${v.id}">Ver</button>`;
  }
  return `<div class="aj-partida"><p>${linea}</p><div class="aj-fila">${botones}</div></div>`;
}

function dibujarMenu(nota = ""): void {
  const e = estado!;
  const rivales = e.rivales
    .map((r) => `<button class="ajedrez-rival" data-rival="${r.id}"><b>${ctx.esc(NOMBRES[r.id] ?? r.id)}</b><small>${NIVEL[r.nivel]} ${"★".repeat(r.nivel)}</small></button>`)
    .join("");
  ctx.app.innerHTML = `${ctx.cabeza("Ajedrez", "Contra un Vocaloid o contra un Papu", COLOR)}
    ${nota ? `<p class="nota">${ctx.esc(nota)}</p>` : ""}
    <div class="seccion">Contra un Papu</div>
    <p class="nota">Cada uno tiene ${e.relojMin} min para toda la partida. Pueden apostar de ${e.apuesta.minima} a ${e.apuesta.maxima} Shaulitas: el ganador se lleva las dos menos el ${Math.round(e.comision * 100)} % (en tablas, cada uno recupera la suya). Neru avisa el reto en #general.</p>
    <button class="boton" id="retar">♟️ Retar a un Papu</button>
    ${e.mias.length ? `<div class="aj-partidas">${e.mias.map(tarjetaPartida).join("")}</div>` : ""}
    <div class="seccion">Contra un Vocaloid</div>
    <p class="nota">Se juega aquí mismo, sin apuesta ni premios: para practicar.</p>
    <div class="ajedrez-rivales">${rivales}</div>`;
  ctx.alVolver();
  ctx.app.querySelector("#retar")?.addEventListener("click", () => retar());
  for (const b of ctx.app.querySelectorAll<HTMLButtonElement>("[data-rival]")) b.onclick = () => contraVocaloid(e.rivales.find((r) => r.id === b.dataset.rival)!);
  for (const b of ctx.app.querySelectorAll<HTMLButtonElement>("[data-ver]")) b.onclick = () => void contraPapu(b.dataset.ver!);
  for (const b of ctx.app.querySelectorAll<HTMLButtonElement>("[data-acc]"))
    b.onclick = async () => {
      b.disabled = true;
      try {
        const v = await ctx.api<Vista>("ajedrez/responder", { id: b.dataset.id, accion: b.dataset.acc });
        if (b.dataset.acc === "aceptar") return void contraPapu(v.id);
        await abrirAjedrez(ctx, b.dataset.acc === "rechazar" ? "Rechazaste el reto." : "Cancelaste el reto.");
      } catch (err) {
        ctx.aviso((err as Error).message);
        b.disabled = false;
      }
    };
  // Mientras haya retos pendientes, el menú se refresca solo (para ver si aceptaron).
  if (e.mias.some((v) => v.estado === "reto" || v.estado === "aceptada"))
    sondeo = setInterval(async () => {
      if (!ctx.enPantalla() || document.querySelector(".hoja")) return;
      const n = await ctx.api<EstadoAjedrez>("ajedrez").catch(() => null);
      if (!n || !ctx.enPantalla()) return;
      const empezo = n.mias.find((v) => v.estado === "jugando" && estado!.mias.some((x) => x.id === v.id && x.estado !== "jugando"));
      estado = n;
      if (empezo) return void contraPapu(empezo.id);
      cerrarAjedrez();
      dibujarMenu();
    }, 3000);
}

function retar(): void {
  ctx.elegirPapu("¿A quién retas?", (p) => {
    const e = estado!;
    const capa = document.createElement("div");
    capa.className = "hoja";
    capa.innerHTML = `<div class="hoja-caja"><div class="hoja-tit">Reto a ${ctx.esc(p.nombre)}</div>
      <label class="nota">Apuesta (0 = sin apuesta; de ${e.apuesta.minima} a ${e.apuesta.maxima})</label>
      <input type="number" inputmode="numeric" min="0" max="${e.apuesta.maxima}" value="0" />
      <button class="boton">♟️ Enviar reto</button><button class="boton suave">Cancelar</button></div>`;
    document.body.append(capa);
    const [enviar, cancelar] = capa.querySelectorAll<HTMLButtonElement>("button");
    cancelar!.onclick = () => capa.remove();
    enviar!.onclick = async () => {
      enviar!.disabled = true;
      try {
        await ctx.api("ajedrez/retar", { rival: p, apuesta: Number(capa.querySelector("input")!.value || 0) });
        capa.remove();
        await abrirAjedrez(ctx, `Reto enviado a ${p.nombre}. Neru le avisa en #general.`);
      } catch (err) {
        ctx.aviso((err as Error).message);
        enviar!.disabled = false;
      }
    };
  });
}

// ───────────────────────── contra un Vocaloid ─────────────────────────

function contraVocaloid(r: Rival): void {
  cerrarAjedrez();
  const lado: Color = Math.random() < 0.5 ? "w" : "b";
  let pos = leerFen(INICIAL);
  const vistas = new Map<string, number>([[clavePosicion(pos), 1]]);
  let ultima: Tablero["ultima"] = null;
  let fin = "";
  let pensando = false;
  const nombre = NOMBRES[r.id] ?? r.id;
  sel = null;
  const terminar = () => {
    const f = final(pos, vistas.get(clavePosicion(pos)) ?? 1);
    if (!f) return false;
    fin = f === "jaque_mate" ? (pos.turno === lado ? `${nombre} te ganó con jaque mate. ¡Otra!` : `¡Le ganaste a ${nombre}! 🎉`) : `Tablas (${MOTIVO[f]}).`;
    return true;
  };
  const jugar = (j: Jugada) => {
    pos = aplicar(pos, j);
    vistas.set(clavePosicion(pos), (vistas.get(clavePosicion(pos)) ?? 0) + 1);
    ultima = { de: j.de, a: j.a };
    sel = null;
    if (!terminar() && pos.turno !== lado) turnoBot();
    dibujar();
  };
  const turnoBot = () => {
    pensando = true;
    // Un respiro para que se vea la jugada del Papu antes de que piense.
    setTimeout(() => {
      if (!ctx.enPantalla()) return;
      const j = elegirJugada(pos, r.nivel);
      pensando = false;
      if (j) jugar(j);
    }, 350);
  };
  const dibujar = () => {
    if (!ctx.enPantalla()) return;
    const t: Tablero = { pos, lado, puede: !fin && !pensando && pos.turno === lado, ultima, alJugar: jugar };
    const estadoTxt = fin || (pensando ? `${nombre} está pensando…` : pos.turno === lado ? `Te toca (${lado === "w" ? "blancas" : "negras"})${enJaque(pos) ? " · ¡jaque!" : ""}` : "");
    ctx.app.innerHTML = `${ctx.cabeza(`Contra ${nombre}`, `${NIVEL[r.nivel]} · juegas con ${lado === "w" ? "blancas" : "negras"}`, COLOR)}
      <div class="neru"><p>«${ctx.esc(r.frase)}»</p></div>
      ${tableroHtml(t)}
      <p class="ajedrez-estado">${ctx.esc(estadoTxt)}</p>
      <div class="aj-fila"><button class="boton suave" id="salir">${fin ? "Volver" : "Rendirse"}</button>${fin ? `<button class="boton" id="otra">Otra partida</button>` : ""}</div>`;
    ctx.alVolver();
    conectarTablero(t, dibujar);
    ctx.app.querySelector("#salir")?.addEventListener("click", () => void abrirAjedrez(ctx, fin ? "" : `Te rendiste. ${nombre} celebra.`));
    ctx.app.querySelector("#otra")?.addEventListener("click", () => contraVocaloid(r));
  };
  if (lado === "b") turnoBot();
  dibujar();
}

// ───────────────────────── contra un Papu ─────────────────────────

async function contraPapu(id: string): Promise<void> {
  cerrarAjedrez();
  sel = null;
  let v: Vista;
  let leidoAt = Date.now();
  let enviando = false;
  try {
    v = await ctx.api<Vista>(`ajedrez/partida?id=${encodeURIComponent(id)}`);
  } catch (e) {
    return void abrirAjedrez(ctx, (e as Error).message);
  }
  const yo = ctx.yo().id;
  const otro = () => (v.retador.id === yo ? v.rival : v.retador);
  const ultima = (): Tablero["ultima"] => {
    if (!v.jugadas.length) return null;
    const u = v.jugadas[v.jugadas.length - 1]!;
    const sq = (s: string) => (Number(s[1]) - 1) * 8 + "abcdefgh".indexOf(s[0]!);
    return { de: sq(u.slice(0, 2)), a: sq(u.slice(2, 4)) };
  };
  const dibujar = () => {
    if (!ctx.enPantalla()) return;
    const pos = leerFen(v.fen);
    const lado = v.tuColor ?? "w";
    const corre = Date.now() - leidoAt;
    const rel = { ...v.relojes };
    if (v.estado === "jugando") rel[v.turno] = Math.max(0, rel[v.turno] - corre);
    const mio = v.estado === "jugando" && v.turno === lado && !enviando;
    const t: Tablero = { pos, lado, puede: mio, ultima: ultima(), alJugar: (j) => void mover(j) };
    let txt = "";
    if (v.estado === "aceptada") txt = "Neru está cobrando las apuestas…";
    else if (v.estado === "jugando") txt = v.turno === lado ? `Te toca${enJaque(pos) ? " · ¡jaque!" : ""}` : `Le toca a ${otro().nombre}…`;
    else if (v.estado === "terminada") txt = v.ganador === "tablas" ? `Tablas (${MOTIVO[v.motivo ?? ""] ?? ""}).` : `${v.ganador === yo ? "¡Ganaste! 🎉" : `Ganó ${otro().nombre}.`} (${MOTIVO[v.motivo ?? ""] ?? ""})`;
    else txt = MOTIVO[v.motivo ?? ""] ?? v.estado;
    const relojDe = (c: Color, quien: string) => `<div class="ajedrez-reloj${v.estado === "jugando" && v.turno === c ? " corre" : ""}"><span>${ctx.esc(quien)}</span><b>${mmss(rel[c])}</b></div>`;
    const arriba = lado === "w" ? "b" : "w";
    ctx.app.innerHTML = `${ctx.cabeza(`Contra ${otro().nombre}`, v.apuesta ? `Apuesta: ${v.apuesta} Shaulitas cada uno` : "Sin apuesta", COLOR)}
      ${relojDe(arriba, otro().nombre)}
      ${tableroHtml(t)}
      ${relojDe(lado, "Tú")}
      <p class="ajedrez-estado">${ctx.esc(txt)}</p>
      <div class="aj-fila">${v.estado === "jugando" ? `<button class="boton suave" id="rendirse">Rendirse</button>` : `<button class="boton suave" id="salir">Volver</button>`}</div>`;
    ctx.alVolver();
    conectarTablero(t, dibujar);
    ctx.app.querySelector("#salir")?.addEventListener("click", () => void abrirAjedrez(ctx));
    const r = ctx.app.querySelector<HTMLButtonElement>("#rendirse");
    if (r)
      r.onclick = async () => {
        if (r.dataset.seguro !== "1") {
          r.dataset.seguro = "1";
          r.textContent = "¿Seguro? Toca otra vez";
          return;
        }
        v = await ctx.api<Vista>("ajedrez/rendirse", { id }).catch((e) => (ctx.aviso((e as Error).message), v));
        leidoAt = Date.now();
        dibujar();
      };
  };
  const mover = async (j: Jugada) => {
    enviando = true;
    // Se ve la jugada al tiro; si el worker la rechaza, vuelve la posición de antes.
    const antes = v;
    v = { ...v, fen: escribirLocal(aplicar(leerFen(v.fen), j)), jugadas: [...v.jugadas, uci(j)], turno: v.turno === "w" ? "b" : "w" };
    dibujar();
    try {
      v = await ctx.api<Vista>("ajedrez/jugar", { id, jugada: uci(j) });
    } catch (e) {
      v = antes;
      ctx.aviso((e as Error).message);
    }
    leidoAt = Date.now();
    enviando = false;
    dibujar();
  };
  dibujar();
  sondeo = setInterval(async () => {
    if (!ctx.enPantalla()) return cerrarAjedrez();
    if (enviando || document.querySelector(".hoja") || v.estado === "terminada" || v.estado === "cancelada") return;
    const n = await ctx.api<Vista>(`ajedrez/partida?id=${encodeURIComponent(id)}`).catch(() => null);
    if (!n || enviando) return;
    const cambio = n.fen !== v.fen || n.estado !== v.estado;
    v = n;
    leidoAt = Date.now();
    if (cambio) sel = null;
    if (cambio || !sel) dibujar();
  }, 1500);
  // Los relojes bajan entre lectura y lectura.
  reloj = setInterval(() => {
    if (!ctx.enPantalla()) return;
    if (v.estado === "jugando" && sel === null && !document.querySelector(".hoja")) {
      for (const el of ctx.app.querySelectorAll<HTMLElement>(".ajedrez-reloj.corre b")) el.textContent = mmss(Math.max(0, v.relojes[v.turno] - (Date.now() - leidoAt)));
    }
  }, 500);
}

/** FEN para mostrar la jugada antes de que conteste el worker. */
const escribirLocal = (p: Posicion): string => escribirFen(p);
