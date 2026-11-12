// Pagina de la trivia multijugador (Actividad de Discord de Teto). Sin framework: recibe la vista de la sala por
// WebSocket y la dibuja. Fuera de Discord (wrangler dev con ACTIVIDAD_PRUEBA=1) pide un nombre para probar.
// Las animaciones de entrada solo corren la primera vez que se dibuja cada pantalla (clase "anim"): la sala se
// redibuja cada vez que alguien contesta y no debe parpadear.
import { DiscordSDK } from "@discord/embedded-app-sdk";
import type { Eleccion, Pedido, Vista } from "../../src/actividad/tipos";
import { esc, estado, fin, pregunta, sala } from "./vistas";

const app = document.getElementById("app")!;

let ws: WebSocket | null = null;
let vista: Vista | null = null;
let recibida = 0;
let audio: HTMLAudioElement | null = null;
let mediaNonce = "";
let mediaNodo: HTMLElement | null = null;
/** Pantalla dibujada (fase + pregunta) y caras ya mostradas en las opciones, para animar solo lo nuevo. */
let pantalla = "";

function mostrarError(texto: string): void {
  app.innerHTML = `<div class="espera"><img src="teto-shock.webp" alt="" /><h1 class="titulo">Trivia <span class="rosa">Vocaloid</span></h1></div><p class="error">${esc(texto)}</p>`;
}

function enviar(p: Pedido): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(p));
}

// ───────────────────────── conexion ─────────────────────────

async function iniciar(): Promise<void> {
  const cfg = (await fetch("api/config").then((r) => r.json())) as { clientId: string | null; prueba: boolean };
  estado.dificultades = await fetch("dificultades.json").then((r) => r.json()).catch(() => estado.dificultades);
  const params = new URLSearchParams(location.search);
  const enDiscord = params.has("frame_id");
  let hola: Pedido;
  let instancia: string;
  let canal = "";
  if (enDiscord) {
    if (!cfg.clientId) return mostrarError("La Actividad aún no está configurada.");
    const sdk = new DiscordSDK(cfg.clientId);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({ client_id: cfg.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds.members.read"] });
    const tok = (await fetch("api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).then((r) => r.json())) as { access_token?: string; error?: string };
    if (!tok.access_token) return mostrarError(tok.error ?? "Discord no me dejó entrar.");
    await sdk.commands.authenticate({ access_token: tok.access_token });
    hola = { t: "hola", token: tok.access_token };
    instancia = sdk.instanceId;
    canal = sdk.channelId ?? "";
  } else if (cfg.prueba) {
    const nombre = prompt("Modo de prueba: ¿tu nombre?") || "Papu";
    hola = { t: "hola", prueba: { id: `prueba-${nombre.replace(/\\W/g, "").slice(0, 12) || "papu"}`, nombre } };
    instancia = params.get("sala") ?? "prueba";
  } else {
    // Desde la Plaza web: SalaTrivia valida la cookie HttpOnly de la sesion OAuth.
    // Todos comparten la instancia "plaza" salvo que se indique otra en la URL.
    hola = { t: "hola" };
    instancia = params.get("sala") ?? "plaza";
  }
  conectar(instancia, canal, hola, 0);
}

function conectar(instancia: string, canal: string, hola: Pedido, intento: number): void {
  const url = new URL(`api/sala?instancia=${encodeURIComponent(instancia)}&canal=${encodeURIComponent(canal)}`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(url);
  ws.onopen = () => ws!.send(JSON.stringify(hola));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { vista?: Vista; error?: string; aviso?: string };
    if (m.error) return mostrarError(m.error);
    if (m.aviso) estado.aviso = m.aviso;
    if (m.vista) {
      vista = m.vista;
      recibida = performance.now();
      intento = 0;
      dibujar();
    }
  };
  ws.onclose = () => {
    if (intento > 5) return mostrarError("Se cortó la conexión con la sala. Cierra y vuelve a abrir la Actividad.");
    setTimeout(() => conectar(instancia, canal, hola, intento + 1), 800 * (intento + 1));
  };
}

function confeti(): void {
  const capa = document.createElement("div");
  capa.className = "confeti";
  const colores = ["#3d7bff", "#39c5bb", "#e5323f", "#f6c744", "#e285b2"];
  for (let k = 0; k < 60; k++) {
    const i = document.createElement("i");
    i.style.left = `${Math.random() * 100}%`;
    i.style.background = colores[k % colores.length]!;
    i.style.animationDuration = `${2 + Math.random() * 2}s`;
    i.style.animationDelay = `${Math.random() * 0.8}s`;
    capa.append(i);
  }
  document.body.append(capa);
  setTimeout(() => capa.remove(), 5000);
}

/** Imagen o audio de la pregunta: se crea una sola vez por pregunta (no se recarga con cada cambio de la sala). */
function media(v: Vista): void {
  const p = v.pregunta;
  const hueco = document.getElementById("media");
  if (!p || !hueco) return;
  if (p.nonce !== mediaNonce) {
    mediaNonce = p.nonce;
    audio?.pause();
    audio = null;
    mediaNodo = null;
    if (p.media?.tipo === "imagen") {
      mediaNodo = document.createElement("div");
      mediaNodo.className = "media";
      mediaNodo.innerHTML = `<img src="${esc(p.media.url)}" alt="" />`;
    } else if (p.media?.tipo === "audio") {
      audio = new Audio(p.media.url);
      mediaNodo = document.createElement("div");
      mediaNodo.className = "media";
      mediaNodo.innerHTML = `<div class="disco"></div>`;
      const boton = document.createElement("button");
      boton.className = "azul";
      boton.textContent = "▶️ Escuchar de nuevo";
      boton.onclick = () => {
        audio!.currentTime = 0;
        void audio!.play();
      };
      mediaNodo.append(boton);
      // Si el navegador no deja sonar solo, el boton lo hace.
      audio.play().catch(() => (boton.textContent = "▶️ Escuchar"));
    }
  }
  if (mediaNodo) hueco.replaceWith(mediaNodo);
}

function dibujar(): void {
  const v = vista;
  if (!v) return;
  const input = document.getElementById("texto") as HTMLInputElement | null;
  const escrito = input?.value ?? "";
  const foco = document.activeElement === input;
  const clave = `${v.fase}:${v.pregunta?.nonce ?? ""}`;
  const nueva = clave !== pantalla;
  if (nueva && v.fase === "pregunta") estado.caras = new Set();
  app.innerHTML = v.fase === "sala" ? sala(v) : v.fase === "fin" ? fin(v) : pregunta(v);
  app.classList.toggle("anim", nueva);
  if (nueva && v.fase === "fin" && (v.fin?.motivo === "ganador" || v.fin?.motivo === "sin-preguntas" || (v.fin?.ganador ?? "") === v.yo)) confeti();
  pantalla = clave;
  if (v.fase !== "pregunta" && v.fase !== "revelar") {
    audio?.pause();
    mediaNonce = "";
  }
  media(v);
  const nuevo = document.getElementById("texto") as HTMLInputElement | null;
  if (nuevo) {
    nuevo.value = escrito;
    if (foco || !escrito) nuevo.focus();
  }
  reloj();
}

function reloj(): void {
  const v = vista;
  const barra = document.getElementById("tiempo");
  const seg = document.getElementById("segundos");
  if (!v?.pregunta || !barra || !seg) return;
  const pasado = performance.now() - recibida;
  if (v.revelar) {
    barra.style.visibility = "hidden";
    seg.textContent = `Siguiente en ${Math.ceil(Math.max(0, v.revelar.restante - pasado) / 1000)} s`;
    return;
  }
  const resta = Math.max(0, v.pregunta.restante - pasado);
  (barra.firstElementChild as HTMLElement).style.width = `${(resta / (v.pregunta.segundos * 1000)) * 100}%`;
  barra.classList.toggle("poco", resta < 5000);
  seg.textContent = `⏳ ${Math.ceil(resta / 1000)} s`;
}
setInterval(reloj, 250);

// ───────────────────────── clics ─────────────────────────

app.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b || b.disabled || !vista) return;
  if (b.dataset.opcion !== undefined && vista.pregunta) enviar({ t: "responder", nonce: vista.pregunta.nonce, opcion: Number(b.dataset.opcion) });
  else if (b.dataset.modo) enviar({ t: "configurar", modo: b.dataset.modo as Vista["modo"] });
  else if (b.dataset.eleccion) enviar({ t: "configurar", eleccion: b.dataset.eleccion as Eleccion });
  else if (b.dataset.accion === "empezar") (estado.aviso = ""), enviar({ t: "empezar" });
  else if (b.dataset.accion === "otra") enviar({ t: "otra" });
  else if (b.dataset.consumible && vista?.pregunta) {
    const tema = (document.getElementById("tema-zanahoria") as HTMLSelectElement | null)?.value;
    enviar({ t: "consumible", objeto: b.dataset.consumible as "celular" | "guitarra" | "zanahoria", nonce: vista.pregunta.nonce, ...(tema ? { tema } : {}) });
  }
});

app.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("texto") as HTMLInputElement | null;
  const texto = input?.value.trim();
  if (texto && vista?.pregunta) {
    enviar({ t: "responder", nonce: vista.pregunta.nonce, texto });
    input!.value = "";
  }
});

iniciar().catch((e) => mostrarError(`No pude abrir la trivia: ${e?.message ?? e}`));
