// Pagina del mundo de los Papus (prototipo de Actividad 3D). Cada Papu mueve su personaje en la plaza; la sala solo
// reenvia poses (cada 200 ms y solo si se movio), chat y aspectos. Los demas se interpolan entre poses.
// Fuera de Discord (wrangler dev con ACTIVIDAD_PRUEBA=1) pide un nombre: abre varias pestanas para probar con varios.
import { DiscordSDK } from "@discord/embedded-app-sdk";
import * as THREE from "three";
import { ASPECTO_INICIAL, ASPECTOS, ENVIO_MS, mencionados, RADIO, TABLON, TIENDAS, validarAspecto, VELOCIDAD, ZONAS, type ZonaId } from "../../src/mundo/juego";
import type { Andar, Aspecto, Aviso, PapuPublico, Pedido, Pose } from "../../src/mundo/tipos";
import { puesto, type Accion, type Resultado, type RuletaEstado, type RuletaGiro } from "../../src/mundo/acciones";
import { Charla } from "./charla";
import { crearPlaza } from "./escena";
import { Personaje } from "./personaje";
import { Vocaloid, vista } from "./vocaloid";
import { htmlRuleta, htmlSobreRueda, RuedaPlaza, type VistaRuleta } from "./ruleta";
import { Ventana } from "./ventana";
import { ZonasVivas, type Respuesta } from "./vivas";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lienzo = $<HTMLCanvasElement>("lienzo");
const capa = $("capa");
const chatInput = $<HTMLInputElement>("chat");
/** Charla con los Vocaloids (los @ de este Papu y sus respuestas), a la izquierda. */
const charla = new Charla($("charla"));
/** Ventana centrada (ruleta; despues tienda, mercado, mochila…). */
const ventana = new Ventana($("ventana"));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function guardado<T>(clave: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(clave) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function guardar(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento (ventana privada): se vuelve a elegir la proxima vez.
  }
}

// ───────────────────────── escena ─────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, powerPreference: "low-power" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const plaza = crearPlaza();
const camara = new THREE.PerspectiveCamera(50, 1, 0.1, 160);
const OFFSET = new THREE.Vector3(0, 8.5, 10.5);

/**
 * Camara: "aerea" (fija mirando al norte, desde arriba) o "suelo" (tercera persona a la altura del Papu, se gira con
 * Q/E o arrastrando). La rueda del raton (o pellizcar) acerca y aleja en las dos; se recuerda en este navegador.
 */
type ModoCamara = "aerea" | "suelo";
const ZOOM = { aerea: { min: 0.45, max: 2, inicial: 1 }, suelo: { min: 2.2, max: 12, inicial: 5 } } as const;
const camaraGuardada = guardado<{ modo?: ModoCamara; aerea?: number; suelo?: number }>("mundo-camara") ?? {};
const cam = {
  modo: (camaraGuardada.modo === "suelo" ? "suelo" : "aerea") as ModoCamara,
  /** Aerea: veces la distancia normal. Suelo: metros detras del Papu. */
  zoom: {
    aerea: limitar(Number(camaraGuardada.aerea) || ZOOM.aerea.inicial, ZOOM.aerea.min, ZOOM.aerea.max),
    suelo: limitar(Number(camaraGuardada.suelo) || ZOOM.suelo.inicial, ZOOM.suelo.min, ZOOM.suelo.max),
  },
  /** Solo en "suelo": hacia donde mira (0 = norte, como la aerea). */
  yaw: 0,
};
function limitar(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function ajustar(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camara.aspect = w / h;
  // En vertical (celular) la camara se aleja un poco para ver a los lados.
  camara.fov = w < h ? 62 : 50;
  camara.updateProjectionMatrix();
}
addEventListener("resize", ajustar);
ajustar();

interface Otro {
  p: Personaje;
  nombre: string;
  objetivo: Pose;
  etiqueta: HTMLElement;
  /** Caja de las burbujas sobre la cabeza (hasta BURBUJAS; la mas vieja arriba y se va primero). */
  burbujas: HTMLElement;
  mensajes: { el: HTMLElement; hasta: number }[];
  desfase: number;
  aspecto: Aspecto;
  perfil?: { nivel: number; prestigio: number };
  sentado: boolean;
  tarjeta: HTMLImageElement;
  tarjetaHasta: number;
}

/** Mensajes a la vez sobre la cabeza de un Papu: con uno mas, se va el mas viejo. */
const BURBUJAS = 3;

let yo: string | null = null;
let mio: Otro | null = null;
const pose: Pose = { x: 0, z: 6, r: 0, a: 0, m: 0 };
const otros = new Map<string, Otro>();
let aspecto: Aspecto = validarAspecto(guardado("mundo-aspecto")) ?? ASPECTO_INICIAL;

// ───────────────────────── Vocaloids de la plaza ─────────────────────────

/** Teto pasea entre la Tienda Shaula y la fuente (prueba de sprites renderizados con el pipeline de Diva-a-Render). */
const FRASES_TETO = ["¡Hola, Papu! 🥖", "¿Ya viste la Tienda Shaula?", "Pásate por el mercado negro… si lo encuentras abierto. 🕶️", "¡Qué buen día para pasear!"];
/** `hasta`: fin de la burbuja actual; `llm`: muestra una respuesta (o "escribiendo"), que no tapan los saludos fijos. */
let teto: { v: Vocaloid; etiqueta: HTMLElement; burbuja: HTMLElement; frase: number; hasta: number; llm: boolean } | null = null;
// Teto atiende un rato frente a la Tienda Shaula y va a la fuente por el camino del comercio.
const frenteTienda = { x: TIENDAS[0]!.x, z: TIENDAS[0]!.z + 3 };
Vocaloid.cargar("tet", [
  { ...frenteTienda, espera: 8, mira: 0 },
  { x: 5, z: -4, espera: 5, mira: 0 },
])
  .then((v) => {
    plaza.escena.add(v.raiz);
    const etiqueta = document.createElement("div");
    etiqueta.className = "etiqueta vocaloid";
    etiqueta.innerHTML = `<div class="burbuja"></div><span class="nombre">Kasane Teto</span>`;
    capa.append(etiqueta);
    teto = { v, etiqueta, burbuja: etiqueta.querySelector(".burbuja")!, frase: 0, hasta: 0, llm: false };
  })
  .catch(() => {
    // Sin la hoja de sprites (npm run mundo:sprites) la plaza funciona igual, sin Teto.
  });

/** Lo que dice Teto al @ de un Papu (lo responde el bot como en Discord, con la cuota del dia). */
function decirTeto(tipo: "texto" | "escribiendo" | "reaccion", texto: string): void {
  if (!teto) return;
  const t = tipo === "escribiendo" ? "✍️ …" : texto;
  teto.burbuja.textContent = t;
  teto.burbuja.classList.add("ver");
  teto.burbuja.classList.toggle("larga", tipo === "texto");
  teto.llm = true;
  teto.hasta = performance.now() + (tipo === "escribiendo" ? 30_000 : tipo === "reaccion" ? 3000 : Math.min(25_000, 6000 + t.length * 70));
}

/** Ya se le aviso al entrar que tenia tiradas (una vez por visita). */
let avisoTiradas = false;
function stats(m: Extract<Aviso, { t: "stats" }>): void {
  const nivel = `⭐ Nv. ${m.nivel}${m.prestigio ? ` · ✦${m.prestigio}` : ""}`;
  const cuota = m.restante === null ? "💬 sin límite" : `💬 ${m.restante}/${m.limite} hoy`;
  const e = $("stats");
  e.textContent = `${nivel} · ${cuota}${m.ruletas ? ` · 🎰 ${m.ruletas}` : ""}`;
  e.title = `Mensajes con los Vocaloids que te quedan hoy (los mismos que en Discord). Escribe @Teto para hablarle.${m.ruletas ? ` Tiradas de la ruleta: ${m.ruletas} (/ruleta).` : ""}`;
  e.hidden = false;
  if (m.ruletas > 0 && !avisoTiradas) {
    avisoTiradas = true;
    aviso(`🎰 Tienes ${m.ruletas} ${m.ruletas === 1 ? "tirada" : "tiradas"} en la ruleta grande: escribe /ruleta.`);
  }
}

/** Recibe solo nivel y prestigio: la cuota y las tiradas nunca se comparten con otros Papus. */
function perfil(m: Extract<Aviso, { t: "perfil" }>): void {
  const o = m.id === yo ? mio : otros.get(m.id);
  if (!o) return;
  o.perfil = { nivel: m.nivel, prestigio: m.prestigio };
}

/** Ficha pública al pulsar el nombre o el personaje. */
function abrirPerfil(o: Otro): void {
  solicitarTarjeta(o, "ventana");
}

const TARJETA_FRESCA_MS = 60_000;
const TARJETA_MAX_STALE_MS = 5 * 60_000;
const TARJETA_CACHE_MAX = 12;
interface TarjetaCache { src: string; at: number }
const cacheTarjetas = new Map<string, TarjetaCache>();

function guardarTarjetaCache(id: string, mime: string, datos: string): TarjetaCache {
  const entry = { src: `data:${mime};base64,${datos}`, at: Date.now() };
  cacheTarjetas.delete(id);
  cacheTarjetas.set(id, entry);
  while (cacheTarjetas.size > TARJETA_CACHE_MAX) cacheTarjetas.delete(cacheTarjetas.keys().next().value!);
  return entry;
}

function mostrarTarjetaCabeza(o: Otro, src: string): void {
  o.tarjeta.src = src;
  o.tarjeta.hidden = false;
  o.tarjeta.classList.remove("mostrar");
  void o.tarjeta.offsetWidth;
  o.tarjeta.classList.add("mostrar");
  o.tarjetaHasta = performance.now() + 3000;
}

function mostrarTarjetaVentana(o: Otro, id: string, src: string): void {
  const html = `<img class="tarjeta-completa" src="${src}" alt="Tarjeta de nivel de ${esc(o.nombre)}"><p class="v-pie">Tarjeta pública generada con el mismo diseño de /nivel. La cuota y las tiradas privadas no se incluyen.</p>`;
  if (ventana.id === `perfil:${id}`) ventana.poner(`perfil:${id}`, html);
  else ventana.abrir(`perfil:${id}`, `⭐ ${esc(o.nombre)}`, html);
}

/** Caché de sesión: muestra al instante y revalida en segundo plano; P también publica la tarjeta en la sala. */
function solicitarTarjeta(o: Otro, modo: "ventana" | "cabeza", compartir = false): void {
  const id = o === mio ? yo : [...otros].find(([, v]) => v === o)?.[0];
  if (!id) return;
  const cache = cacheTarjetas.get(id);
  const edad = cache ? Date.now() - cache.at : Infinity;
  const util = cache && edad <= TARJETA_MAX_STALE_MS ? cache : null;
  if (util) {
    cacheTarjetas.delete(id);
    cacheTarjetas.set(id, util);
    if (modo === "cabeza") mostrarTarjetaCabeza(o, util.src);
    else mostrarTarjetaVentana(o, id, util.src);
    if (edad <= TARJETA_FRESCA_MS && !compartir) return;
  } else if (modo === "ventana") {
    ventana.abrir(`perfil:${id}`, `⭐ ${esc(o.nombre)}`, `<p class="tarjeta-cargando">Preparando la tarjeta original de /nivel…</p><p class="v-nota">La imagen no incluye tu cuota ni tus tiradas privadas.</p>`);
  }
  if ([...tarjetasEsperando.values()].some((p) => p.o === o && p.modo === modo)) return;
  const ref = ++refs;
  tarjetasEsperando.set(ref, { o, modo });
  enviar({ t: "tarjeta", papu: id, ref, compartir });
  window.setTimeout(() => {
    if (!tarjetasEsperando.delete(ref)) return;
    if (modo === "ventana" && ventana.id === `perfil:${id}` && !util) ventana.poner(`perfil:${id}`, `<p class="tarjeta-cargando">El puente del preview aún no ha respondido. Inténtalo de nuevo en un momento.</p>`);
    else if (!util) aviso("La tarjeta no llegó a tiempo. Inténtalo otra vez.");
  }, 25_000);
}

/** Ficha de cada zona al acercarse (en el decorado todavia no hacen nada). */
const FICHAS: Record<ZonaId, string> = {
  tablon: "📌 <b>Tablón</b><br>Próximamente: votaciones, noticias, tips, estrenos y el buzón de pedidos de video.",
  arena: "⚔️ <b>Arena del 1vs1</b><br>Próximamente: aquí pelean los luchadores y se apuesta con monedas ganadas.",
  comercio: "🛍️ <b>Calle del comercio</b><br>La Tienda Shaula y el mercado negro de Neru.",
  tienda: "🛍️ <b>Tienda Shaula</b><br>Consulta la vitrina de hoy y compra objetos para tu colección.",
  mercado: "🕶️ <b>Mercado negro</b><br>Consulta los consumibles y adornos que Neru tiene en su vitrina diaria.",
  ruleta: "🎰 <b>Ruleta grande</b><br>Gírala con las tiradas de tus misiones del día (las mismas que en Discord).",
  escuela: "🏫 <b>Escuela de la trivia</b><br>Abre una partida multijugador con los Papus que entren a la misma sala.",
  estanque: "🎣 <b>Estanque</b><br>Lanza la caña, pesca un pez y gana XP según su tamaño: 5%, 10% o 20% de tu barra.",
  fogata: "🔥 <b>Fogata</b><br>Descansa junto al fuego y comparte el momento con los demás Papus.",
  altar: "💍 <b>Altar de bodas</b><br>Próximamente: aquí queda la boda más reciente.",
  fama: "🏆 <b>Salón de la fama</b><br>Próximamente: los Papus de más nivel y los récords.",
  sorteo: "🎁 <b>Sorteo de GyroP</b><br>Próximamente: la cuenta regresiva del sorteo y cómo entrar.",
};
/** Lugares que se pueden usar desde su ficha (boton o tecla F). */
const USAR: Partial<Record<ZonaId, { texto: string; abrir: () => void }>> = {
  ruleta: { texto: "🎰 Abrir la ruleta", abrir: () => abrirRuleta() },
  estanque: { texto: "🎣 Pescar", abrir: () => abrirPesca() },
  tienda: { texto: "🛍️ Abrir Tienda Shaula", abrir: () => abrirCatalogo("tienda") },
  mercado: { texto: "🕶️ Ver mercado negro", abrir: () => abrirCatalogo("mercado") },
  fogata: { texto: "🔥 Sentarse", abrir: () => alternarFogata() },
  escuela: {
    texto: "🧠 Jugar trivia multijugador",
    abrir: () => {
      const w = window.open("/actividad/?sala=plaza", "_blank");
      if (!w) aviso("Tu navegador bloqueó la nueva pestaña. Permite ventanas emergentes para abrir la trivia.");
      else w.opener = null;
    },
  },
};
/** Hacia donde mira la camara aerea cerca de algo alto (a medio camino con el Papu): la rueda de la ruleta. */
const FOCO: Partial<Record<ZonaId, { x: number; y: number; z: number }>> = {
  ruleta: { x: ZONAS.find((z) => z.id === "ruleta")!.x, y: 3, z: 1 },
};
/** Lugares con ficha: las tiendas y el tablon (de cerca) y cada zona (radio mas grande). */
const LUGARES: { id: ZonaId; x: number; z: number; radio: number }[] = [
  ...TIENDAS.map((t) => ({ id: t.id, x: t.x, z: t.z, radio: 4 })),
  { id: "tablon", x: TABLON.x, z: TABLON.z, radio: 3.5 },
  ...ZONAS.filter((z) => z.id !== "comercio").map((z) => ({ id: z.id, x: z.x, z: z.z, radio: z.id === "arena" ? 11 : 8 })),
];

function crearOtro(papu: PapuPublico): Otro {
  const p = new Personaje(papu.aspecto);
  p.raiz.position.set(papu.x, 0, papu.z);
  p.raiz.rotation.y = papu.r;
  plaza.escena.add(p.raiz);
  const etiqueta = document.createElement("div");
  etiqueta.className = "etiqueta papu";
  etiqueta.tabIndex = 0;
  etiqueta.setAttribute("role", "button");
  etiqueta.setAttribute("aria-label", `Ver perfil de ${papu.nombre}`);
  etiqueta.innerHTML = `<div class="burbujas"></div><span class="nombre">${esc(papu.nombre)}</span>`;
  const tarjeta = document.createElement("img");
  tarjeta.className = "tarjeta-cabeza";
  tarjeta.alt = `Tarjeta de nivel de ${papu.nombre}`;
  tarjeta.hidden = true;
  etiqueta.prepend(tarjeta);
  const otro: Otro = { p, nombre: papu.nombre, objetivo: { ...papu }, etiqueta, burbujas: etiqueta.querySelector(".burbujas")!, mensajes: [], desfase: Math.random(), aspecto: papu.aspecto, sentado: false, tarjeta, tarjetaHasta: 0 };
  etiqueta.addEventListener("click", () => abrirPerfil(otro));
  etiqueta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirPerfil(otro); }
  });
  capa.append(etiqueta);
  return otro;
}

function quitar(id: string): void {
  const o = otros.get(id);
  if (!o) return;
  plaza.escena.remove(o.p.raiz);
  o.etiqueta.remove();
  otros.delete(id);
  contar();
}

function contar(): void {
  $("contador").textContent = `🌳 Plaza de los Papus · ${otros.size + (mio ? 1 : 0)} ${otros.size + (mio ? 1 : 0) === 1 ? "Papu" : "Papus"}`;
}

// ───────────────────────── red ─────────────────────────

let ws: WebSocket | null = null;
function enviar(p: Pedido): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(p));
}

/** Acciones pedidas al bot que esperan su resultado (por `ref`). */
let refs = 0;
const esperando = new Map<number, (r: Resultado) => void>();
const tarjetasEsperando = new Map<number, { o: Otro; modo: "ventana" | "cabeza" }>();
/** Le pide al bot algo de un comando (con las reglas de Discord) y espera el resultado. */
function pedir(accion: Accion, datos?: unknown): Promise<Resultado> {
  return new Promise((listo) => {
    if (ws?.readyState !== WebSocket.OPEN) return listo({ ok: false, motivo: "Sin conexión con la plaza. Espera un momento." });
    const ref = ++refs;
    esperando.set(ref, listo);
    enviar({ t: "accion", accion, datos, ref });
    setTimeout(() => {
      if (esperando.delete(ref)) listo({ ok: false, motivo: "El servidor no respondió (¿está apagado el bot?). Inténtalo en un rato." });
    }, 65_000);
  });
}

function aviso(texto: string): void {
  const a = $("aviso");
  a.textContent = texto;
  a.classList.add("ver");
  clearTimeout((aviso as unknown as { t?: number }).t);
  (aviso as unknown as { t?: number }).t = window.setTimeout(() => a.classList.remove("ver"), 4500);
}

function error(texto: string): void {
  $("error").innerHTML = `<p>${esc(texto)}</p>`;
  $("error").hidden = false;
}

function decir(o: Otro, texto: string): void {
  const el = document.createElement("div");
  el.className = "burbuja ver";
  el.textContent = texto;
  o.burbujas.append(el);
  o.mensajes.push({ el, hasta: performance.now() + Math.min(12_000, 5000 + texto.length * 60) });
  // FIFO: con mas de BURBUJAS, la mas vieja se va antes de tiempo.
  while (o.mensajes.length > BURBUJAS) o.mensajes.shift()!.el.remove();
}

/** Todos (navegador y Actividad, desde cualquier canal) comparten una sola plaza (decision de GyroP, 9 nov. 2026). */
const PLAZA = "plaza";
/** Entro por el navegador: si su sesion de Discord vencio, vuelve a la pantalla de entrada. */
let modoWeb = false;

/** Pantalla de entrada del navegador: "Entrar con Discord" (o aviso si el mundo aun no esta abierto). */
function entrada(disponible: boolean): void {
  const e = $("entrada");
  if (!disponible) e.querySelector<HTMLElement>(".texto")!.textContent = "El mundo aún no está abierto. Vuelve pronto, Papu. 🌳";
  e.querySelector<HTMLElement>("#btn-entrar")!.hidden = !disponible;
  e.hidden = false;
}

function recibirTarjeta(m: Extract<Aviso, { t: "tarjeta" }>): void {
  const pendiente = tarjetasEsperando.get(m.ref);
  if (!pendiente) return;
  tarjetasEsperando.delete(m.ref);
  if (m.estado !== "lista" || !m.datos) {
    if (pendiente.modo === "ventana" && ventana.id === `perfil:${m.papu}`) ventana.poner(`perfil:${m.papu}`, `<p class="tarjeta-cargando">${esc(m.motivo ?? "No pude cargar la tarjeta.")}</p>`);
    else if (!cacheTarjetas.has(m.papu)) aviso(m.motivo ?? "No pude cargar tu tarjeta.");
    return;
  }
  const cache = guardarTarjetaCache(m.papu, m.mime ?? "image/png", m.datos);
  if (pendiente.modo === "cabeza") mostrarTarjetaCabeza(pendiente.o, cache.src);
  else if (ventana.id === `perfil:${m.papu}`) mostrarTarjetaVentana(pendiente.o, m.papu, cache.src);
}

function recibirTarjetaCompartida(m: Extract<Aviso, { t: "tarjeta-compartida" }>): void {
  const cache = guardarTarjetaCache(m.papu, m.mime, m.datos);
  if (m.papu === yo) tarjetasEsperando.delete(m.ref);
  const o = m.papu === yo ? mio : otros.get(m.papu);
  if (o) mostrarTarjetaCabeza(o, cache.src);
}

function alternarFogata(): void {
  if (!mio) return;
  enviar({ t: "sentarse", sentado: !mio.sentado });
}

function recibir(m: Aviso): void {
  if (m.t === "error" && modoWeb && m.texto.startsWith("No pude comprobar")) return entrada(true);
  if (m.t === "error") return error(m.texto);
  if (m.t === "aviso") return aviso(m.texto);
  if (m.t === "bienvenida") {
    // Tambien al reconectar: se vuelve a armar la plaza desde cero.
    for (const id of [...otros.keys()]) quitar(id);
    yo = m.yo;
    for (const papu of m.papus) {
      if (papu.id === yo) {
        Object.assign(pose, { x: papu.x, z: papu.z, r: papu.r, a: 0, m: 0 });
        if (mio) {
          plaza.escena.remove(mio.p.raiz);
          mio.etiqueta.remove();
        }
        mio = crearOtro({ ...papu, aspecto });
        mio.etiqueta.classList.add("propia");
      } else otros.set(papu.id, crearOtro(papu));
    }
    if (JSON.stringify(aspecto) !== JSON.stringify(m.papus.find((p) => p.id === yo)?.aspecto)) enviar({ t: "aspecto", aspecto });
    return contar();
  }
  if (m.t === "entra") {
    if (m.papu.id === yo) return;
    quitar(m.papu.id);
    otros.set(m.papu.id, crearOtro(m.papu));
    return contar();
  }
  if (m.t === "sale") return quitar(m.id);
  if (m.t === "stats") return stats(m);
  if (m.t === "fogata") {
    const o = m.id === yo ? mio : otros.get(m.id);
    if (!o) return;
    o.sentado = m.sentado;
    decir(o, m.sentado ? "🔥 Se sentó junto a la fogata" : "Se levantó de la fogata");
    return;
  }
  if (m.t === "perfil") return perfil(m);
  if (m.t === "tarjeta") return recibirTarjeta(m);
  if (m.t === "tarjeta-compartida") return recibirTarjetaCompartida(m);
  if (m.t === "accion") {
    esperando.get(m.ref)?.(m.resultado);
    esperando.delete(m.ref);
    return;
  }
  if (m.t === "ruleta") return colaRuleta(m);
  if (m.t === "vocaloid") {
    if (m.papu === yo) charla.vocaloid(m.bot, m.tipo, m.texto);
    if (m.tipo === "aviso") return aviso(m.texto);
    if (m.bot === "teto") decirTeto(m.tipo, m.texto);
    return;
  }
  if (m.t === "corrige") {
    Object.assign(pose, { x: m.x, z: m.z, r: m.r, m: m.m });
    return;
  }
  const o = m.id === yo ? mio : otros.get(m.id);
  if (!o) return;
  if (m.t === "mov") {
    o.objetivo = { x: m.x, z: m.z, r: m.r, a: m.a, m: m.m };
    // Salto (/ruleta…): aparece alla, sin deslizarse por todo el mapa.
    if (m.s) o.p.raiz.position.set(m.x, 0, m.z);
  }
  else if (m.t === "chat") {
    decir(o, m.texto);
    // Lo que este Papu le dijo a un Vocaloid queda tambien en su ventana de charla (ya publicado: Neru no lo quito).
    if (m.id === yo && mencionados(m.texto).length) charla.papu(o.nombre, m.texto);
  }
  else if (m.t === "aspecto" && m.id !== yo) { o.p.vestir(m.aspecto); o.aspecto = m.aspecto; }
}

async function iniciar(): Promise<void> {
  const cfg = (await fetch("api/config").then((r) => r.json())) as { clientId: string | null; prueba: boolean };
  const params = new URLSearchParams(location.search);
  let hola: Pedido;
  let instancia: string;
  if (params.has("frame_id")) {
    if (!cfg.clientId) return error("La Actividad aún no está configurada.");
    const sdk = new DiscordSDK(cfg.clientId);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({ client_id: cfg.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds.members.read"] });
    const tok = (await fetch("api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).then((r) => r.json())) as { access_token?: string; error?: string };
    if (!tok.access_token) return error(tok.error ?? "Discord no me dejó entrar.");
    await sdk.commands.authenticate({ access_token: tok.access_token });
    hola = { t: "hola", token: tok.access_token, aspecto };
    instancia = PLAZA;
  } else if (!cfg.prueba || params.has("web")) {
    // Navegador: "Entrar con Discord". El token queda en una cookie que la pagina no ve; la sala lo lee al conectar.
    modoWeb = true;
    const ses = (await fetch("api/sesion").then((r) => r.json())) as { conectado: boolean; entrar: boolean };
    if (!ses.conectado) return entrada(ses.entrar);
    hola = { t: "hola", aspecto };
    instancia = PLAZA;
  } else {
    // ?nombre=Ana se salta la pregunta (para abrir varias pestanas rapido).
    const nombre = params.get("nombre") || prompt("Modo de prueba: ¿tu nombre?") || "Papu";
    hola = { t: "hola", prueba: { id: `prueba-${nombre.replace(/\W/g, "").slice(0, 12) || "papu"}`, nombre }, aspecto };
    instancia = params.get("sala") ?? "prueba";
    // Solo en modo de prueba (wrangler dev): posiciones para revisar la plaza con scripts.
    (window as unknown as { mundoPrueba: unknown }).mundoPrueba = {
      pose,
      teto: () => teto?.v.raiz.position.toArray() ?? null,
      /** Camara libre para revisar el decorado: mirar (x, z) desde `alto` veces la distancia normal; null = seguir al Papu. */
      vista: (v: { x: number; z: number; alto?: number } | null) => (vistaPrueba = v),
    };
  }
  conectar(instancia, hola, 0);
}

function conectar(instancia: string, hola: Pedido, intento: number): void {
  const estado = $("contador");
  estado.textContent = `🌳 Plaza de los Papus · ${intento ? `reconectando (${intento}/6)…` : "conectando…"}`;
  const url = new URL(`api/sala?instancia=${encodeURIComponent(instancia)}`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(url);
  let cerradoPorError = false;
  ws.onopen = () => {
    estado.textContent = "🌳 Plaza de los Papus · verificando acceso…";
    ws!.send(JSON.stringify({ ...hola, aspecto }));
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as Aviso;
    // Solo reinicia el contador cuando la sala confirma que ya nos identificó.
    if (m.t === "bienvenida") intento = 0;
    if (m.t === "error") cerradoPorError = true;
    recibir(m);
  };
  ws.onclose = () => {
    if (cerradoPorError) return;
    if (intento > 5) {
      estado.textContent = "🌳 Plaza de los Papus · sin conexión";
      return error("Se cortó la conexión con la plaza. Cierra y vuelve a abrir la Actividad.");
    }
    estado.textContent = `🌳 Plaza de los Papus · conexión perdida, reconectando (${intento + 1}/6)…`;
    setTimeout(() => conectar(instancia, hola, intento + 1), 800 * (intento + 1));
  };
}

// ───────────────────────── controles ─────────────────────────

const teclas = new Set<string>();
addEventListener("keydown", (e) => {
  if (document.activeElement === chatInput) {
    if (e.key === "Escape") cerrarChat();
    return;
  }
  if (ventana.abierta) {
    if (e.key === "Escape") ventana.cerrar();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    abrirChat();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "m" && !e.repeat) alternarMontura();
  if (k === "p" && !e.repeat && mio) solicitarTarjeta(mio, "cabeza", true);
  if (k === "v" && !e.repeat) alternarCamara();
  if (k === "f" && !e.repeat && cercaDe) USAR[cercaDe]?.abrir();
  teclas.add(k);
});
addEventListener("keyup", (e) => teclas.delete(e.key.toLowerCase()));
addEventListener("blur", () => teclas.clear());

// Chat: Enter abre la caja, Enter envia y la cierra (para otro mensaje, Enter de nuevo). Esc o tocar fuera la cierra.
const formChat = $("form-chat");
function abrirChat(): void {
  formChat.hidden = false;
  $("btn-hablar").hidden = true;
  teclas.clear();
  chatInput.focus();
}
function cerrarChat(): void {
  formChat.hidden = true;
  $("btn-hablar").hidden = false;
  if (document.activeElement === chatInput) chatInput.blur();
}
formChat.addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = chatInput.value.trim();
  // "/ruleta"…: comandos como en Discord (no se publican en el chat).
  if (texto.startsWith("/")) comando(texto);
  else if (texto) enviar({ t: "chat", texto });
  chatInput.value = "";
  cerrarChat();
});
chatInput.addEventListener("blur", () => {
  if (!formChat.hidden) cerrarChat();
});
// El boton de enviar no le quita el foco a la caja (si no, se cerraria antes del clic).
formChat.querySelector("button")!.addEventListener("pointerdown", (e) => e.preventDefault());
$("btn-hablar").addEventListener("click", abrirChat);

// ───────────────────────── camara ─────────────────────────

function guardarCamara(): void {
  guardar("mundo-camara", { modo: cam.modo, aerea: cam.zoom.aerea, suelo: cam.zoom.suelo });
}
function alternarCamara(): void {
  cam.modo = cam.modo === "aerea" ? "suelo" : "aerea";
  // Al bajar al suelo, la camara queda detras del Papu, mirando hacia donde mira el.
  if (cam.modo === "suelo") cam.yaw = (mio?.p.raiz.rotation.y ?? pose.r) + Math.PI;
  $("btn-camara").classList.toggle("activo", cam.modo === "suelo");
  guardarCamara();
}
$("btn-camara").addEventListener("click", alternarCamara);
$("btn-camara").classList.toggle("activo", cam.modo === "suelo");

function acercar(factor: number): void {
  const z = ZOOM[cam.modo];
  cam.zoom[cam.modo] = limitar(cam.zoom[cam.modo] * factor, z.min, z.max);
  guardarCamara();
}
lienzo.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    // Rueda hacia abajo = alejar. deltaY ~100 por "clic" de la rueda; el touchpad manda pasos chicos.
    acercar(Math.exp(limitar(e.deltaY, -200, 200) * 0.0015));
  },
  { passive: false },
);

// Girar la camara en tercera persona: arrastrar con el raton (o con un segundo dedo en celular).
const giro = { id: -1, x: 0 };
lienzo.addEventListener("pointerdown", (e) => {
  if (cam.modo !== "suelo") return;
  if (e.pointerType === "mouse" ? e.button !== 0 : !joy.activo && e.clientX < innerWidth / 2) return;
  giro.id = e.pointerId;
  giro.x = e.clientX;
});
addEventListener("pointermove", (e) => {
  if (e.pointerId !== giro.id) return;
  cam.yaw -= (e.clientX - giro.x) * 0.006;
  giro.x = e.clientX;
});
const soltarGiro = (e: PointerEvent) => {
  if (e.pointerId === giro.id) giro.id = -1;
};
addEventListener("pointerup", soltarGiro);
addEventListener("pointercancel", soltarGiro);
// Pellizcar con dos dedos: acercar y alejar.
const dedos = new Map<number, { x: number; y: number }>();
let pellizco = 0;
lienzo.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pellizco = 0;
});
addEventListener("pointermove", (e) => {
  if (!dedos.has(e.pointerId)) return;
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (dedos.size !== 2) return;
  const [a, b] = [...dedos.values()];
  const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
  if (pellizco) acercar(pellizco / d);
  pellizco = d;
});
const soltarDedo = (e: PointerEvent) => {
  dedos.delete(e.pointerId);
  pellizco = 0;
};
addEventListener("pointerup", soltarDedo);
addEventListener("pointercancel", soltarDedo);

function alternarMontura(): void {
  pose.m = pose.m ? 0 : 1;
  $("btn-montura").classList.toggle("activo", !!pose.m);
}
$("btn-montura").addEventListener("click", alternarMontura);
$("btn-tarjeta").addEventListener("click", () => { if (mio) solicitarTarjeta(mio, "cabeza", true); });

// Joystick tactil: se arrastra desde cualquier punto del lienzo; lejos del centro = correr.
const joy = { activo: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
const palanca = $("palanca");
lienzo.addEventListener("pointerdown", (e) => {
  // El segundo dedo (o el lado derecho en tercera persona) gira la camara, no mueve.
  if (e.pointerType === "mouse" || joy.activo || e.pointerId === giro.id) return;
  joy.activo = true;
  joy.id = e.pointerId;
  joy.ox = e.clientX;
  joy.oy = e.clientY;
  joy.dx = joy.dy = 0;
  palanca.style.left = `${e.clientX}px`;
  palanca.style.top = `${e.clientY}px`;
  palanca.hidden = false;
  chatInput.blur();
});
addEventListener("pointermove", (e) => {
  if (!joy.activo || e.pointerId !== joy.id) return;
  const max = 60;
  let dx = e.clientX - joy.ox;
  let dy = e.clientY - joy.oy;
  const d = Math.hypot(dx, dy);
  if (d > max) {
    dx = (dx / d) * max;
    dy = (dy / d) * max;
  }
  joy.dx = dx / max;
  joy.dy = dy / max;
  (palanca.firstElementChild as HTMLElement).style.transform = `translate(${dx}px, ${dy}px)`;
});
const soltar = (e: PointerEvent) => {
  if (e.pointerId !== joy.id) return;
  joy.activo = false;
  joy.dx = joy.dy = 0;
  palanca.hidden = true;
};
addEventListener("pointerup", soltar);
addEventListener("pointercancel", soltar);

// ───────────────────────── personalizar ─────────────────────────

function panelAspecto(): void {
  const fila = (clave: "ropa" | "piel", titulo: string) =>
    `<p>${titulo}</p><div class="muestras">${ASPECTOS[clave].map((c, i) => `<button data-k="${clave}" data-i="${i}" class="muestra${aspecto[clave] === i ? " sel" : ""}" style="background:${c}" aria-label="${titulo} ${i + 1}"></button>`).join("")}</div>`;
  const nombres: Record<string, string> = { nada: "🚫", fiesta: "🎉", copa: "🎩", gato: "🐱", puerro: "🥬" };
  $("panel").innerHTML = `${fila("ropa", "Ropa")}${fila("piel", "Piel")}<p>Sombrero</p><div class="muestras">${ASPECTOS.sombrero
    .map((s, i) => `<button data-k="sombrero" data-i="${i}" class="muestra emoji${aspecto.sombrero === i ? " sel" : ""}" aria-label="${s}">${nombres[s] ?? s}</button>`)
    .join("")}</div>`;
}
$("panel").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-k]");
  if (!b) return;
  aspecto = { ...aspecto, [b.dataset.k!]: Number(b.dataset.i) };
  guardar("mundo-aspecto", aspecto);
  mio?.p.vestir(aspecto);
  if (mio) mio.aspecto = aspecto;
  enviar({ t: "aspecto", aspecto });
  panelAspecto();
});
$("btn-aspecto").addEventListener("click", () => {
  const p = $("panel");
  p.hidden = !p.hidden;
  if (!p.hidden) panelAspecto();
});

// ───────────────────────── bucle ─────────────────────────

const reloj = new THREE.Clock();
let ultimoEnvio = 0;
/** Solo en el modo de prueba: camara libre (mundoPrueba.vista). */
let vistaPrueba: { x: number; z: number; alto?: number } | null = null;
let enviada: Pose = { ...pose };
const tmp = new THREE.Vector3();

function mover(dt: number): void {
  let dx = 0;
  let dz = 0;
  if (teclas.has("w") || teclas.has("arrowup")) dz -= 1;
  if (teclas.has("s") || teclas.has("arrowdown")) dz += 1;
  if (teclas.has("a") || teclas.has("arrowleft")) dx -= 1;
  if (teclas.has("d") || teclas.has("arrowright")) dx += 1;
  let fuerza = Math.min(1, Math.hypot(dx, dz));
  let corre = teclas.has("shift");
  if (joy.activo && Math.hypot(joy.dx, joy.dy) > 0.15) {
    dx = joy.dx;
    dz = joy.dy;
    fuerza = Math.min(1, Math.hypot(dx, dz));
    corre = fuerza > 0.85;
  }
  if (fuerza === 0) {
    pose.a = 0;
    return;
  }
  // En tercera persona "adelante" es hacia donde mira la camara (en la aerea, yaw 0 = el norte, igual que antes).
  if (cam.modo === "suelo") {
    const c = Math.cos(cam.yaw);
    const s = Math.sin(cam.yaw);
    [dx, dz] = [dx * c + dz * s, -dx * s + dz * c];
  }
  const largo = Math.hypot(dx, dz);
  const v = pose.m ? VELOCIDAD.montura : corre ? VELOCIDAD.corre : VELOCIDAD.camina;
  let x = pose.x + (dx / largo) * v * fuerza * dt;
  let z = pose.z + (dz / largo) * v * fuerza * dt;
  // Choques: se empuja hacia afuera de cada circulo y se queda dentro de la plaza.
  for (const c of plaza.choques) {
    const d = Math.hypot(x - c.x, z - c.z);
    const min = c.r + 0.35;
    if (d < min && d > 0) {
      x = c.x + ((x - c.x) / d) * min;
      z = c.z + ((z - c.z) / d) * min;
    }
  }
  const dc = Math.hypot(x, z);
  if (dc > RADIO) {
    x = (x / dc) * RADIO;
    z = (z / dc) * RADIO;
  }
  pose.x = x;
  pose.z = z;
  pose.r = Math.atan2(dx, dz);
  pose.a = pose.m ? 1 : corre ? 2 : 1;
}

/** Angulo de `a` hacia `b` por el camino corto. */
function girar(a: number, b: number, k: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function cuadro(): void {
  const dt = Math.min(reloj.getDelta(), 0.1);
  const t = reloj.elapsedTime;
  const ahora = performance.now();
  if (mio && !mio.sentado && document.activeElement !== chatInput && !ventana.abierta) mover(dt);
  else pose.a = 0;

  if (mio) {
    mio.p.raiz.position.set(pose.x, 0, pose.z);
    mio.p.raiz.rotation.y = girar(mio.p.raiz.rotation.y, pose.r, Math.min(1, dt * 14));
    mio.p.animar(t, pose.a as Andar, !!pose.m, mio.desfase);
    mio.p.raiz.scale.y = mio.sentado ? 0.72 : 1;
    // Manda la pose cada 200 ms, solo si cambio (quieto no gasta nada).
    const cambio = Math.hypot(pose.x - enviada.x, pose.z - enviada.z) > 0.05 || Math.abs(pose.r - enviada.r) > 0.05 || pose.a !== enviada.a || pose.m !== enviada.m;
    if (cambio && ahora - ultimoEnvio >= ENVIO_MS) {
      enviar({ t: "mov", ...pose });
      enviada = { ...pose };
      ultimoEnvio = ahora;
    }
    if (vistaPrueba) {
      const k = vistaPrueba.alto ?? 1;
      camara.position.set(vistaPrueba.x + OFFSET.x * k, OFFSET.y * k, vistaPrueba.z + OFFSET.z * k);
      camara.lookAt(vistaPrueba.x, 1, vistaPrueba.z);
    } else if (cam.modo === "aerea") {
      const k = cam.zoom.aerea;
      // Cerca de algo alto (la ruleta grande), la camara mira a medio camino entre el Papu y eso, un poco mas arriba,
      // para que se vea entero.
      const foco = cercaDe ? FOCO[cercaDe] : undefined;
      const mx = foco ? (pose.x + foco.x) / 2 : pose.x;
      const mz = foco ? (pose.z + foco.z) / 2 : pose.z;
      const my = foco ? foco.y : 1;
      tmp.set(mx + OFFSET.x * k, my - 1 + OFFSET.y * k, mz + OFFSET.z * k);
      camara.position.lerp(tmp, Math.min(1, dt * 6));
      camara.lookAt(camara.position.x - OFFSET.x * k, camara.position.y - OFFSET.y * k + 1, camara.position.z - OFFSET.z * k);
      vista.yaw = 0;
      vista.inclinacion = Math.atan2(OFFSET.y * k - 1, OFFSET.z * k);
    } else {
      // Tercera persona a nivel del suelo: detras del Papu, un poco sobre su cabeza, mirando hacia adelante.
      if (teclas.has("q")) cam.yaw += dt * 2;
      if (teclas.has("e")) cam.yaw -= dt * 2;
      const d = cam.zoom.suelo;
      const alto = 1.7 + d * 0.22;
      tmp.set(pose.x + Math.sin(cam.yaw) * d, alto, pose.z + Math.cos(cam.yaw) * d);
      camara.position.lerp(tmp, Math.min(1, dt * 8));
      camara.lookAt(pose.x, 1.5, pose.z);
      vista.yaw = cam.yaw;
      vista.inclinacion = Math.atan2(alto - 1.5, d);
    }
    // Cartel del stand mas cercano.
    // Ficha del lugar mas cercano (las tiendas y el tablon antes que la zona que los contiene).
    const cerca = LUGARES.find((l) => Math.hypot(l.x - pose.x, l.z - pose.z) < l.radio);
    cercaDe = cerca?.id ?? null;
    const c = $("stand");
    if (cerca) {
      // La ficha de la foto del servidor (quien pelea, si el mercado esta abierto…) gana a la fija.
      const usar = USAR[cerca.id];
      const textoUsar = cerca.id === "fogata" && mio?.sentado ? "🔥 Levantarse" : usar?.texto;
      const html = (vivas.fichas[cerca.id] ?? FICHAS[cerca.id]) + (usar ? `<button class="usar" type="button" data-usar="${cerca.id}">${textoUsar} <kbd>F</kbd></button>` : "");
      if (c.dataset.html !== html) c.innerHTML = html;
      c.dataset.html = html;
      c.dataset.id = cerca.id;
      c.hidden = false;
    } else {
      c.hidden = true;
      c.dataset.id = "";
      c.dataset.html = "";
    }
  }

  for (const o of otros.values()) {
    const r = o.p.raiz;
    const k = Math.min(1, dt * 10);
    r.position.x += (o.objetivo.x - r.position.x) * k;
    r.position.z += (o.objetivo.z - r.position.z) * k;
    r.rotation.y = girar(r.rotation.y, o.objetivo.r, k);
    o.p.animar(t, o.objetivo.a, !!o.objetivo.m, o.desfase);
    o.p.raiz.scale.y = o.sentado ? 0.72 : 1;
  }

  if (teto) {
    teto.v.actualizar(Date.now());
    // Saluda con frases fijas (nunca el LLM) cuando un Papu se acerca.
    const cerca = mio && Math.hypot(teto.v.raiz.position.x - pose.x, teto.v.raiz.position.z - pose.z) < 3.5;
    if (teto.llm) {
      if (ahora > teto.hasta) {
        teto.llm = false;
        teto.burbuja.classList.remove("ver", "larga");
        teto.hasta = ahora + 4000; // un respiro antes de volver a saludar
      }
    } else if (cerca && ahora > teto.hasta) {
      teto.burbuja.textContent = FRASES_TETO[teto.frase++ % FRASES_TETO.length]!;
      teto.burbuja.classList.add("ver");
      teto.hasta = ahora + 5000;
    } else if (!cerca && teto.hasta && ahora > teto.hasta) {
      teto.burbuja.classList.remove("ver");
      teto.hasta = 0;
    }
  }

  rueda.actualizar(ahora);
  revisarMiGiro(ahora);

  // Agua de la fuente a saltos (stop-motion tambien).
  plaza.agua.position.y = 0.66 + (Math.floor(t * 3) % 2) * 0.03;
  // Llamas de la fogata: tres alturas a saltos.
  const llama = Math.floor(t * 6) % 3;
  plaza.fuego.forEach((f, i) => f.scale.set(1, [1, 1.25, 0.85][(llama + i) % 3]!, 1));

  // Nombres y burbujas sobre las cabezas.
  const w = innerWidth;
  const h = innerHeight;
  for (const o of mio ? [mio, ...otros.values()] : otros.values()) {
    tmp.copy(o.p.raiz.position).setY(2.25);
    tmp.project(camara);
    const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    o.etiqueta.style.display = visible ? "" : "none";
    if (visible) o.etiqueta.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
    // Cada burbuja se va cuando se le acaba su tiempo.
    if (o.tarjetaHasta && ahora > o.tarjetaHasta) {
      o.tarjeta.classList.remove("mostrar");
      o.tarjeta.hidden = true;
      o.tarjetaHasta = 0;
    }
    if (o.mensajes.some((m) => ahora > m.hasta)) {
      o.mensajes = o.mensajes.filter((m) => (ahora > m.hasta ? (m.el.remove(), false) : true));
    }
  }

  if (teto) {
    tmp.copy(teto.v.raiz.position).setY(teto.v.cabeza);
    tmp.project(camara);
    const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    teto.etiqueta.style.display = visible ? "" : "none";
    if (visible) teto.etiqueta.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
  }

  // Etiquetas de las zonas vivas (boda, luchadores, podios, sorteo): solo de cerca, para no llenar la pantalla.
  vivas.actualizar(Date.now());
  for (const f of fijas) {
    f.obj.getWorldPosition(tmp);
    const lejos = Math.hypot(tmp.x - pose.x, tmp.z - pose.z) > 22 && !vistaPrueba;
    tmp.y += f.alto;
    tmp.project(camara);
    const visible = !lejos && tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    f.el.style.display = visible ? "" : "none";
    if (visible) f.el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
  }

  if (ahora - ultimoDetalle > 500) {
    ultimoDetalle = ahora;
    elegirDetalle();
  }

  renderer.render(plaza.escena, camara);
  requestAnimationFrame(cuadro);
}

/** Hoja de detalle (512) solo para las DETALLE_MAX Vocaloids mas cerca de la camara, si estan a menos de DETALLE_CERCA. */
const DETALLE_MAX = 2;
const DETALLE_CERCA = 13;
let ultimoDetalle = 0;
function elegirDetalle(): void {
  const todas = [...(teto ? [teto.v] : []), ...vivas.vocaloids].map((v) => ({ v, d: v.raiz.position.distanceTo(camara.position) }));
  todas.sort((a, b) => a.d - b.d);
  todas.forEach(({ v, d }, i) => v.detalle(i < DETALLE_MAX && d < DETALLE_CERCA));
}

// ───────────────────────── zonas vivas ─────────────────────────

/** Etiquetas fijas sobre cosas del mundo (las arma vivas.ts; aqui se mueven cada cuadro). */
const fijas: { obj: THREE.Object3D; alto: number; el: HTMLElement }[] = [];
const vivas = new ZonasVivas(
  plaza,
  (obj, alto, html, clase = "zona-viva") => {
    const el = document.createElement("div");
    el.className = `etiqueta ${clase}`;
    el.innerHTML = `<span class="nombre">${html}</span>`;
    capa.append(el);
    fijas.push({ obj, alto, el });
    return el;
  },
  (el) => {
    el.remove();
    const i = fijas.findIndex((f) => f.el === el);
    if (i >= 0) fijas.splice(i, 1);
  },
);

/** La foto del servidor (la deja el bot cada minuto): al entrar y cada 3 minutos. */
async function cargarEstado(): Promise<void> {
  const r = (await fetch("api/estado").then((x) => (x.ok ? x.json() : null)).catch(() => null)) as Respuesta | null;
  if (r) {
    await vivas.aplicar(r);
    rueda.ponerCasillas(r.estado?.ruleta ?? []);
  }
}
void cargarEstado();
setInterval(() => void cargarEstado(), 180_000);

// ───────────────────────── ruleta grande ─────────────────────────

/** Zona cuya ficha esta a la vista (para la tecla F). */
let cercaDe: ZonaId | null = null;
const rueda = new RuedaPlaza(plaza.rueda);
/** Giro que se ve ahora en la ruleta grande y la fila (lo manda la sala). */
let filaRuleta: Extract<Aviso, { t: "ruleta" }> = { t: "ruleta", actual: null, cola: [] };
/** Lo que muestra la ventana de la ruleta. */
const vistaRuleta: VistaRuleta = { estado: null, ahora: null, fila: 0 };
/** Mi giro, ya decidido por el bot, mientras espera su turno o gira en la ruleta grande. */
let miGiro: RuletaGiro | null = null;
/** Texto sobre la rueda (quien gira, su premio y la fila). */
const sobreRueda = document.createElement("div");
sobreRueda.className = "etiqueta zona-viva ruleta";
sobreRueda.innerHTML = `<span class="nombre"></span>`;
capa.append(sobreRueda);
// Al pie de la rueda, sobre su base (arriba la tapa la camara cuando el Papu esta cerca).
fijas.push({ obj: rueda.objeto, alto: -3.75, el: sobreRueda });
let sobreRuedaHtml = "";

function pintarRuleta(): void {
  const a = filaRuleta.actual;
  vistaRuleta.ahora = a ? { nombre: a.nombre, origen: a.origen } : null;
  vistaRuleta.fila = filaRuleta.cola.length;
  ventana.poner("ruleta", htmlRuleta(vistaRuleta));
}

function abrirRuleta(): void {
  vistaRuleta.error = undefined;
  if (vistaRuleta.mio?.fase === "premio" || vistaRuleta.mio?.fase === "error") vistaRuleta.mio = undefined;
  ventana.abrir("ruleta", `🎰 Ruleta de <span class="rosa">los Papus</span>`, htmlRuleta(vistaRuleta));
  pintarRuleta();
  void pedir("ruleta.estado").then((r) => {
    if (r.ok) vistaRuleta.estado = r.datos as RuletaEstado;
    else if (!vistaRuleta.estado) vistaRuleta.error = r.motivo;
    pintarRuleta();
  });
}

async function aceptarAtun(): Promise<void> {
  if (vistaRuleta.mio?.fase === "pidiendo" || miGiro) return;
  vistaRuleta.mio = { fase: "pidiendo" };
  pintarRuleta();
  const r = await pedir("ruleta.aceptar");
  if (!r.ok) {
    vistaRuleta.mio = { fase: "error", motivo: r.motivo };
    pintarRuleta();
    aviso(r.motivo);
    return;
  }
  vistaRuleta.mio = undefined;
  const estado = await pedir("ruleta.estado");
  if (estado.ok) vistaRuleta.estado = estado.datos as RuletaEstado;
  const d = r.datos as { mensaje?: string };
  aviso(d.mensaje ?? "Premio aceptado.");
  pintarRuleta();
}
async function descartarAtun(): Promise<void> {
  if (vistaRuleta.mio?.fase === "pidiendo" || miGiro) return;
  vistaRuleta.mio = { fase: "pidiendo" };
  pintarRuleta();
  const r = await pedir("ruleta.descartar");
  if (!r.ok) {
    vistaRuleta.mio = { fase: "error", motivo: r.motivo };
    pintarRuleta();
    aviso(r.motivo);
    return;
  }
  miGiro = r.datos as RuletaGiro;
  vistaRuleta.mio = { fase: "pidiendo" };
  faseMia();
}

async function girarRuleta(): Promise<void> {
  if (vistaRuleta.mio?.fase === "pidiendo" || miGiro) return;
  vistaRuleta.mio = { fase: "pidiendo" };
  pintarRuleta();
  const r = await pedir("ruleta.girar");
  if (!r.ok) {
    vistaRuleta.mio = { fase: "error", motivo: r.motivo };
    return pintarRuleta();
  }
  miGiro = r.datos as RuletaGiro;
  if (vistaRuleta.estado && !miGiro.simulado) vistaRuleta.estado = { ...vistaRuleta.estado, tiradas: miGiro.tiradas, usadas: vistaRuleta.estado.usadas + 1 };
  faseMia();
}

type TipoCatalogo = "tienda" | "mercado";

function pintarCatalogo(tipo: TipoCatalogo, datos: Record<string, unknown>): string {
  const objetos = Array.isArray(datos.objetos) ? datos.objetos as { id: string; nombre: string; descripcion: string; rareza?: string; emoji?: string; precio: number | null; usos?: number | null; owned: boolean; activable?: boolean; activo?: boolean }[] : [];
  const soloLectura = datos.soloLectura === true;
  const sandbox = datos.sandbox === true;
  const abierto = tipo === "mercado" ? datos.abierto : datos.abierta;
  const wallet = datos.wallet && typeof datos.wallet === "object" ? datos.wallet as { ganadas?: number; compradas?: number } : null;
  const proxima = datos.proximaApertura && typeof datos.proximaApertura === "object" ? (datos.proximaApertura as { abre?: number }).abre : undefined;
  const estado = tipo === "mercado"
    ? abierto === null ? "Estado del mercado no disponible" : abierto ? "Neru está atendiendo" : proxima ? `Neru mantiene el mercado cerrado · abre ${new Date(proxima).toLocaleString("es-CL")}` : "Neru mantiene el mercado cerrado"
    : abierto ? "Vitrina disponible" : "No hay una vitrina activa";
  const saldo = wallet ? `<div class="v-monedero"><span>🪙 <small>Ganadas</small><b>${wallet.ganadas ?? 0}</b></span><span>💳 <small>Compradas</small><b>${wallet.compradas ?? 0}</b></span></div>` : "";
  const nombres: Record<string, string> = { comun:"Común", raro:"Raro", epico:"Épico", epica:"Épica", legendario:"Legendario", legendaria:"Legendaria", mitica:"Mítica", fundador:"Fundador", membresia:"Membresía", contrabando:"Contrabando" };
  const filas = objetos.map((o) => {
    const rareza = (o.rareza ?? "especial").toLowerCase();
    const clase = ["comun","raro","epico","epica","legendario","legendaria","mitica","fundador","membresia","contrabando"].includes(rareza) ? rareza : "especial";
    const icono = o.emoji ?? (["legendaria","legendario","mitica"].includes(rareza) ? "✨" : ["raro","epico","epica"].includes(rareza) ? "💎" : "🎁");
    const precio = o.precio === null ? "Precio no disponible" : `${o.precio.toLocaleString("es-CL")} Shaula-coins`;
    const extra = o.usos ? `<span class="v-producto-usos">${o.usos} usos</span>` : "";
    const accion = o.activable ? `<button class="v-boton" data-usar-consumible="${esc(o.id)}">${o.id === "pc-adachi-rei" ? "💻 Reiniciar día de prueba" : o.id === "regalo-rin-len" ? "🎁 Regalar una tirada" : "🎤 Activar por hoy"}</button>`
      : o.activo ? '<span class="v-chip verde">✓ Activo hoy</span>'
      : o.owned ? '<span class="v-chip verde">✓ En tu colección</span>'
      : soloLectura ? '<span class="v-chip">Solo lectura</span>'
      : abierto === false ? '<span class="v-chip">Cerrado</span>'
      : `<button class="v-boton v-comprar" data-compra="${tipo}:${esc(o.id)}">Comprar</button>`;
    return `<li class="v-producto rareza-${clase}">
      <div class="v-producto-arte"><span>${esc(icono)}</span></div>
      <div class="v-producto-info"><span class="v-producto-rareza">${esc(nombres[rareza] ?? "Artículo")}</span>
        <b>${esc(o.nombre)}</b><small>${esc(o.descripcion)}</small>
        <div class="v-producto-pie"><strong>🪙 ${esc(precio)}</strong>${extra}</div>${accion}
      </div>
    </li>`;
  }).join("");
  const cabecera = `<div class="v-vitrina-cabeza"><div><span class="v-eyebrow">${tipo === "tienda" ? "COLECCIÓN SHAULA" : "PUESTO DE NERU"}</span><p class="v-nota">${esc(estado)}</p></div>${soloLectura ? '<span class="v-chip">Preview</span>' : abierto ? '<span class="v-chip verde">Abierto</span>' : '<span class="v-chip rojo">Cerrado</span>'}</div>`;
  return `${cabecera}${saldo}<h3 class="v-seccion">${tipo === "tienda" ? "Vitrina de temporada" : "Selección de hoy"}</h3>
    ${filas ? `<ul class="v-vitrina">${filas}</ul>` : '<div class="v-vacia"><span>🛍️</span><b>La vitrina está vacía</b><small>Vuelve más tarde para descubrir nuevos artículos.</small></div>'}
    ${soloLectura ? '<p class="v-pie">Este entorno permite explorar y consultar el monedero, pero no realiza compras ni modifica el inventario.</p>' : sandbox ? '<p class="v-pie">🧪 Las compras se guardan en tu colección y monedero de prueba. No descuentan monedas ni modifican el inventario de Discord.</p>' : ""}`;
}

async function usarConsumible(id: string): Promise<void> {
  ventana.poner("mercado", '<p class="v-cargando">Activando consumible…</p>');
  const para = id === "regalo-rin-len" ? prompt("ID de Discord del Papu que recibirá la tirada:")?.trim() : undefined;
  if (id === "regalo-rin-len" && !para) return abrirCatalogo("mercado");
  const r = await pedir("mercado.usar", { id, ...(para ? { para } : {}) });
  if (!r.ok) {
    aviso(r.motivo);
    return abrirCatalogo("mercado");
  }
  const d = r.datos as { mensaje?: string };
  aviso(d.mensaje ?? "Consumible activado.");
  await abrirCatalogo("mercado");
}

async function abrirCatalogo(tipo: TipoCatalogo): Promise<void> {
  const titulo = tipo === "tienda" ? "🛍️ Tienda Shaula" : "🕶️ Mercado negro";
  ventana.abrir(tipo, titulo, '<p class="v-cargando">Consultando la vitrina…</p>');
  const accion: Accion = tipo === "tienda" ? "tienda.estado" : "mercado.estado";
  const r = await pedir(accion);
  if (!r.ok) return ventana.poner(tipo, `<p class="v-error">${esc(r.motivo)}</p>`);
  ventana.poner(tipo, pintarCatalogo(tipo, r.datos as Record<string, unknown>));
}

async function comprarObjeto(tipo: TipoCatalogo, id: string): Promise<void> {
  ventana.poner(tipo, '<p class="v-cargando">Procesando la compra…</p>');
  const accion: Accion = tipo === "tienda" ? "tienda.comprar" : "mercado.comprar";
  const r = await pedir(accion, { id });
  if (!r.ok) {
    aviso(r.motivo);
    return abrirCatalogo(tipo);
  }
  const d = r.datos as { mensaje?: string };
  aviso(d.mensaje ?? "Compra completada.");
  await abrirCatalogo(tipo);
}

/** Ventana de pesca: el bot decide tamaño y XP; el cliente solo presenta el resultado. */
function abrirPesca(): void {
  ventana.abrir("pesca", "🎣 Pesca en el estanque",
    `<div class="v-pesca-intro"><span class="v-pesca-anzuelo">🎣</span><div><b>Un momento de calma</b><p>Espera la picada y descubre qué tamaño de pez lograste sacar.</p></div></div>
    <h3 class="v-seccion">Recompensa según la captura</h3>
    <div class="v-pesca-tamanos">
      <div class="v-pez"><span>🐟</span><b>Pequeño</b><strong>5%</strong><small>de tu barra actual</small></div>
      <div class="v-pez"><span>🐠</span><b>Mediano</b><strong>10%</strong><small>de tu barra actual</small></div>
      <div class="v-pez"><span>🦈</span><b>Grande</b><strong>20%</strong><small>de tu barra actual</small></div>
    </div>
    <button class="v-boton" data-accion="pescar">🎣 Lanzar la caña</button>
    <p class="v-pie">Enfriamiento: 30 segundos entre capturas. La recompensa se calcula sobre la XP que te falta para el siguiente nivel.</p>`);
}

async function pescar(): Promise<void> {
  ventana.poner("pesca", `<div class="v-pesca-espera"><span>🎣</span><b>La boya está en el agua…</b><small>Esperando una captura</small><div class="v-pesca-onda"></div></div>`);
  const r = await pedir("pesca.capturar");
  if (!r.ok) {
    ventana.poner("pesca", `<p class="v-error">${esc(r.motivo)}</p><button class="v-boton" data-accion="pescar">Volver a intentar</button>`);
    return;
  }
  const d = r.datos as { tamano: string; xp: number; porcentaje: number; texto: string; nivelAntes?: number; nivelDespues?: number; soloLectura?: boolean; sandbox?: boolean; xpTotalSandbox?: number };
  const grande = d.tamano === "grande", mediano = d.tamano === "mediano";
  const emoji = grande ? "🦈" : mediano ? "🐠" : "🐟";
  const nombre = grande ? "Pez grande" : mediano ? "Pez mediano" : "Pez pequeño";
  const subida = d.nivelAntes !== undefined && d.nivelDespues !== undefined && d.nivelDespues > d.nivelAntes ? `<p class="v-premio-sub">🎉 ¡Subiste al nivel ${d.nivelDespues}!</p>` : "";
  ventana.poner("pesca", `<div class="v-captura ${grande ? "grande" : mediano ? "mediana" : "pequena"}">
    <span class="v-captura-pez">${emoji}</span><span class="v-eyebrow">CAPTURA REGISTRADA</span><h3>${nombre}</h3>
    <strong class="v-captura-xp">+${d.xp.toLocaleString("es-CL")} XP</strong>
    <div class="v-captura-barra"><span style="width:${d.porcentaje}%"></span></div>
    <small>${d.porcentaje}% de la barra del nivel</small><p>${esc(d.texto)}</p>${subida}
  </div>
  ${d.sandbox ? `<p class="v-nota">🧪 +XP guardada en tu progreso de prueba. Total sandbox: ${d.xpTotalSandbox?.toLocaleString("es-CL") ?? "actualizado"}. Tu XP de Discord permanece intacta.</p>` : d.soloLectura ? '<p class="v-nota">Preview: la captura se calculó con tu progreso real, pero no modificó tu XP.</p>' : '<p class="v-pie">La XP ya se sumó a tu nivel.</p>'}
  <button class="v-boton" data-accion="pescar">🎣 Volver a pescar</button>`);
}

/** En que va mi giro segun la fila de la sala: en la fila, girando (la ventana se cierra para mirarlo) o terminado. */
function faseMia(): void {
  if (!miGiro || !yo) return pintarRuleta();
  const p = puesto({ actual: filaRuleta.actual ? { ...filaRuleta.actual, inicio: 0 } : null, cola: filaRuleta.cola.map((c) => ({ ...c, index: 0, titulo: "", subtitulo: "" })) }, yo);
  if (p === 0) {
    if (vistaRuleta.mio?.fase !== "girando") {
      vistaRuleta.mio = { fase: "girando" };
      if (ventana.id === "ruleta") ventana.cerrar();
      aviso("🎰 ¡Te toca! Mira la ruleta grande.");
    }
  } else if (p !== null) vistaRuleta.mio = { fase: "fila", puesto: p };
  pintarRuleta();
}

/** Cambio en la ruleta grande (un giro nuevo, el siguiente de la fila o quedo libre). */
function colaRuleta(m: Extract<Aviso, { t: "ruleta" }>): void {
  filaRuleta = m;
  if (m.actual) rueda.girar(m.actual, performance.now());
  else rueda.soltar();
  faseMia();
}

/** Cada cuadro: cuando la rueda se detiene en mi giro, el premio (y el panel al dia). */
function revisarMiGiro(ahora: number): void {
  const e = rueda.estado(ahora);
  const html = htmlSobreRueda(e?.giro ?? null, e?.detenida ?? false, filaRuleta.cola);
  if (html !== sobreRuedaHtml) {
    sobreRuedaHtml = html;
    sobreRueda.firstElementChild!.innerHTML = html;
  }
  if (!miGiro || !e?.detenida || e.giro.papu !== yo || e.giro.origen !== "plaza") return;
  const g = miGiro;
  miGiro = null;
  vistaRuleta.mio = { fase: "premio", giro: g.giro };
  mostrarPremio(g);
  // Las misiones y tiradas al dia (el premio pudo subirlo de nivel y cumplir la mision de subir).
  void pedir("ruleta.estado").then((r) => {
    if (r.ok) vistaRuleta.estado = r.datos as RuletaEstado;
    pintarRuleta();
  });
}

/** Cartel grande con el premio, sobre la plaza. */
function mostrarPremio(g: RuletaGiro): void {
  const p = $("premio");
  p.innerHTML = `<p class="premio-titulo">${esc(g.giro.titulo)}</p><p class="premio-sub">${esc(g.giro.subtitulo)}</p>${
    g.simulado ? '<p class="premio-sub">🧪 Simulación: no se consumió una tirada ni se entregó un premio.</p>' : ""
  }${g.tiradas > 0 ? `<button type="button" data-usar="ruleta">🎰 ${g.atun ? "Aceptar premio y girar otra vez" : "Girar otra vez"} (${g.tiradas})</button>` : ""}${g.atun?.girosRestantes ? `<button type="button" data-descartar-atun>🐟 Descartar y volver a girar (${g.atun.girosRestantes})</button>` : ""}`;
  p.hidden = false;
  clearTimeout((mostrarPremio as unknown as { t?: number }).t);
  (mostrarPremio as unknown as { t?: number }).t = window.setTimeout(() => (p.hidden = true), 7000);
}

/** Comandos del chat (como en Discord). Los que aun no estan en la plaza lo dicen. */
function comando(texto: string): void {
  const nombre = texto.slice(1).trim().split(/\s+/)[0]!.toLowerCase();
  if (nombre === "ruleta") {
    enviar({ t: "ir", lugar: "ruleta" });
    abrirRuleta();
    return;
  }
  aviso(`Comandos de la plaza: /ruleta. Pronto: /tarjeta, /donar, /tienda y más. 🛠️`);
}

// Botones de la ventana, de la ficha del lugar y del cartel del premio.
ventana.cuerpo.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-accion]");
  if (b?.dataset.accion === "girar" && !b.disabled) void girarRuleta();
  if (b?.dataset.accion === "aceptar-atun" && !b.disabled) void aceptarAtun();
  if (b?.dataset.accion === "pescar" && !b.disabled) void pescar();
  if (b?.dataset.accion === "descartar-atun" && !b.disabled) void descartarAtun();
  const usar = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-usar-consumible]");
  if (usar?.dataset.usarConsumible) void usarConsumible(usar.dataset.usarConsumible);
  const compra = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-compra]");
  if (compra?.dataset.compra) {
    const [tipo, id] = compra.dataset.compra.split(":", 2);
    if ((tipo === "tienda" || tipo === "mercado") && id) void comprarObjeto(tipo, id);
  }
});
$("premio").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-descartar-atun]");
  if (!b) return;
  $("premio").hidden = true;
  void descartarAtun();
});
for (const id of ["stand", "premio"]) {
  $(id).addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-usar]");
    if (!b) return;
    if (id === "premio") $("premio").hidden = true;
    USAR[b.dataset.usar as ZonaId]?.abrir();
  });
}

camara.position.copy(OFFSET).add(new THREE.Vector3(pose.x, 0, pose.z));
camara.lookAt(pose.x, 1, pose.z);
requestAnimationFrame(cuadro);
iniciar().catch((e) => error(`No pude abrir el mundo: ${e?.message ?? e}`));
