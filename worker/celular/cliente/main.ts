// Página del celular de Neru (PLAN §3.15). Sin framework: pide a la API del worker y dibuja. Dentro de Discord entra
// con el SDK de la Actividad (app de Neru); fuera, solo en modo de prueba (wrangler dev con ACTIVIDAD_PRUEBA=1).
// Siempre abre en el menú; cada app entra directo a jugar.
import { DiscordSDK } from "@discord/embedded-app-sdk";
import type { EstadoSilueta, EstadoVocaloidle, Inicio, Pista, Prefs, Tema } from "../../src/celular/tipos";
import type { Dificultad, Pedido as PedidoSala, Vista } from "../../src/actividad/tipos";
import { abrirAjedrez, cerrarAjedrez } from "./ajedrez";

const app = document.getElementById("app")!;
let sesion = "";
let inicio: Inicio | null = null;
type Pantalla = "inicio" | "vocaloidle" | "silueta" | "ajustes" | "trivia" | "tarjeta" | "mercado" | "mochila" | "donar" | "roles" | "ruleta" | "tienda" | "comercio" | "ajedrez";
let pantalla: Pantalla = "inicio";
/** Cómo saluda a la sala de la trivia (el token de Discord o el Papu de prueba). */
let saludoSala: PedidoSala | null = null;

// ───────────────────────── utilidades ─────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
const azar = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;

async function api<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`api/${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: { "x-celular-sesion": sesion, ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "Algo falló. Prueba otra vez.");
  return j;
}

function aviso(texto: string): void {
  document.querySelector(".aviso")?.remove();
  const d = document.createElement("div");
  d.className = "aviso";
  d.textContent = texto;
  document.body.append(d);
  setTimeout(() => d.remove(), 3200);
}

/** Pantalla de espera con vida: Neru rebotando, puntos de «escribiendo…» y una barrita que avanza. */
function cargandoHtml(texto: string, cara = "neru-meh"): string {
  return `<div class="cargando vivo"><img class="rebote" src="img/${cara}.png" alt="" /><div class="puntos" aria-hidden="true"><i></i><i></i><i></i></div><p>${esc(texto)}</p><div class="progreso" aria-hidden="true"><i></i></div></div>`;
}

function error(texto: string): void {
  app.innerHTML = `<div class="cargando"><img src="img/neru-enojo.png" alt="" /><p>${esc(texto)}</p></div>`;
  // Dentro de una app, el error deja la barra de abajo para volver al menú.
  if (inicio && pantalla !== "inicio") barraInicio(true);
}

function enCuanto(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${m} min` : `${m} min`;
}

const FLECHA_IZQ = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-label="es de antes"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>`;
const FLECHA_DER = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-label="es de después"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const ATRAS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;

// ───────────────────────── temas ─────────────────────────

interface DefTema {
  nombre: string;
  bg: string;
  rejilla?: boolean;
  surface: string;
  surface2: string;
  sheet: string;
  accent: string;
  onAccent: string;
  text: string;
  muted: string;
  tile: string;
  tinte: string;
  claro?: boolean;
  frase: string;
}

const TEMAS: Record<Tema, DefTema> = {
  neru: { nombre: "Neru", bg: "#1B1D24", surface: "#262933", surface2: "#2C303B", sheet: "#22252E", accent: "#F2C230", onAccent: "#1B1D24", text: "#F4F1E6", muted: "#A9ADBA", tile: "#F7E4A3", tinte: "grayscale(1) sepia(1) saturate(3.2) hue-rotate(6deg)", frase: "Negro y amarillo, el predeterminado. Buen gusto." },
  canal: { nombre: "Canal", bg: "#2C2347", rejilla: true, surface: "rgba(17,24,51,0.55)", surface2: "rgba(17,24,51,0.7)", sheet: "#231C3B", accent: "#F6C744", onAccent: "#2C2347", text: "#FFFFFF", muted: "#D3C6E2", tile: "#D8CCF6", tinte: "grayscale(1) sepia(1) saturate(2.4) hue-rotate(215deg)", frase: "Los colores de los videos de GyroP. Muy de fan." },
  miku: { nombre: "Miku", bg: "#0E2226", surface: "#173439", surface2: "#1B3B41", sheet: "#132D31", accent: "#39C5BB", onAccent: "#06201D", text: "#EFFBFA", muted: "#9FC5C1", tile: "#BCEBE5", tinte: "grayscale(1) sepia(1) saturate(2.8) hue-rotate(132deg)", frase: "¿Turquesa? Qué original. Bueno, tú mandas." },
  luka: { nombre: "Luka", bg: "#25161F", surface: "#35202C", surface2: "#3C2533", sheet: "#2E1B26", accent: "#F08DB8", onAccent: "#2A0F1C", text: "#FBEFF5", muted: "#D0A9BD", tile: "#F8D0E2", tinte: "grayscale(1) sepia(1) saturate(2.6) hue-rotate(290deg)", frase: "Rosa. Ahora me va a pedir atún, seguro." },
  kaito: { nombre: "Kaito", bg: "#101A2C", surface: "#1A2740", surface2: "#1F2E4B", sheet: "#152137", accent: "#6FA8FF", onAccent: "#0B1730", text: "#EEF4FF", muted: "#A6B6D3", tile: "#CADCFF", tinte: "grayscale(1) sepia(1) saturate(2.8) hue-rotate(178deg)", frase: "Azul helado. No le digas a Kaito." },
  gumi: { nombre: "Gumi", bg: "#13211A", surface: "#1D3125", surface2: "#22392B", sheet: "#192A20", accent: "#7ED957", onAccent: "#0F2408", text: "#F0FAEE", muted: "#A8C4A4", tile: "#D0EFC1", tinte: "grayscale(1) sepia(1) saturate(2.6) hue-rotate(62deg)", frase: "Verde zanahoria… la parte de arriba. Da igual." },
  tienda: { nombre: "Tienda", bg: "#FFF4F8", surface: "#FFFFFF", surface2: "#FCE7F0", sheet: "#FFFFFF", accent: "#2E2445", onAccent: "#FFFFFF", text: "#2E2445", muted: "#6E6080", tile: "#FBDCE9", tinte: "grayscale(1) sepia(1) saturate(2.2) hue-rotate(295deg)", claro: true, frase: "Me arden los ojos. Pero bueno." },
};

function aplicarTema(p: Prefs): void {
  const t = TEMAS[p.tema] ?? TEMAS.neru;
  const r = document.documentElement.style;
  const rejilla = "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px) 0 0 / 39px 39px, linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px) 0 0 / 39px 39px, ";
  r.setProperty("--bg", t.bg);
  r.setProperty("--fondo", (t.rejilla ? rejilla : "") + t.bg);
  r.setProperty("--surface", t.surface);
  r.setProperty("--surface2", t.surface2);
  r.setProperty("--sheet", t.sheet);
  r.setProperty("--accent", t.accent);
  r.setProperty("--on-accent", t.onAccent);
  r.setProperty("--text", t.text);
  r.setProperty("--muted", t.muted);
  r.setProperty("--tile", t.tile);
  r.setProperty("--tinte", p.iconos === "tema" ? t.tinte : "none");
  document.documentElement.style.colorScheme = t.claro ? "light" : "dark";
}

// ───────────────────────── entrada ─────────────────────────

async function iniciar(): Promise<void> {
  const cfg = (await fetch("api/config").then((r) => r.json())) as { clientId: string | null; prueba: boolean };
  const params = new URLSearchParams(location.search);
  // En el celular Discord pone su barra («Neru» y «Salir») encima de la Actividad: se deja espacio arriba.
  if (params.get("platform") === "mobile" || (params.has("frame_id") && matchMedia("(pointer: coarse)").matches)) document.documentElement.classList.add("movil");
  let saludo: unknown;
  if (params.has("frame_id")) {
    if (!cfg.clientId) return error("El celular todavía no está configurado.");
    const sdk = new DiscordSDK(cfg.clientId);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({ client_id: cfg.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds.members.read"] });
    const tok = (await fetch("api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).then((r) => r.json())) as { access_token?: string; error?: string };
    if (!tok.access_token) return error(tok.error ?? "Discord no me dejó entrar.");
    await sdk.commands.authenticate({ access_token: tok.access_token });
    saludo = { token: tok.access_token };
    saludoSala = { t: "hola", token: tok.access_token };
  } else if (cfg.prueba) {
    const nombre = prompt("Modo de prueba: ¿tu nombre?") || "Papu";
    const prueba = { id: `prueba-${nombre.replace(/\W/g, "").slice(0, 12) || "papu"}`, nombre };
    saludo = { prueba };
    saludoSala = { t: "hola", prueba };
  } else {
    return error("Abre el celular desde Discord: escribe /celular o búscalo en 🚀 Actividades.");
  }
  const r = await fetch("api/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saludo) });
  const j = (await r.json().catch(() => ({}))) as { sesion?: string; error?: string };
  if (!j.sesion) return error(j.error ?? "No pude prender el celular.");
  sesion = j.sesion;
  await cargarInicio();
}

let esperaTarjeta: ReturnType<typeof setTimeout> | null = null;

async function cargarInicio(intento = 0): Promise<void> {
  inicio = await api<Inicio>("inicio");
  aplicarTema(inicio.prefs);
  if (pantalla === "inicio") dibujarInicio();
  // Neru dibuja la tarjeta en unos segundos: se vuelve a pedir hasta que llega (máx. ~1 min).
  if (esperaTarjeta) clearTimeout(esperaTarjeta);
  if (!inicio.perfil.tarjeta && intento < 15) esperaTarjeta = setTimeout(() => void cargarInicio(intento + 1).catch(() => {}), 4000);
}

// ───────────────────────── inicio ─────────────────────────

const SALUDOS = [
  "¿Otra vez tú? Ya, juega algo, pero no me gastes la batería.",
  "Toca algo rápido, que estoy chateando.",
  "Mi celular, mis reglas. Bueno, tus juegos.",
  "Si se me acaba la batería es tu culpa.",
  "El Vocaloidle de hoy está fácil. Mentira, no sé.",
  "No mires mis fotos. Ahí no hay nada. Nada.",
  "Volviste. Ya sabía, nadie puede vivir sin mi celular.",
  "Juega, gana XP y déjame en paz un rato.",
];

interface DefApp {
  id: string;
  nombre: string;
  icono: string;
  orig: string;
  abrir?: () => void;
  punto?: boolean;
}

function iconoApp(a: DefApp): string {
  const tile = inicio?.prefs.iconos === "orig" ? a.orig : "var(--tile)";
  const lista = !a.abrir;
  return `<button class="app${lista ? " apagada" : ""}" data-app="${a.id}">
    <div class="icono" style="background:${tile}"><img src="img/${a.icono}" alt="" style="filter:var(--tinte)" /></div>
    ${a.punto ? '<i class="punto"></i>' : ""}${lista ? '<b class="pronto">Pronto</b>' : ""}
    <span>${esc(a.nombre)}</span></button>`;
}

function dibujarInicio(): void {
  if (!inicio) return;
  const i = inicio;
  const juegos: DefApp[] = [
    { id: "trivia", nombre: "Trivia", icono: "trivia.svg", orig: "#FFE1E7", abrir: () => abrirTrivia() },
    { id: "vocaloidle", nombre: "Vocaloidle", icono: "vocaloidle.svg", orig: "#DDF5E6", abrir: () => void abrirVocaloidle(), punto: !i.vocaloidle.resuelto },
    { id: "silueta", nombre: "Silueta", icono: "silueta.svg", orig: "#E7E2FF", abrir: () => void abrirSilueta(), punto: !i.silueta.resuelto },
    { id: "ruleta", nombre: "Ruleta", icono: "ruleta.svg", orig: "#FFF0C9", abrir: () => void abrirRuleta() },
    { id: "ajedrez", nombre: "Ajedrez", icono: "roles.svg", orig: "#DCEFFF", abrir: () => entrarAjedrez() },
  ];
  const tuyo: DefApp[] = [
    { id: "tarjeta", nombre: "Mi tarjeta", icono: "tarjeta.png", orig: "#DDF2EE", abrir: () => void abrirTarjeta() },
    { id: "tienda", nombre: "Tienda", icono: "tienda.png", orig: "#FFE6EE", abrir: () => void abrirTienda() },
    { id: "mochila", nombre: "Mochila", icono: "mochila.png", orig: "#ECE7FF", abrir: () => void abrirMochila() },
    { id: "comercio", nombre: "Comercio", icono: "comercio.svg", orig: "#FFF0D9", abrir: () => void abrirComercio() },
    { id: "mercado", nombre: "Mercado", icono: "mercado.svg", orig: "#D9D5E3", abrir: () => void abrirMercado() },
    { id: "donar", nombre: "Donar", icono: "donar.svg", orig: "#FFE3EF", abrir: () => void abrirDonar() },
    { id: "roles", nombre: "Roles", icono: "roles.svg", orig: "#DDF4F0", abrir: () => void abrirRoles() },
    { id: "ajustes", nombre: "Ajustes", icono: "roles.svg", orig: "#E6E2D6", abrir: () => abrirAjustes() },
  ];
  const tarjeta = i.perfil.tarjeta ? `<img src="${esc(i.perfil.tarjeta)}" alt="Tu tarjeta de nivel" />` : `<div class="hueco brillo"><span>Neru está dibujando tu tarjeta</span><div class="puntos" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
  app.innerHTML = `
    <div class="barra"><div class="neruos">NeruOS</div><div class="derecha">
      <div class="monedas"><img src="img/moneda.png" alt="" /><span>${i.perfil.shaulitas == null ? "…" : fmt(i.perfil.shaulitas)}</span><span class="sr" style="position:absolute;width:1px;height:1px;overflow:hidden">Shaulitas</span></div>
      <div class="bateria">3 %</div></div></div>
    <button class="tarjeta" aria-label="Tu tarjeta">${tarjeta}</button>
    <div class="neru"><img src="img/neru-meh.png" alt="Neru" /><p>${esc(azar(SALUDOS))}</p></div>
    <div class="seccion">Juegos del día</div>
    <div class="apps">${juegos.map(iconoApp).join("")}</div>
    <div class="seccion">Lo tuyo</div>
    <div class="apps">${tuyo.map(iconoApp).join("")}</div>`;
  // El ícono del ajedrez es un caballo (no hay kawaii todavía).
  const caballo = app.querySelector<HTMLElement>('[data-app="ajedrez"] .icono');
  if (caballo) caballo.innerHTML = `<span style="font-size:34px;line-height:1;color:#2E2445" aria-hidden="true">♞</span>`;
  // El ícono de Ajustes es un engranaje dibujado (no hay kawaii todavía).
  const aj = app.querySelector<HTMLElement>('[data-app="ajustes"] .icono');
  if (aj) aj.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2E2445" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>`;
  for (const a of [...juegos, ...tuyo]) {
    app.querySelector(`[data-app="${a.id}"]`)?.addEventListener("click", () => (a.abrir ? a.abrir() : aviso(`${a.nombre} llega muy pronto al celular. Por ahora, úsalo con su comando en Discord.`)));
  }
  app.querySelector(".tarjeta")?.addEventListener("click", () => void abrirTarjeta());
}

/** ♟️ Ajedrez (worker/celular/cliente/ajedrez.ts): le pasa lo que necesita del celular. */
function entrarAjedrez(): void {
  if (!inicio) return;
  pantalla = "ajedrez";
  void abrirAjedrez({
    app,
    yo: () => ({ id: inicio!.papu.id, nombre: inicio!.papu.nombre }),
    api,
    esc,
    aviso,
    cabeza,
    alVolver,
    cargando: (t) => cargandoHtml(t),
    elegirPapu,
    enPantalla: () => pantalla === "ajedrez",
  });
}

function cabeza(titulo: string, sub: string, color: string): string {
  return `<div class="cabeza"><button class="volver" aria-label="Volver al inicio">${ATRAS}</button><div><h1 style="color:${color}">${esc(titulo)}</h1><small>${esc(sub)}</small></div></div>`;
}

/** Vuelve al menú de apps (botón de la app, barra de abajo, o el gesto/botón atrás del sistema). */
function irInicio(): void {
  if (pantalla === "inicio") return;
  pantalla = "inicio";
  cerrarSala();
  cerrarAjedrez();
  document.querySelector(".hoja")?.remove();
  barraInicio(false);
  void cargarInicio().catch((e: Error) => aviso(e.message));
}

/**
 * Barra fija abajo con «Inicio»: siempre a la vista dentro de una app (en el celular, Discord tapa la parte de arriba
 * de la Actividad y no deja usar el gesto de volver).
 */
function barraInicio(ver: boolean): void {
  let barra = document.querySelector<HTMLElement>(".dock");
  if (!barra) {
    barra = document.createElement("nav");
    barra.className = "dock";
    barra.innerHTML = `<button aria-label="Volver al inicio"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg><span>Inicio</span></button>`;
    barra.querySelector("button")!.addEventListener("click", () => {
      if (history.state?.celularApp) history.back();
      else irInicio();
    });
    document.body.append(barra);
  }
  barra.hidden = !ver;
  document.body.classList.toggle("con-dock", ver);
}

window.addEventListener("popstate", () => irInicio());

function alVolver(): void {
  barraInicio(true);
  // Una entrada en el historial por app abierta: el botón o gesto atrás del sistema vuelve al menú.
  if (!history.state?.celularApp) history.pushState({ celularApp: true }, "");
  app.querySelector(".volver")?.addEventListener("click", () => {
    if (history.state?.celularApp) history.back();
    else irInicio();
  });
}

// ───────────────────────── elegir personaje ─────────────────────────

function selector(opciones: { id: string; nombre: string }[], usados: Set<string>, alElegir: (id: string) => Promise<void>): string {
  setTimeout(() => {
    const input = app.querySelector<HTMLInputElement>(".elegir input");
    const lista = app.querySelector<HTMLElement>(".nombres");
    if (!input || !lista) return;
    const pintar = () => {
      const q = input.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      lista.innerHTML = opciones
        .filter((o) => o.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
        .map((o) => `<button data-id="${esc(o.id)}" ${usados.has(o.id) ? "disabled" : ""}>${esc(o.nombre)}</button>`)
        .join("");
      for (const b of lista.querySelectorAll<HTMLButtonElement>("button:not([disabled])")) {
        b.onclick = async () => {
          for (const x of lista.querySelectorAll<HTMLButtonElement>("button")) x.disabled = true;
          await alElegir(b.dataset.id!).catch((e: Error) => (aviso(e.message), pintar()));
        };
      }
    };
    input.oninput = pintar;
    pintar();
  });
  return `<div class="elegir"><input placeholder="Busca un Vocaloid…" aria-label="Busca un Vocaloid" autocomplete="off" /><div class="nombres"></div></div>`;
}

function resultado(titulo: string, texto: string, aciertos: number | null, siguienteEn: number): string {
  setTimeout(() => {
    app.querySelector(".copiar")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(texto).then(
        () => aviso("Copiado. Pégalo en #general y presume."),
        () => aviso("No pude copiarlo; mantén presionado el texto para copiarlo."),
      );
    });
  });
  return `<div class="resultado"><h2>${esc(titulo)}</h2><pre>${esc(texto)}</pre>
    ${aciertos ? `<div class="nota">Ganaste la XP de ${aciertos} ${aciertos === 1 ? "acierto" : "aciertos"} de trivia (Neru te la da en unos segundos).</div>` : ""}
    <button class="boton copiar">Copiar resultado</button>
    <div class="nota">Nuevo reto en ${enCuanto(siguienteEn)} (00:00 de México).</div></div>`;
}

// ───────────────────────── Vocaloidle ─────────────────────────

const PISTAS_NERU = ["Vas bien. Te doy una pista: no soy yo. De nada.", "Mmm, no. Sigue intentando.", "Uy, casi. O no, no sé, no estaba mirando.", "Ese no es. ¿Seguro que eres fan?", "Los amarillos son casi. Los rojos, ni cerca."];

function celdaHtml(c: Pista["empresa"] & { flecha?: "antes" | "despues" | null }, k: number): string {
  const f = c.flecha === "antes" ? FLECHA_IZQ : c.flecha === "despues" ? FLECHA_DER : "";
  return `<div class="celda ${c.color}" style="animation-delay:${k * 0.12}s">${c.flecha === "antes" ? f : ""}${esc(c.valor)}${c.flecha === "despues" ? f : ""}</div>`;
}

async function abrirVocaloidle(): Promise<void> {
  pantalla = "vocaloidle";
  dibujarVocaloidle(await api<EstadoVocaloidle>("vocaloidle"));
}

function dibujarVocaloidle(e: EstadoVocaloidle): void {
  if (pantalla !== "vocaloidle" || !inicio) return;
  const filas = e.pistas
    .map((p) => `<div class="fila"><div class="quien">${esc(p.nombre)}</div>${[p.empresa, p.anio, p.pelo, p.origen, p.voz].map(celdaHtml).join("")}</div>`)
    .join("");
  const usados = new Set(e.pistas.map((p) => p.id));
  app.innerHTML = `${cabeza("Vocaloidle", `Reto n.º ${e.numero} · el mismo para todos hoy`, "#5FD4C8")}
    <div class="neru"><img src="img/neru-${e.resuelto ? "risa" : "meh"}.png" alt="Neru" /><p>${esc(e.resuelto ? "Bien. Ahora déjame chatear." : e.pistas.length ? azar(PISTAS_NERU) : "Adivina quién es. Yo ya sé, obvio.")}</p></div>
    <div class="tabla"><div class="fila titulos"><div>Intento</div><div>Empresa</div><div>Año</div><div>Pelo</div><div>Origen</div><div>Voz</div></div>${filas}</div>
    <div class="leyenda"><span><i style="background:var(--verde)"></i>Coincide</span><span><i style="background:var(--amarillo)"></i>Casi</span><span><i style="background:var(--rojo)"></i>No</span><span>${FLECHA_IZQ} es de antes</span><span>${FLECHA_DER} de después</span></div>
    ${e.resuelto ? resultado("¡Lo adivinaste!", e.compartir ?? "", e.aciertos, e.siguienteEn) : selector(inicio.opciones.vocaloidle, usados, async (id) => dibujarVocaloidle(await api<EstadoVocaloidle>("vocaloidle", { personaje: id })))}`;
  alVolver();
}

// ───────────────────────── Silueta ─────────────────────────

let imagenUrl = "";

async function abrirSilueta(): Promise<void> {
  pantalla = "silueta";
  await dibujarSilueta(await api<EstadoSilueta>("silueta"));
}

async function dibujarSilueta(e: EstadoSilueta): Promise<void> {
  if (pantalla !== "silueta" || !inicio) return;
  const usados = new Set(inicio.opciones.silueta.filter((o) => e.fallidos.includes(o.nombre)).map((o) => o.id));
  app.innerHTML = `${cabeza("Silueta", `Reto n.º ${e.numero} · se aclara con cada intento`, "#B9A8FF")}
    <div class="silueta brillo"><img alt="La imagen del reto de hoy" /></div>
    ${e.fallidos.length ? `<div class="fallidos">${e.fallidos.map((f) => `<span>${esc(f)}</span>`).join("")}</div>` : ""}
    ${e.resuelto ? resultado(`¡Era ${e.respuesta}!`, e.compartir ?? "", e.aciertos, e.siguienteEn) : `<div class="nota" style="margin-top:10px">Nivel ${e.nivel + 1} de ${e.niveles}</div>${selector(inicio.opciones.silueta, usados, async (id) => void (await dibujarSilueta(await api<EstadoSilueta>("silueta", { personaje: id }))))}`}`;
  alVolver();
  // La imagen pide la sesión: se baja con fetch y se muestra como blob.
  const r = await fetch(`api/silueta/imagen?nivel=${e.nivel}`, { headers: { "x-celular-sesion": sesion } });
  if (!r.ok) return;
  if (imagenUrl) URL.revokeObjectURL(imagenUrl);
  imagenUrl = URL.createObjectURL(await r.blob());
  const img = app.querySelector<HTMLImageElement>(".silueta img");
  if (img) {
    img.onload = () => img.parentElement?.classList.remove("brillo");
    img.src = imagenUrl;
  }
}

// ───────────────────────── ajustes (tema) ─────────────────────────

function abrirAjustes(): void {
  if (!inicio) return;
  pantalla = "ajustes";
  const p = inicio.prefs;
  const t = TEMAS[p.tema];
  app.innerHTML = `${cabeza("Ajustes", "Tema del celular · gratis para todos", "var(--accent)")}
    <div class="neru"><img src="img/neru-meh.png" alt="Neru" /><p>${esc(t.frase)}</p></div>
    <div class="seccion">Tema</div>
    <div class="temas">${(Object.keys(TEMAS) as Tema[])
      .map((k) => `<button class="tema${k === p.tema ? " activo" : ""}" data-tema="${k}"><div class="muestra"><i style="background:linear-gradient(135deg, ${TEMAS[k].bg} 50%, ${TEMAS[k].accent} 50%)"></i></div><span>${TEMAS[k].nombre}</span></button>`)
      .join("")}</div>
    <div class="seccion">Íconos</div>
    <div class="segmento"><button data-iconos="tema" class="${p.iconos === "tema" ? "activo" : ""}">A juego con el tema</button><button data-iconos="orig" class="${p.iconos === "orig" ? "activo" : ""}">Colores originales</button></div>`;
  alVolver();
  const guardar = async (cambio: Partial<Prefs>) => {
    inicio!.prefs = { ...inicio!.prefs, ...cambio };
    aplicarTema(inicio!.prefs);
    abrirAjustes();
    await api<Prefs>("prefs", inicio!.prefs).catch((e: Error) => aviso(e.message));
  };
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-tema]")) b.onclick = () => void guardar({ tema: b.dataset.tema as Tema });
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-iconos]")) b.onclick = () => void guardar({ iconos: b.dataset.iconos as Prefs["iconos"] });
}

// ───────────────────────── pedidos a Neru ─────────────────────────

/** Pide algo a Neru (apps con datos del bot) y espera su respuesta. */
async function pedir<T>(appId: string, accion: string, datos: unknown = null): Promise<T> {
  const { id } = await api<{ id: number }>("pedido", { app: appId, accion, datos });
  const hasta = Date.now() + 30_000;
  for (let espera = 500; Date.now() < hasta; espera = Math.min(1500, espera + 250)) {
    await new Promise((r) => setTimeout(r, espera));
    const r = await api<{ estado: string; resultado: (T & { mensaje?: string }) | null }>(`pedido/${id}`);
    if (r.estado === "listo") return r.resultado as T;
    if (r.estado === "error") throw new Error(r.resultado?.mensaje ?? "Algo falló.");
  }
  throw new Error("Neru no contestó. ¿Se le acabó la batería? Prueba otra vez.");
}

// ───────────────────────── Trivia ─────────────────────────

const DIFS: { id: Dificultad; nombre: string }[] = [
  { id: "facil", nombre: "Fácil" },
  { id: "medio", nombre: "Media" },
  { id: "dificil", nombre: "Difícil" },
];
let ws: WebSocket | null = null;
let vistaT: Vista | null = null;
let recibidaT = 0;
let marco = 0;
let audioT: HTMLAudioElement | null = null;
let claveT = "";

function difGuardada(): Dificultad {
  try {
    const d = localStorage.getItem("celular:trivia") as Dificultad | null;
    return d && DIFS.some((x) => x.id === d) ? d : "facil";
  } catch {
    return "facil";
  }
}

function cerrarSala(): void {
  cancelAnimationFrame(marco);
  audioT?.pause();
  audioT = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  ws = null;
  vistaT = null;
}

function enviarSala(p: PedidoSala): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(p));
}

/** Entra directo a jugar: sala privada de la trivia multijugador, sola y en la última dificultad. */
function abrirTrivia(): void {
  if (!inicio || !saludoSala) return;
  pantalla = "trivia";
  cerrarSala();
  claveT = "";
  app.innerHTML = `${cabeza("Trivia", "Teto pregunta, tú respondes", "#ff9db0")}${cargandoHtml("Llamando a Teto…")}`;
  alVolver();
  const instancia = `celular-${inicio.papu.id}-${Date.now().toString(36)}`;
  const url = new URL(`api/trivia/sala?instancia=${encodeURIComponent(instancia)}`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const yo = new WebSocket(url);
  ws = yo;
  let empezada = false;
  yo.onopen = () => yo.send(JSON.stringify(saludoSala));
  yo.onmessage = (e) => {
    if (ws !== yo) return;
    const m = JSON.parse(String(e.data)) as { vista?: Vista; error?: string; aviso?: string };
    if (m.error) return error(m.error);
    if (m.aviso) aviso(m.aviso);
    if (!m.vista) return;
    vistaT = m.vista;
    recibidaT = performance.now();
    if (!empezada && m.vista.fase === "sala" && m.vista.host === m.vista.yo) {
      empezada = true;
      enviarSala({ t: "configurar", modo: "eliminatoria", eleccion: difGuardada() });
      enviarSala({ t: "empezar" });
      return;
    }
    dibujarTrivia();
  };
  yo.onclose = () => {
    if (ws === yo && pantalla === "trivia") error("Se cortó la conexión con Teto. Vuelve al inicio y entra de nuevo.");
  };
}

function cambiarDif(d: Dificultad): void {
  try {
    localStorage.setItem("celular:trivia", d);
  } catch {
    // sin almacenamiento: vale solo esta vez
  }
  if (vistaT?.fase === "fin") {
    enviarSala({ t: "otra" });
    enviarSala({ t: "configurar", modo: "eliminatoria", eleccion: d });
    enviarSala({ t: "empezar" });
  } else {
    aviso(`Listo: la próxima partida será en ${DIFS.find((x) => x.id === d)!.nombre.toLowerCase()}.`);
    dibujarTrivia(true);
  }
}

function dibujarTrivia(forzar = false): void {
  const v = vistaT;
  if (pantalla !== "trivia" || !v) return;
  const clave = `${v.fase}:${v.pregunta?.nonce ?? ""}`;
  // La sala manda la vista cada vez que algo cambia: la pregunta no se redibuja (no se pierde lo escrito).
  if (!forzar && clave === claveT && v.fase === "pregunta") return;
  claveT = clave;
  const yo = v.jugadores.find((j) => j.id === v.yo);
  const dif = difGuardada();
  const chips = `<div class="segmento" style="grid-template-columns:repeat(3,1fr)">${DIFS.map((d) => `<button data-dif="${d.id}" class="${d.id === dif ? "activo" : ""}">${d.nombre}</button>`).join("")}</div>`;
  const barra = `<div class="tbarra"><span>Racha <b>${yo?.racha ?? 0}</b></span><span>XP <b>+${yo?.xp ?? 0}</b></span></div>`;
  let cuerpo = "";
  const p = v.pregunta;
  if (v.fase === "pregunta" && p) {
    const media = p.media
      ? p.media.tipo === "imagen"
        ? `<div class="tmedia"><img src="api/trivia/${esc(p.media.url)}" alt="" /></div>`
        : `<div class="tmedia"><button class="boton suave" id="oir">▶️ Escuchar de nuevo</button></div>`
      : "";
    const respuestas =
      p.tipo === "opciones"
        ? `<div class="topciones">${p.opciones.map((o, k) => `<button data-op="${k}">${esc(o)}</button>`).join("")}</div>`
        : `<div class="elegir"><input id="tx" placeholder="Escribe tu respuesta…" autocomplete="off" /><button class="boton" id="enviar">Responder</button></div>`;
    cuerpo = `<div class="ttiempo"><i id="tiempo"></i></div><div class="tpregunta">${esc(p.texto)}</div>${media}${respuestas}`;
  } else if (v.fase === "revelar" && v.revelar) {
    const r = v.revelar.resultados[v.yo];
    const ok = !!r?.ok;
    cuerpo = `<div class="resultado"><h2 style="color:${ok ? "var(--verde)" : "var(--rojo)"}">${ok ? `¡Bien!${r?.xp ? ` +${r.xp} XP` : ""}` : "Uy, no."}</h2>
      <div class="nota" style="text-align:left">Era: <b>${esc(v.revelar.respuesta)}</b></div>${v.revelar.dato ? `<pre>${esc(v.revelar.dato)}</pre>` : ""}</div>`;
  } else if (v.fase === "fin") {
    const n = yo?.aciertos ?? 0;
    cuerpo = `<div class="resultado"><h2>${n ? `¡Racha de ${n}!` : "Esta vez no hubo racha."}</h2>
      <div class="nota" style="text-align:left">${yo?.xp ? `Ganaste ${yo.xp} XP (Teto te la da en unos segundos).` : "Si ya jugaste tus 10 partidas con XP de hoy, sigues jugando por la racha."}</div>
      <button class="boton" id="otra">Otra partida</button></div>`;
  } else {
    cuerpo = cargandoHtml("Preparando la pregunta…");
  }
  app.innerHTML = `${cabeza("Trivia", "Teto pregunta, tú respondes", "#ff9db0")}${chips}${barra}${cuerpo}`;
  alVolver();
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-dif]")) b.onclick = () => cambiarDif(b.dataset.dif as Dificultad);
  app.querySelector("#otra")?.addEventListener("click", () => cambiarDif(difGuardada()));
  if (v.fase === "pregunta" && p) {
    for (const b of app.querySelectorAll<HTMLButtonElement>("[data-op]")) {
      b.onclick = () => {
        for (const x of app.querySelectorAll<HTMLButtonElement>("[data-op]")) x.disabled = true;
        b.classList.add("elegida");
        enviarSala({ t: "responder", nonce: p.nonce, opcion: Number(b.dataset.op) });
      };
    }
    const tx = app.querySelector<HTMLInputElement>("#tx");
    const mandar = () => {
      if (!tx?.value.trim()) return;
      tx.disabled = true;
      enviarSala({ t: "responder", nonce: p.nonce, texto: tx.value.trim().slice(0, 120) });
    };
    app.querySelector("#enviar")?.addEventListener("click", mandar);
    tx?.addEventListener("keydown", (e) => e.key === "Enter" && mandar());
    if (p.media?.tipo === "audio") {
      audioT?.pause();
      audioT = new Audio(`api/trivia/${p.media.url}`);
      void audioT.play().catch(() => {});
      app.querySelector("#oir")?.addEventListener("click", () => {
        if (!audioT) return;
        audioT.currentTime = 0;
        void audioT.play();
      });
    }
    cancelAnimationFrame(marco);
    const total = p.segundos * 1000;
    const fin = recibidaT + p.restante;
    const paso = () => {
      const el = document.getElementById("tiempo");
      if (!el) return;
      el.style.width = `${Math.max(0, Math.min(1, (fin - performance.now()) / total)) * 100}%`;
      if (performance.now() < fin) marco = requestAnimationFrame(paso);
    };
    paso();
  } else audioT?.pause();
}

// ───────────────────────── Mi tarjeta ─────────────────────────

interface ObjetoT {
  id: string;
  nombre: string;
  tipo: string;
  rareza: string;
  animado: boolean;
}
interface EleccionT {
  fondo: string | null;
  borde: string | null;
  barra: string | null;
  nombre: string | null;
  aro: string | null;
  titulo: string | null;
  insignias: string[];
  lado: "izquierda" | "derecha";
}
interface EstadoTarjeta {
  objetos: ObjetoT[];
  equipado: EleccionT;
  imagen: string;
  mensaje?: string;
}

const TIPOS_T: { id: string; nombre: string }[] = [
  { id: "todo", nombre: "Todo" },
  { id: "fondo", nombre: "Fondos" },
  { id: "aro", nombre: "Aros" },
  { id: "borde", nombre: "Bordes" },
  { id: "barra", nombre: "Barras" },
  { id: "nombre", nombre: "Nombre" },
  { id: "titulo", nombre: "Títulos" },
  { id: "insignia", nombre: "Insignias" },
];
let tarjetaEstado: EstadoTarjeta | null = null;
let tarjetaElegida: EleccionT | null = null;
let tarjetaFiltro = "todo";
let tarjetaImagen = "";
let tarjetaNota = "";
let vistaPendiente: ReturnType<typeof setTimeout> | null = null;

async function abrirTarjeta(): Promise<void> {
  pantalla = "tarjeta";
  app.innerHTML = `${cabeza("Mi tarjeta", "Toca para probar · Guardar la deja puesta", "#39C5BB")}${cargandoHtml("Buscando tus cosas…")}`;
  alVolver();
  try {
    tarjetaEstado = await pedir<EstadoTarjeta>("tarjeta", "estado");
  } catch (e) {
    if (pantalla === "tarjeta") error((e as Error).message);
    return;
  }
  tarjetaElegida = structuredClone(tarjetaEstado.equipado);
  tarjetaImagen = tarjetaEstado.imagen;
  tarjetaNota = "";
  dibujarTarjeta();
}

function puesto(o: ObjetoT, e: EleccionT): boolean {
  return o.tipo === "insignia" ? e.insignias.includes(o.id) : (e as unknown as Record<string, string | null>)[o.tipo] === o.id;
}

function dibujarTarjeta(): void {
  const st = tarjetaEstado;
  const e = tarjetaElegida;
  if (pantalla !== "tarjeta" || !st || !e) return;
  const lista = st.objetos.filter((o) => tarjetaFiltro === "todo" || o.tipo === tarjetaFiltro);
  const cambiada = JSON.stringify(e) !== JSON.stringify(st.equipado);
  app.innerHTML = `${cabeza("Mi tarjeta", "Toca para probar · Guardar la deja puesta", "#39C5BB")}
    <div class="tarjeta" style="cursor:default"><img src="data:image/jpeg;base64,${tarjetaImagen}" alt="Tu tarjeta" /></div>
    <div class="nota" style="margin-top:6px">${esc(tarjetaNota || (cambiada ? "Vista previa: aún no se guarda." : "Así sale hoy en /nivel."))}</div>
    <div class="segmento"><button data-lado="izquierda" class="${e.lado === "izquierda" ? "activo" : ""}">Datos a la izquierda</button><button data-lado="derecha" class="${e.lado === "derecha" ? "activo" : ""}">Derecha</button></div>
    <div class="chips">${TIPOS_T.map((t) => `<button data-tipo="${t.id}" class="${t.id === tarjetaFiltro ? "activo" : ""}">${t.nombre}</button>`).join("")}</div>
    <div class="minis">${
      lista.length
        ? lista.map((o) => `<button data-obj="${esc(o.id)}" class="${puesto(o, e) ? "puesto" : ""}" title="${esc(o.nombre)}"><img loading="lazy" src="api/mini/${esc(o.id)}" alt="" /><span>${esc(o.nombre)}</span></button>`).join("")
        : `<p class="nota">Aún no tienes de estos. Consíguelos en la Tienda.</p>`
    }</div>
    <div class="acciones"><button class="boton suave" id="descartar" ${cambiada ? "" : "disabled"}>Descartar</button><button class="boton" id="guardar" ${cambiada ? "" : "disabled"}>Guardar</button></div>`;
  alVolver();
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-tipo]")) b.onclick = () => ((tarjetaFiltro = b.dataset.tipo!), dibujarTarjeta());
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-lado]")) b.onclick = () => ((e.lado = b.dataset.lado as EleccionT["lado"]), probar());
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-obj]")) {
    b.onclick = () => {
      const o = st.objetos.find((x) => x.id === b.dataset.obj);
      if (!o) return;
      if (o.tipo === "insignia") {
        if (e.insignias.includes(o.id)) e.insignias = e.insignias.filter((x) => x !== o.id);
        else if (e.insignias.length >= 3) return aviso("Máximo 3 insignias. Quita una primero.");
        else e.insignias = [...e.insignias, o.id];
      } else {
        const r = e as unknown as Record<string, string | null>;
        r[o.tipo] = r[o.tipo] === o.id ? null : o.id;
      }
      probar();
    };
  }
  app.querySelector("#descartar")?.addEventListener("click", () => {
    tarjetaElegida = structuredClone(st.equipado);
    tarjetaImagen = st.imagen;
    tarjetaNota = "";
    dibujarTarjeta();
  });
  app.querySelector("#guardar")?.addEventListener("click", () => void guardarTarjeta());
}

/** Vista previa real (la dibuja Neru), con un respiro para no pedir una por cada toque. */
function probar(): void {
  tarjetaNota = "Neru está dibujando…";
  dibujarTarjeta();
  if (vistaPendiente) clearTimeout(vistaPendiente);
  vistaPendiente = setTimeout(() => {
    const e = structuredClone(tarjetaElegida);
    pedir<{ imagen: string; mensaje: string }>("tarjeta", "vista", { eleccion: e })
      .then((r) => {
        if (JSON.stringify(e) !== JSON.stringify(tarjetaElegida)) return;
        tarjetaImagen = r.imagen;
        tarjetaNota = r.mensaje;
      })
      .catch((err: Error) => (tarjetaNota = err.message))
      .finally(() => dibujarTarjeta());
  }, 700);
}

async function guardarTarjeta(): Promise<void> {
  const b = app.querySelector<HTMLButtonElement>("#guardar");
  if (b) ocupado(b, "Guardando…");
  try {
    const r = await pedir<EstadoTarjeta>("tarjeta", "guardar", { eleccion: tarjetaElegida });
    tarjetaEstado = r;
    tarjetaElegida = structuredClone(r.equipado);
    tarjetaImagen = r.imagen;
    tarjetaNota = r.mensaje ?? "¡Guardado!";
    if (inicio) inicio.perfil.tarjeta = `data:image/jpeg;base64,${r.imagen}`;
    aviso("¡Guardado!");
  } catch (err) {
    aviso((err as Error).message);
  }
  dibujarTarjeta();
}

// ───────────────────────── piezas comunes de las apps ─────────────────────────


function cargandoApp(p: Pantalla, titulo: string, sub: string, color: string, texto = "Preguntándole a Neru…"): void {
  pantalla = p;
  app.innerHTML = `${cabeza(titulo, sub, color)}${cargandoHtml(texto)}`;
  alVolver();
}

/** Botón que pide un segundo toque antes de hacer algo que gasta (comprar, usar, regalar). */
function dobleToque(b: HTMLButtonElement, hacer: () => void, pregunta = "¿Seguro? Toca otra vez"): void {
  const original = b.innerHTML;
  let armado = false;
  let reloj: ReturnType<typeof setTimeout> | null = null;
  b.onclick = () => {
    if (!armado) {
      // Primer toque: cambia de color y late, para que se note que espera el segundo.
      armado = true;
      b.innerHTML = `⚠️ ${esc(pregunta)}`;
      b.classList.add("armado");
      reloj = setTimeout(() => {
        armado = false;
        b.innerHTML = original;
        b.classList.remove("armado");
      }, 4000);
      return;
    }
    if (reloj) clearTimeout(reloj);
    b.classList.remove("armado");
    ocupado(b);
    hacer();
  };
}

/** Botón trabajando: deshabilitado, con un circulito que gira. */
function ocupado(b: HTMLButtonElement, texto = "Un momento…"): void {
  b.disabled = true;
  b.classList.add("ocupado");
  b.innerHTML = `<span class="giro" aria-hidden="true"></span>${esc(texto)}`;
}

/** Hoja para elegir a un Papu del servidor (busca por nombre). */
function elegirPapu(titulo: string, alElegir: (p: { id: string; nombre: string }) => void): void {
  const capa = document.createElement("div");
  capa.className = "hoja";
  capa.innerHTML = `<div class="hoja-caja"><div class="hoja-tit">${esc(titulo)}</div><input placeholder="Escribe su nombre…" autocomplete="off" /><div class="papus"><p class="nota">Escribe al menos 2 letras.</p></div><button class="boton suave">Cancelar</button></div>`;
  document.body.append(capa);
  const input = capa.querySelector("input")!;
  const lista = capa.querySelector<HTMLElement>(".papus")!;
  const cerrar = () => capa.remove();
  capa.querySelector(".boton")!.addEventListener("click", cerrar);
  capa.addEventListener("click", (e) => e.target === capa && cerrar());
  let espera: ReturnType<typeof setTimeout> | null = null;
  input.oninput = () => {
    if (espera) clearTimeout(espera);
    const q = input.value.trim();
    if (q.length < 2) return void (lista.innerHTML = `<p class="nota">Escribe al menos 2 letras.</p>`);
    espera = setTimeout(async () => {
      lista.innerHTML = `<p class="nota">Buscando…</p>`;
      try {
        const r = await pedir<{ papus: { id: string; nombre: string }[] }>("donar", "buscar-papus", { q });
        if (input.value.trim() !== q) return;
        lista.innerHTML = r.papus.length ? r.papus.map((p) => `<button data-id="${esc(p.id)}">${esc(p.nombre)}</button>`).join("") : `<p class="nota">No encontré a nadie con ese nombre.</p>`;
        for (const b of lista.querySelectorAll<HTMLButtonElement>("button")) {
          b.onclick = () => {
            cerrar();
            alElegir({ id: b.dataset.id!, nombre: b.textContent ?? "" });
          };
        }
      } catch (e) {
        lista.innerHTML = `<p class="nota">${esc((e as Error).message)}</p>`;
      }
    }, 450);
  };
  input.focus();
}

const fmtN = (n: number) => fmt(Math.round(n));
const enMin = (t: number) => enCuanto(Math.max(0, t - Date.now()));

// ───────────────────────── Mercado y Mochila ─────────────────────────

interface EstadoMercado {
  abierto: boolean;
  cierra: number | null;
  horario: string;
  ganadas: number;
  vitrina: { id: string; nombre: string; emoji: string; precio: number; usos: number | null; descripcion: string; como: string | null; tiene: boolean; usosTuyos: number | null }[];
  consumibles: { id: string; nombre: string; emoji: string; usos: number | null; como: string; accion: string | null; activo: boolean }[];
  luna: number | null;
}

async function abrirMercado(): Promise<void> {
  cargandoApp("mercado", "Mercado negro", "Solo con Shaulitas ganadas", "#F2C230");
  try {
    dibujarMercado(await pedir<EstadoMercado>("mercado", "estado"));
  } catch (e) {
    if (pantalla === "mercado") error((e as Error).message);
  }
}

function dibujarMercado(st: EstadoMercado, nota = ""): void {
  if (pantalla !== "mercado") return;
  const cuerpo = st.abierto
    ? `<div class="nota" style="margin-top:6px">Cierra en ${enMin(st.cierra ?? 0)} · tienes ${fmtN(st.ganadas)} Shaulitas</div>
       <div class="cartas">${st.vitrina
         .map((o) => {
           const falta = o.precio - st.ganadas;
           const estado = o.tiene ? "Ya lo tienes" : o.usosTuyos ? `Tienes ${o.usosTuyos} usos` : "";
           return `<div class="carta"><div class="carta-cab"><span class="emoji">${o.emoji}</span><div><b>${esc(o.nombre)}</b><small>${fmtN(o.precio)} Shaulitas${o.usos ? ` · ${o.usos} usos` : ""}${estado ? ` · ${estado}` : ""}</small></div></div>
             <p>${esc(o.descripcion)}</p>${o.como ? `<p class="nota" style="text-align:left">${esc(o.como)}</p>` : ""}
             <button class="boton" data-comprar="${esc(o.id)}" ${o.tiene || falta > 0 ? "disabled" : ""}>${o.tiene ? "Ya lo tienes" : falta > 0 ? `Te faltan ${fmtN(falta)}` : `Comprar por ${fmtN(o.precio)}`}</button></div>`;
         })
         .join("")}</div>`
    : `<div class="resultado"><h2>Está cerrado.</h2><pre>Abre una hora al día, a una hora sorpresa ${esc(st.horario)}. Neru avisa a los 🕶️ Traficante (#tus-roles).</pre></div>`;
  app.innerHTML = `${cabeza("Mercado negro", "Solo con Shaulitas ganadas", "#F2C230")}${nota ? `<div class="aviso-linea">${esc(nota)}</div>` : ""}${cuerpo}<div class="acciones" style="grid-template-columns:1fr"><button class="boton suave" id="ir-mochila">Ver mi mochila</button></div>`;
  alVolver();
  app.querySelector("#ir-mochila")?.addEventListener("click", () => void abrirMochila());
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-comprar]")) {
    dobleToque(b, async () => {
      try {
        const r = await pedir<{ mensaje: string; estado: EstadoMercado }>("mercado", "comprar", { id: b.dataset.comprar });
        dibujarMercado(r.estado, r.mensaje);
      } catch (e) {
        aviso((e as Error).message);
        void abrirMercado();
      }
    });
  }
}

async function abrirMochila(nota = ""): Promise<void> {
  cargandoApp("mochila", "Mochila", "Tus consumibles", "#B19CFF");
  try {
    dibujarMochila(await pedir<EstadoMercado>("mochila", "estado"), nota);
  } catch (e) {
    if (pantalla === "mochila") error((e as Error).message);
  }
}

const USAR: Record<string, string> = {
  pc: "Reiniciar mi día",
  microfono: "Activar hoy",
  regalo: "Regalar una tirada",
  luna: "Activar (2 semanas)",
  sake: "Ver la pista",
  doblehelado: "Sobre común → raro",
};

function dibujarMochila(st: EstadoMercado, nota = ""): void {
  if (pantalla !== "mochila") return;
  const lista = st.consumibles.length
    ? st.consumibles
        .map(
          (c) => `<div class="carta"><div class="carta-cab"><span class="emoji">${c.emoji}</span><div><b>${esc(c.nombre)}</b><small>${c.usos === null ? "Para siempre" : `${c.usos} ${c.usos === 1 ? "uso" : "usos"}`}${c.activo ? " · activo" : ""}</small></div></div>
          <p class="nota" style="text-align:left">${esc(c.como)}</p>${c.accion ? `<button class="boton" data-usar="${c.accion}" ${c.activo ? "disabled" : ""}>${c.activo ? "Ya está activo" : USAR[c.accion] ?? "Usar"}</button>` : ""}</div>`,
        )
        .join("")
    : `<div class="resultado"><pre>No tienes consumibles. Se compran en el mercado negro, con Shaulitas ganadas.</pre></div>`;
  app.innerHTML = `${cabeza("Mochila", "Tus consumibles", "#B19CFF")}${nota ? `<div class="aviso-linea">${esc(nota)}</div>` : ""}${st.luna ? `<div class="nota" style="margin-top:6px">🌙 Luna de IA activa: termina en ${enMin(st.luna)}</div>` : ""}<div class="cartas">${lista}</div>
    <div class="acciones" style="grid-template-columns:1fr"><button class="boton suave" id="ir-mercado">${st.abierto ? "Ir al mercado negro (abierto)" : "Mercado negro (cerrado)"}</button></div>`;
  alVolver();
  app.querySelector("#ir-mercado")?.addEventListener("click", () => void abrirMercado());
  const usar = async (accion: string, para: string | null = null) => {
    try {
      const r = await pedir<{ mensaje: string; estado: EstadoMercado }>("mochila", "usar", { accion, para });
      dibujarMochila(r.estado, r.mensaje);
    } catch (e) {
      aviso((e as Error).message);
      void abrirMochila();
    }
  };
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-usar]")) {
    const accion = b.dataset.usar!;
    if (accion === "regalo") b.onclick = () => elegirPapu("¿A quién le regalas una tirada?", (p) => void usar("regalo", p.id));
    else if (accion === "pc" || accion === "luna") dobleToque(b, () => void usar(accion));
    else b.onclick = () => (ocupado(b), void usar(accion));
  }
}

// ───────────────────────── Donar ─────────────────────────

async function abrirDonar(nota = ""): Promise<void> {
  cargandoApp("donar", "Donar", "Regala mensajes de tu cuota de hoy", "#FF8FB8");
  try {
    dibujarDonar(await pedir<{ quedan: number; tope: number; sinLimite: boolean }>("donar", "estado"), nota);
  } catch (e) {
    if (pantalla === "donar") error((e as Error).message);
  }
}

function dibujarDonar(st: { quedan: number; tope: number; sinLimite: boolean }, nota = ""): void {
  if (pantalla !== "donar") return;
  let para: { id: string; nombre: string } | null = null;
  let n = 1;
  const max = Math.max(0, Math.min(st.quedan, st.tope));
  const pintar = () => {
    app.innerHTML = `${cabeza("Donar", "Regala mensajes de tu cuota de hoy", "#FF8FB8")}${nota ? `<div class="aviso-linea">${esc(nota)}</div>` : ""}
      <div class="resultado"><pre>${st.sinLimite ? "Tus mensajes no tienen límite: es un regalo solo para ti, así que no se pueden donar." : `Te quedan ${st.quedan} mensajes de tu cuota diaria hoy. Lo que regalas le llega a sus donados (máximo ${st.tope} sin usar) y lo pierdes tú. Teto lo anuncia en #general.`}</pre></div>
      ${st.sinLimite || !max ? "" : `<div class="fila-dato"><span>Para</span><button class="boton suave" id="elegir">${para ? esc(para.nombre) : "Elegir a un Papu"}</button></div>
      <div class="fila-dato"><span>Mensajes</span><div class="paso"><button id="menos" aria-label="Menos">−</button><b>${n}</b><button id="mas" aria-label="Más">+</button></div></div>
      <div class="acciones" style="grid-template-columns:1fr"><button class="boton" id="regalar" ${para ? "" : "disabled"}>Regalar ${n} ${n === 1 ? "mensaje" : "mensajes"}</button></div>`}`;
    alVolver();
    app.querySelector("#elegir")?.addEventListener("click", () => elegirPapu("¿A quién le regalas?", (p) => ((para = p), pintar())));
    app.querySelector("#menos")?.addEventListener("click", () => ((n = Math.max(1, n - 1)), pintar()));
    app.querySelector("#mas")?.addEventListener("click", () => ((n = Math.min(max, n + 1)), pintar()));
    const b = app.querySelector<HTMLButtonElement>("#regalar");
    if (b && para) {
      const destino = para;
      dobleToque(b, async () => {
        try {
          const r = await pedir<{ mensaje: string; estado: { quedan: number; tope: number; sinLimite: boolean } }>("donar", "donar", { para: destino.id, cantidad: n });
          dibujarDonar(r.estado, r.mensaje);
        } catch (e) {
          aviso((e as Error).message);
          b.disabled = false;
        }
      });
    }
  };
  pintar();
}

// ───────────────────────── Roles ─────────────────────────

interface EstadoRoles {
  colores: { clave: string; nombre: string; color: string; puesto: boolean }[];
  paises: { clave: string; nombre: string; puesto: boolean }[];
  avisos: { clave: string; nombre: string; descripcion: string; puesto: boolean }[];
  pronombres: { opciones: { clave: string; nombre: string }[]; actual: string | null };
  genero: { opciones: { clave: string; nombre: string }[]; actual: string | null };
}

async function abrirRoles(nota = ""): Promise<void> {
  cargandoApp("roles", "Roles", "Los de #tus-roles, aquí", "#8FD9CC");
  try {
    dibujarRoles(await api<EstadoRoles>("roles"), nota);
  } catch (e) {
    if (pantalla === "roles") error((e as Error).message);
  }
}

function dibujarRoles(st: EstadoRoles, nota = ""): void {
  if (pantalla !== "roles") return;
  const avisos = new Set(st.avisos.filter((a) => a.puesto).map((a) => a.clave));
  const ident = (tipo: "pronombres" | "genero", t: string) =>
    `<div class="seccion">${t}${st[tipo].actual ? ` · ${esc(st[tipo].actual!)}` : ""}</div><div class="chips envolver">${st[tipo].opciones
      .map((o) => `<button data-${tipo}="${esc(o.clave)}" class="${st[tipo].actual?.endsWith(o.nombre) ? "activo" : ""}">${esc(o.nombre)}</button>`)
      .join("")}<button data-${tipo}="quitar">Quitar</button><button data-escribir="${tipo}">Escribir los míos</button></div>`;
  app.innerHTML = `${cabeza("Roles", "Los de #tus-roles, aquí", "#8FD9CC")}${nota ? `<div class="aviso-linea">${esc(nota)}</div>` : ""}
    <div class="seccion">Color de tu nombre</div>
    <div class="colores">${st.colores.map((c) => `<button data-color="${esc(c.clave)}" class="${c.puesto ? "activo" : ""}" title="${esc(c.nombre)}"><i style="background:${esc(c.color)}"></i><span>${esc(c.nombre)}</span></button>`).join("")}<button data-color="ninguno"><i style="background:var(--surface2)"></i><span>Sin color</span></button></div>
    <div class="seccion">Avisos</div>
    <div class="avisos">${st.avisos.map((a) => `<label><input type="checkbox" data-aviso="${esc(a.clave)}" ${avisos.has(a.clave) ? "checked" : ""}/><span><b>${esc(a.nombre)}</b><small>${esc(a.descripcion)}</small></span></label>`).join("")}</div>
    <div class="acciones" style="grid-template-columns:1fr;position:static"><button class="boton suave" id="guardar-avisos">Guardar avisos</button></div>
    ${ident("pronombres", "Pronombres")}${ident("genero", "Género")}
    <div class="seccion">País</div>
    <div class="chips envolver">${st.paises.map((p) => `<button data-pais="${esc(p.clave)}" class="${p.puesto ? "activo" : ""}">${esc(p.nombre)}</button>`).join("")}<button data-pais="ninguno">Quitar</button></div>`;
  alVolver();
  const cambiar = async (datos: Record<string, unknown>) => {
    try {
      const r = await api<{ mensaje: string }>("roles", datos);
      await abrirRoles(r.mensaje);
    } catch (e) {
      aviso((e as Error).message);
    }
  };
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-color]")) b.onclick = () => void cambiar({ tipo: "color", valor: b.dataset.color });
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-pais]")) b.onclick = () => void cambiar({ tipo: "pais", valor: b.dataset.pais });
  for (const tipo of ["pronombres", "genero"] as const) for (const b of app.querySelectorAll<HTMLButtonElement>(`[data-${tipo}]`)) b.onclick = () => void cambiar({ tipo, valor: b.getAttribute(`data-${tipo}`) });
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-escribir]")) {
    b.onclick = () => {
      const tipo = b.dataset.escribir!;
      const texto = prompt(tipo === "pronombres" ? "Escribe tus pronombres (ej.: elle/le)" : "Escribe tu género");
      if (texto?.trim()) void cambiar({ tipo, texto: texto.trim().slice(0, 60) });
    };
  }
  app.querySelector("#guardar-avisos")?.addEventListener("click", () => {
    const valores = [...app.querySelectorAll<HTMLInputElement>("[data-aviso]")].filter((x) => x.checked).map((x) => x.dataset.aviso);
    void cambiar({ tipo: "avisos", valores });
  });
}

// ───────────────────────── Ruleta ─────────────────────────

interface EstadoRuleta {
  misiones: { nombre: string; hecha: boolean; avance: string }[];
  quedan: number;
  usadas: number;
  bloqueada: boolean;
  regaladas: number;
  atun: number;
  pendiente: EleccionRuleta | null;
  premios: { icono: string; etiqueta: string; color: string }[];
}
interface EleccionRuleta {
  indice: number;
  premio: string;
  puedeOtra: boolean;
  girosExtra: number;
  gastaAtun: boolean;
}
let giroRuleta = 0;

async function abrirRuleta(nota = ""): Promise<void> {
  cargandoApp("ruleta", "Ruleta", "Una tirada por cada misión cumplida", "#FFCB45");
  try {
    dibujarRuleta(await pedir<EstadoRuleta>("ruleta", "estado"), nota);
  } catch (e) {
    if (pantalla === "ruleta") error((e as Error).message);
  }
}

function ruedaHtml(premios: EstadoRuleta["premios"]): string {
  const n = premios.length || 1;
  const conic = premios.map((p, k) => `${p.color} ${(k * 360) / n}deg ${((k + 1) * 360) / n}deg`).join(", ");
  const iconos = premios.map((p, k) => `<span style="transform:rotate(${(k + 0.5) * (360 / n)}deg) translateY(-104px) rotate(${-(k + 0.5) * (360 / n)}deg)">${esc(p.icono)}</span>`).join("");
  return `<div class="rueda-caja"><i class="puntero"></i><div class="rueda" id="rueda" style="background:conic-gradient(${conic});transform:rotate(${giroRuleta}deg)">${iconos}</div></div>`;
}

/** Gira la rueda hasta dejar la casilla `indice` bajo el puntero (arriba). */
function girarHasta(indice: number, n: number): Promise<void> {
  const el = document.getElementById("rueda");
  if (!el) return Promise.resolve();
  const centro = (indice + 0.5) * (360 / n);
  const destino = giroRuleta - (giroRuleta % 360) + 360 * 5 + (360 - centro);
  giroRuleta = destino;
  el.style.transition = "transform 3.2s cubic-bezier(.17,.67,.2,1)";
  el.style.transform = `rotate(${destino}deg)`;
  return new Promise((r) => setTimeout(r, 3300));
}

function dibujarRuleta(st: EstadoRuleta, nota = "", eleccion: EleccionRuleta | null = st.pendiente): void {
  if (pantalla !== "ruleta") return;
  const n = st.premios.length;
  app.innerHTML = `${cabeza("Ruleta", "Una tirada por cada misión cumplida", "#FFCB45")}${nota ? `<div class="aviso-linea">${esc(nota)}</div>` : ""}
    ${ruedaHtml(st.premios)}
    ${
      eleccion
        ? `<div class="resultado"><h2>Te salió: ${esc(eleccion.premio)}</h2><pre>🐟 ${eleccion.puedeOtra ? (eleccion.gastaAtun ? `Descartarlo gasta 1 uso del Atún de Luka (te quedan ${st.atun}).` : `Te quedan ${eleccion.girosExtra} giros extra en este giro.`) : "Ya no puedes descartarlo: este premio es el tuyo."}</pre>
          <div class="acciones" style="position:static;padding:0"><button class="boton suave" id="otra" ${eleccion.puedeOtra ? "" : "disabled"}>Descartar y girar</button><button class="boton" id="quedar">Me lo quedo</button></div></div>`
        : `<div class="acciones" style="grid-template-columns:1fr;position:static"><button class="boton" id="girar" ${st.quedan > 0 && !st.bloqueada ? "" : "disabled"}>${st.bloqueada ? "Hoy no puedes girar" : st.quedan > 0 ? `Girar (${st.quedan})` : "Sin tiradas"}</button></div>`
    }
    <div class="seccion">Misiones de hoy</div>
    <div class="misiones">${st.misiones.map((m) => `<div class="${m.hecha ? "hecha" : ""}"><span>${m.hecha ? "✅" : "⬜"} ${esc(m.nombre)}</span><small>${esc(m.avance)}</small></div>`).join("")}</div>
    ${st.regaladas ? `<div class="nota">🍊 Te regalaron ${st.regaladas} ${st.regaladas === 1 ? "tirada" : "tiradas"} hoy.</div>` : ""}${st.atun ? `<div class="nota">🐟 Atún de Luka: ${st.atun} usos (verás el premio antes de quedártelo).</div>` : ""}`;
  alVolver();
  const accion = async (a: string) => {
    for (const b of app.querySelectorAll<HTMLButtonElement>(".boton")) b.disabled = true;
    try {
      const r = await pedir<{ eleccion?: EleccionRuleta; resultado?: { indice: number; premio: string; texto: string; canal: string | null }; estado: EstadoRuleta }>("ruleta", "girar", { accion: a });
      const indice = r.eleccion?.indice ?? r.resultado?.indice ?? 0;
      if (a !== "quedar") await girarHasta(indice, n);
      if (r.eleccion) return dibujarRuleta(r.estado, "", r.eleccion);
      dibujarRuleta(r.estado, `¡${r.resultado!.premio}! ${r.resultado!.texto}.${r.resultado!.canal ? ` Teto lo publica en #${r.resultado!.canal}.` : ""}`, null);
    } catch (e) {
      aviso((e as Error).message);
      void abrirRuleta();
    }
  };
  for (const [id, a, texto] of [["#girar", "girar", "Girando…"], ["#quedar", "quedar", "Un momento…"], ["#otra", "otra", "Girando…"]] as const) {
    const b = app.querySelector<HTMLButtonElement>(id);
    if (b) b.onclick = () => (ocupado(b, texto), void accion(a));
  }
}

// ───────────────────────── Tienda ─────────────────────────

interface ObjetoTienda {
  id: string;
  nombre: string;
  tipo: string;
  rareza: string;
  precio: number;
  tiene: boolean;
}
interface EstadoTienda {
  monedas: number;
  ecos: number;
  descuento: number;
  temporada: string;
  vitrina: { cambia: string; objetos: ObjetoTienda[] } | null;
  sobres: {
    gratis: number;
    gratisRaro: number;
    gratisLeg: number;
    pago: { tipo: string; nombre: string; precio: number }[];
    tematico: { precio: number; ecos: number; temas: { id: string; nombre: string; emoji: string; faltan: number }[] } | null;
    regalados: { id: number; nombre: string }[];
    membresia: number;
  };
}
interface SobreAbierto {
  titulo: string;
  objetos: { id: string; nombre: string; tipo: string; rareza: string; nuevo: boolean; ecos: number }[];
  helado: number;
}
let pestanaTienda: "vitrina" | "sobres" = "vitrina";

async function abrirTienda(nota = ""): Promise<void> {
  cargandoApp("tienda", "Tienda", "Shaulitas para tu tarjeta", "#FF8FB6");
  try {
    dibujarTienda(await pedir<EstadoTienda>("tienda", "estado"), nota);
  } catch (e) {
    if (pantalla === "tienda") error((e as Error).message);
  }
}

function dibujarTienda(st: EstadoTienda, nota = "", abierto: SobreAbierto | null = null): void {
  if (pantalla !== "tienda") return;
  if (inicio) inicio.perfil.shaulitas = st.monedas;
  const tabs = `<div class="segmento"><button data-tab="vitrina" class="${pestanaTienda === "vitrina" ? "activo" : ""}">Tienda de la semana</button><button data-tab="sobres" class="${pestanaTienda === "sobres" ? "activo" : ""}">Sobres</button></div>`;
  let cuerpo = "";
  if (abierto) {
    cuerpo = `<div class="resultado"><h2>${esc(abierto.titulo)}</h2>${abierto.helado ? `<div class="nota" style="text-align:left">🍦 El Helado de Kaito le puso ${abierto.helado} más.</div>` : ""}</div>
      <div class="minis">${abierto.objetos.map((o) => `<div class="mini-ver ${o.nuevo ? "nuevo" : ""}"><img src="api/mini/${esc(o.id)}" alt="" /><span>${esc(o.nombre)}</span><small>${o.nuevo ? "¡Nuevo!" : `Repetido · +${o.ecos} Ecos`}</small></div>`).join("")}</div>
      <div class="acciones"><button class="boton suave" id="otro">Abrir otro</button><button class="boton" id="a-tarjeta">Ponérmelo</button></div>`;
  } else if (pestanaTienda === "vitrina") {
    cuerpo = st.vitrina
      ? `<div class="nota" style="margin-top:6px">Cambia ${esc(st.vitrina.cambia)}${st.descuento ? ` · tu membresía: ${st.descuento} % de descuento` : ""}</div>
         <div class="minis">${st.vitrina.objetos
           .map((o) => `<div class="mini-ver"><img src="api/mini/${esc(o.id)}" alt="" /><span>${esc(o.nombre)}</span><small>${esc(o.rareza)} · ${esc(o.tipo)}</small><button class="boton chico" data-comprar="${esc(o.id)}" ${o.tiene || o.precio > st.monedas ? "disabled" : ""}>${o.tiene ? "Ya lo tienes" : `${fmtN(o.precio)}`}</button></div>`)
           .join("")}</div>`
      : `<div class="resultado"><pre>No hay vitrina abierta ahora: la temporada aún no empieza o ya terminó.</pre></div>`;
  } else {
    const s = st.sobres;
    const gratis = [
      s.gratis ? `<button class="boton" data-sobre="gratis:comun">Abrir común regalado (${s.gratis})</button>` : "",
      s.gratisRaro ? `<button class="boton" data-sobre="gratis:raro">Abrir raro regalado (${s.gratisRaro})</button>` : "",
      s.gratisLeg ? `<button class="boton" data-sobre="gratis:legendario">Abrir legendario regalado (${s.gratisLeg})</button>` : "",
      ...s.regalados.map((r) => `<button class="boton" data-sobre="tabrir:${r.id}">Abrir sobre de ${esc(r.nombre)} (regalo)</button>`),
    ].join("");
    cuerpo = `<div class="pila">${gratis || `<div class="nota">No tienes sobres regalados. Salen en la ruleta, las misiones del día, la trivia y cada lunes.</div>`}
      <div class="seccion" style="margin:10px 4px 2px">Comprar con Shaulitas</div>
      ${s.pago.map((p) => `<button class="boton suave" data-sobre="pago:${p.tipo}" ${p.precio > st.monedas ? "disabled" : ""}>${esc(p.nombre)} · ${fmtN(p.precio)}</button>`).join("")}
      ${
        s.tematico
          ? `<div class="seccion" style="margin:10px 4px 2px">Sobre temático (${fmtN(s.tematico.precio)} o un común regalado + ${fmtN(s.tematico.ecos)} Ecos)</div>
             <select id="tema">${s.tematico.temas.map((t) => `<option value="${esc(t.id)}">${t.emoji} ${esc(t.nombre)} · te faltan ${t.faltan}</option>`).join("")}</select>
             <div class="acciones" style="position:static;padding:0"><button class="boton suave" id="tpago" ${s.tematico.precio > st.monedas ? "disabled" : ""}>Comprar</button><button class="boton suave" id="tregalo" ${s.gratis < 1 || st.ecos < s.tematico.ecos ? "disabled" : ""}>Común + Ecos</button></div>`
          : ""
      }
      ${s.membresia ? `<div class="nota">Tienes ${s.membresia} sobre(s) de membresía: esos se eligen en /tienda → Mi membresía.</div>` : ""}</div>`;
  }
  app.innerHTML = `${cabeza("Tienda", `${fmtN(st.monedas)} Shaulitas · ${fmtN(st.ecos)} Ecos`, "#FF8FB6")}${nota ? `<div class="aviso-linea">${esc(nota)}</div>` : ""}${abierto ? "" : tabs}${cuerpo}`;
  alVolver();
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-tab]")) b.onclick = () => ((pestanaTienda = b.dataset.tab as typeof pestanaTienda), dibujarTienda(st));
  app.querySelector("#otro")?.addEventListener("click", () => ((pestanaTienda = "sobres"), dibujarTienda(st)));
  app.querySelector("#a-tarjeta")?.addEventListener("click", () => void abrirTarjeta());
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-comprar]")) {
    dobleToque(b, async () => {
      try {
        const r = await pedir<{ mensaje: string; estado: EstadoTienda }>("tienda", "comprar", { id: b.dataset.comprar });
        dibujarTienda(r.estado, r.mensaje);
      } catch (e) {
        aviso((e as Error).message);
        void abrirTienda();
      }
    }, "¿Comprar?");
  }
  const abrir = async (modo: string, arg: string) => {
    for (const x of app.querySelectorAll<HTMLButtonElement>(".boton")) x.disabled = true;
    try {
      const r = await pedir<{ abierto: SobreAbierto; estado: EstadoTienda }>("tienda", "sobre", { modo, arg });
      dibujarTienda(r.estado, "", r.abierto);
    } catch (e) {
      aviso((e as Error).message);
      void abrirTienda();
    }
  };
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-sobre]")) {
    const [modo, arg] = b.dataset.sobre!.split(":") as [string, string];
    if (modo === "pago") dobleToque(b, () => void abrir(modo, arg), "¿Comprar el sobre?");
    else b.onclick = () => (ocupado(b, "Abriendo…"), void abrir(modo, arg));
  }
  const tema = () => app.querySelector<HTMLSelectElement>("#tema")?.value ?? "";
  const tp = app.querySelector<HTMLButtonElement>("#tpago");
  if (tp) dobleToque(tp, () => void abrir("tpago", tema()), "¿Comprar?");
  const tr = app.querySelector<HTMLButtonElement>("#tregalo");
  if (tr) dobleToque(tr, () => void abrir("tregalo", tema()), "¿Seguro?");
}

// ───────────────────────── Comercio ─────────────────────────

interface Paquete {
  monedas: number;
  xp: number;
  niveles: number;
  cuota: number;
  sobres: { comun: number; raro: number; legendario: number };
  objetos: string[];
  consumibles: Record<string, number>;
}
interface InventarioC {
  monedas: number;
  xp: number;
  niveles: number;
  sobres: { comun: number; raro: number; legendario: number };
  objetos: { id: string; nombre: string; tipo: string; rareza: string }[];
  consumibles: { id: string; nombre: string; emoji: string; usos: number }[];
}
interface OfertaC {
  id: number;
  de: { id: string; nombre: string | null };
  para: { id: string; nombre: string | null } | null;
  padre: number | null;
  da: string[];
  pide: string[];
  daPaquete: Paquete;
  pidePaquete: Paquete;
  vence: number;
  mia: boolean;
}
interface EstadoComercio {
  activo: boolean;
  puede: string | null;
  maxAbiertas: number;
  mias: OfertaC[];
  paraMi: OfertaC[];
  abiertas: OfertaC[];
  inventario: InventarioC;
}
interface Borrador {
  para: { id: string; nombre: string } | null;
  padre: number | null;
  da: Paquete;
  pide: Paquete;
  lado: "da" | "pide";
  suyo: InventarioC | null;
}
const paqueteVacio = (): Paquete => ({ monedas: 0, xp: 0, niveles: 0, cuota: 0, sobres: { comun: 0, raro: 0, legendario: 0 }, objetos: [], consumibles: {} });
let comercioEstado: EstadoComercio | null = null;
let borrador: Borrador | null = null;

async function abrirComercio(nota = ""): Promise<void> {
  cargandoApp("comercio", "Comercio", "Intercambios entre Papus", "#FFA94D");
  try {
    comercioEstado = await pedir<EstadoComercio>("comercio", "estado");
    borrador = null;
    dibujarOfertas(nota);
  } catch (e) {
    if (pantalla === "comercio") error((e as Error).message);
  }
}

function tarjetaOferta(o: OfertaC, tipo: "paraMi" | "abierta" | "mia"): string {
  const quien = o.mia ? (o.para ? `Para ${esc(o.para.nombre ?? "un Papu")}` : "🌐 Abierta") : `De ${esc(o.de.nombre ?? "un Papu")}`;
  const botones =
    tipo === "mia"
      ? `<button class="boton suave chico" data-ret="${o.id}">Retirar</button>`
      : `<button class="boton chico" data-acc="${o.id}">Aceptar</button><button class="boton suave chico" data-con="${o.id}">Contraoferta</button>${tipo === "paraMi" ? `<button class="boton suave chico" data-rec="${o.id}">Rechazar</button>` : ""}`;
  return `<div class="carta"><div class="carta-cab"><span class="emoji">🤝</span><div><b>Oferta #${o.id}${o.padre ? ` · contraoferta a #${o.padre}` : ""}</b><small>${quien} · vence en ${enMin(o.vence)}</small></div></div>
    <div class="lados"><div><small>${o.mia ? "Entregas" : "Te da"}</small>${o.da.map((l) => `<p>${esc(l)}</p>`).join("") || "<p>—</p>"}</div><div><small>${o.mia ? "Pides" : "Te pide"}</small>${o.pide.map((l) => `<p>${esc(l)}</p>`).join("") || "<p>—</p>"}</div></div>
    <div class="botonera">${botones}</div></div>`;
}

function dibujarOfertas(nota = ""): void {
  const st = comercioEstado;
  if (pantalla !== "comercio" || !st) return;
  const seccion = (t: string, xs: OfertaC[], tipo: "paraMi" | "abierta" | "mia") => (xs.length ? `<div class="seccion">${t}</div><div class="cartas">${xs.map((o) => tarjetaOferta(o, tipo)).join("")}</div>` : "");
  app.innerHTML = `${cabeza("Comercio", "Intercambios entre Papus", "#FFA94D")}${nota ? `<div class="aviso-linea">${esc(nota)}</div>` : ""}
    ${st.puede ? `<div class="resultado"><pre>${esc(st.puede.replace(/\*\*/g, ""))}</pre></div>` : ""}
    ${seccion("Para ti", st.paraMi, "paraMi")}${seccion("Tuyas", st.mias, "mia")}${seccion("Abiertas a todos", st.abiertas, "abierta")}
    ${!st.paraMi.length && !st.mias.length && !st.abiertas.length ? `<div class="nota" style="margin-top:14px">No hay ofertas por ahora. ¡Arma la primera!</div>` : ""}
    <div class="acciones" style="grid-template-columns:1fr"><button class="boton" id="nueva" ${st.puede || !st.activo || st.mias.length >= st.maxAbiertas ? "disabled" : ""}>Nueva oferta</button></div>`;
  alVolver();
  app.querySelector("#nueva")?.addEventListener("click", () => {
    borrador = { para: null, padre: null, da: paqueteVacio(), pide: paqueteVacio(), lado: "da", suyo: null };
    dibujarBorrador();
  });
  const responder = async (id: string, accion: string) => {
    try {
      const r = await pedir<{ mensaje: string; estado: EstadoComercio }>("comercio", "responder", { id: Number(id), accion });
      comercioEstado = r.estado;
      dibujarOfertas(r.mensaje);
    } catch (e) {
      aviso((e as Error).message);
      void abrirComercio();
    }
  };
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-acc]")) dobleToque(b, () => void responder(b.dataset.acc!, "aceptar"), "¿Aceptar? No se deshace");
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-rec]")) dobleToque(b, () => void responder(b.dataset.rec!, "rechazar"));
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-ret]")) dobleToque(b, () => void responder(b.dataset.ret!, "retirar"));
  for (const b of app.querySelectorAll<HTMLButtonElement>("[data-con]")) {
    b.onclick = async () => {
      const o = [...st.paraMi, ...st.abiertas].find((x) => x.id === Number(b.dataset.con));
      if (!o) return;
      // Los lados al revés: lo que pidió es lo que tú entregarías.
      borrador = { para: { id: o.de.id, nombre: o.de.nombre ?? "un Papu" }, padre: o.id, da: structuredClone(o.pidePaquete), pide: structuredClone(o.daPaquete), lado: "da", suyo: null };
      await cargarSuyo();
      dibujarBorrador();
    };
  }
}

async function cargarSuyo(): Promise<void> {
  if (!borrador?.para) return;
  try {
    borrador.suyo = await pedir<InventarioC>("comercio", "inventario", { de: borrador.para.id });
  } catch (e) {
    aviso((e as Error).message);
  }
}

function dibujarBorrador(): void {
  const st = comercioEstado;
  const b = borrador;
  if (pantalla !== "comercio" || !st || !b) return;
  const inv = b.lado === "da" ? st.inventario : b.suyo;
  const p = b[b.lado];
  const quien = b.lado === "da" ? "Tienes" : `Tiene`;
  const paso = (clave: string, nombre: string, valor: number, max: number | null) =>
    `<div class="fila-dato"><span>${nombre}${max !== null ? `<small>${quien} ${fmtN(max)}</small>` : ""}</span><div class="paso"><button data-menos="${clave}" aria-label="Menos">−</button><input data-valor="${clave}" inputmode="numeric" value="${valor}" /><button data-mas="${clave}" aria-label="Más">+</button></div></div>`;
  const objetos = inv?.objetos.length
    ? `<div class="minis">${inv.objetos.map((o) => `<button data-obj="${esc(o.id)}" class="${p.objetos.includes(o.id) ? "puesto" : ""}"><img loading="lazy" src="api/mini/${esc(o.id)}" alt="" /><span>${esc(o.nombre)}</span></button>`).join("")}</div>`
    : `<p class="nota">${b.lado === "pide" && !b.para ? "En una oferta abierta solo se piden cantidades y sobres. Para pedir objetos, elige a un Papu." : "Sin objetos que se puedan cambiar."}</p>`;
  const consumibles = (inv?.consumibles ?? []).map((c) => paso(`c=${c.id}`, `${c.emoji} ${c.nombre}`, p.consumibles[c.id] ?? 0, c.usos)).join("");
  const resumen = (q: Paquete) => {
    const l: string[] = [];
    if (q.monedas) l.push(`${fmtN(q.monedas)} Shaulitas`);
    if (q.xp) l.push(`${fmtN(q.xp)} XP`);
    if (q.niveles) l.push(`${q.niveles} niveles`);
    if (q.cuota) l.push(`${q.cuota} mensajes de hoy`);
    for (const [t, n] of Object.entries(q.sobres)) if (n) l.push(`${n} sobre ${t}`);
    if (q.objetos.length) l.push(`${q.objetos.length} objetos`);
    for (const [, n] of Object.entries(q.consumibles)) if (n) l.push(`${n} usos de consumible`);
    return l.join(" · ") || "nada todavía";
  };
  app.innerHTML = `${cabeza(b.padre ? `Contraoferta a #${b.padre}` : "Nueva oferta", b.para ? `Para ${b.para.nombre}` : "🌐 Abierta: cualquier Papu la acepta", "#FFA94D")}
    <div class="fila-dato"><span>Para</span><div class="botonera" style="margin:0">${b.padre ? `<b>${esc(b.para?.nombre ?? "")}</b>` : `<button class="boton suave chico" id="para">${b.para ? esc(b.para.nombre) : "Elegir a un Papu"}</button>${b.para ? `<button class="boton suave chico" id="abierta">Hacerla abierta</button>` : ""}`}</div></div>
    <div class="resumen"><p><b>Entregas:</b> ${esc(resumen(b.da))}</p><p><b>Pides:</b> ${esc(resumen(b.pide))}</p></div>
    <div class="segmento"><button data-lado="da" class="${b.lado === "da" ? "activo" : ""}">Tu inventario (das)</button><button data-lado="pide" class="${b.lado === "pide" ? "activo" : ""}">${b.para ? `El de ${esc(b.para.nombre)} (pides)` : "Lo que pides"}</button></div>
    ${paso("monedas", "🪙 Shaulitas", p.monedas, inv?.monedas ?? null)}${paso("xp", "✨ XP", p.xp, inv?.xp ?? null)}${paso("niveles", "🆙 Niveles", p.niveles, inv?.niveles ?? null)}${paso("cuota", "💬 Mensajes de hoy", p.cuota, null)}
    ${paso("sobre:comun", "📦 Sobres comunes", p.sobres.comun, inv?.sobres.comun ?? null)}${paso("sobre:raro", "💜 Sobres raros", p.sobres.raro, inv?.sobres.raro ?? null)}${paso("sobre:legendario", "💛 Sobres legendarios", p.sobres.legendario, inv?.sobres.legendario ?? null)}
    ${consumibles}
    <div class="seccion">Objetos</div>${objetos}
    <div class="acciones"><button class="boton suave" id="cancelar">Cancelar</button><button class="boton" id="publicar">Publicar</button></div>`;
  alVolver();
  const leer = (clave: string): number => {
    if (clave.startsWith("sobre:")) return p.sobres[clave.slice(6) as keyof Paquete["sobres"]];
    if (clave.startsWith("c=")) return p.consumibles[clave.slice(2)] ?? 0;
    return p[clave as "monedas" | "xp" | "niveles" | "cuota"];
  };
  const poner = (clave: string, v: number) => {
    const n = Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
    if (clave.startsWith("sobre:")) p.sobres[clave.slice(6) as keyof Paquete["sobres"]] = n;
    else if (clave.startsWith("c=")) p.consumibles[clave.slice(2)] = n;
    else p[clave as "monedas" | "xp" | "niveles" | "cuota"] = n;
  };
  const salto = (clave: string) => (clave === "monedas" ? 50 : clave === "xp" ? 100 : 1);
  for (const x of app.querySelectorAll<HTMLButtonElement>("[data-menos]")) x.onclick = () => (poner(x.dataset.menos!, leer(x.dataset.menos!) - salto(x.dataset.menos!)), dibujarBorrador());
  for (const x of app.querySelectorAll<HTMLButtonElement>("[data-mas]")) x.onclick = () => (poner(x.dataset.mas!, leer(x.dataset.mas!) + salto(x.dataset.mas!)), dibujarBorrador());
  for (const x of app.querySelectorAll<HTMLInputElement>("[data-valor]")) x.onchange = () => (poner(x.dataset.valor!, Number(x.value.replace(/\D/g, ""))), dibujarBorrador());
  for (const x of app.querySelectorAll<HTMLButtonElement>("[data-obj]")) {
    x.onclick = () => {
      const id = x.dataset.obj!;
      p.objetos = p.objetos.includes(id) ? p.objetos.filter((o) => o !== id) : [...p.objetos, id];
      dibujarBorrador();
    };
  }
  for (const x of app.querySelectorAll<HTMLButtonElement>("[data-lado]")) x.onclick = () => ((b.lado = x.dataset.lado as Borrador["lado"]), dibujarBorrador());
  app.querySelector("#para")?.addEventListener("click", () =>
    elegirPapu("¿A quién se la ofreces?", async (papu) => {
      b.para = papu;
      b.pide.objetos = [];
      await cargarSuyo();
      dibujarBorrador();
    }),
  );
  app.querySelector("#abierta")?.addEventListener("click", () => ((b.para = null), (b.suyo = null), (b.pide.objetos = []), dibujarBorrador()));
  app.querySelector("#cancelar")?.addEventListener("click", () => ((borrador = null), dibujarOfertas()));
  const pub = app.querySelector<HTMLButtonElement>("#publicar");
  if (pub) {
    dobleToque(pub, async () => {
      try {
        const r = await pedir<{ mensaje: string; estado: EstadoComercio }>("comercio", "publicar", { para: b.para?.id ?? null, padre: b.padre, da: b.da, pide: b.pide });
        comercioEstado = r.estado;
        borrador = null;
        dibujarOfertas(r.mensaje);
      } catch (e) {
        aviso((e as Error).message);
        pub.disabled = false;
      }
    }, "¿Publicar?");
  }
}

iniciar().catch((e: Error) => error(e.message || "No pude prender el celular."));
