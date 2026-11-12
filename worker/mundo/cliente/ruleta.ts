// Ruleta grande de la plaza (PLAN §3.3 y §3.10): la rueda con las casillas de config/ruleta.json (las mismas del GIF
// de Discord), el giro a saltos (stop-motion) y la ventana con las misiones, las tiradas y el boton de girar. El premio
// lo decide el bot al girar; aqui solo se muestra. Los giros de la plaza y de Discord se ven de a uno (cola en la sala).
import * as THREE from "three";
import { anguloFinal, GIRO_MS, type Casilla, type Giro, type RuletaEstado } from "../../src/mundo/acciones";
import type { GiroEnCurso } from "../../src/mundo/tipos";

/** Lo que tarda la rueda en detenerse (el resto del giro, el premio queda a la vista). */
export const VUELTA_MS = 5600;
/** Cuadros por segundo del giro (stop-motion, como el resto de la plaza). */
const CUADROS = 12;

/** Casillas mientras no llega la foto del servidor (solo decorado). */
const DECORADO: Casilla[] = ["#39c5bb", "#d64f6b", "#e07bb5", "#e8b923", "#8c5cff", "#3ddc84", "#ff9f1c", "#f15bb5", "#36c5f0"].map((color) => ({
  icono: "⭐",
  etiqueta: "",
  color,
  nombre: "",
}));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Textura de la rueda: casillas en el sentido del reloj desde arriba, con su emoji y su etiqueta hacia afuera. */
function textura(casillas: Casilla[]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  const n = casillas.length;
  const paso = (Math.PI * 2) / n;
  g.translate(512, 512);
  casillas.forEach((k, i) => {
    const a0 = -Math.PI / 2 + i * paso;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 512, a0, a0 + paso);
    g.closePath();
    g.fillStyle = k.color;
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 8;
    g.stroke();
    // Texto a lo largo del radio, leyendo desde afuera hacia el centro.
    g.save();
    g.rotate(a0 + paso / 2);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "92px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
    g.translate(370, 0);
    g.rotate(Math.PI / 2);
    g.fillText(k.icono.length > 4 ? k.icono.slice(0, 4) : k.icono, 0, 0, 200);
    if (k.etiqueta) {
      g.font = "bold 64px Fredoka, 'Segoe UI', sans-serif";
      g.lineWidth = 10;
      g.strokeStyle = "#111833";
      g.fillStyle = "#ffffff";
      g.strokeText(k.etiqueta, 0, 100, 220);
      g.fillText(k.etiqueta, 0, 100, 220);
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** La rueda de la plaza: casillas y giro animado. */
export class RuedaPlaza {
  private casillas: Casilla[] = [];
  private huella = "";
  /** Giro que se esta mostrando: desde que angulo, hacia cual y cuando empezo (reloj de esta pagina). */
  private giro: { desde: number; hasta: number; inicio: number; datos: Giro } | null = null;

  constructor(private readonly rueda: THREE.Mesh<THREE.CircleGeometry, THREE.MeshLambertMaterial>) {
    this.ponerCasillas(DECORADO);
  }

  get objeto(): THREE.Object3D {
    return this.rueda;
  }

  /** Casillas de la foto del servidor (solo redibuja si cambiaron). */
  ponerCasillas(casillas: Casilla[]): void {
    if (!casillas.length) return;
    const h = JSON.stringify(casillas);
    if (h === this.huella) return;
    this.huella = h;
    this.casillas = casillas;
    const vieja = this.rueda.material.map;
    this.rueda.material.map = textura(casillas);
    this.rueda.material.needsUpdate = true;
    vieja?.dispose();
  }

  /** Empieza (o retoma, si se entro a medio giro) a mostrar un giro. */
  girar(g: GiroEnCurso, ahora: number): void {
    if (this.giro && this.giro.datos.papu === g.papu && this.giro.datos.index === g.index && this.giro.datos.origen === g.origen) return;
    const n = this.casillas.length || 1;
    const desde = this.rueda.rotation.z % (Math.PI * 2);
    const yaPaso = GIRO_MS - g.restanteMs;
    this.giro = { desde, hasta: anguloFinal(g.index % n, n), inicio: ahora - yaPaso, datos: g };
  }

  /** Lo que esta mostrando: el giro y si ya se detuvo. */
  estado(ahora: number): { giro: Giro; detenida: boolean } | null {
    return this.giro ? { giro: this.giro.datos, detenida: ahora - this.giro.inicio >= VUELTA_MS } : null;
  }

  /** Termino el giro (la sala paso al siguiente o la fila quedo vacia). La rueda se queda donde paro. */
  soltar(): void {
    this.giro = null;
  }

  actualizar(ahora: number): void {
    if (!this.giro) return;
    // A saltos: el tiempo avanza en cuadros de 1/12 s. Frenado suave (cubica) hasta la casilla ganadora.
    const t = Math.min(1, Math.floor(((ahora - this.giro.inicio) / 1000) * CUADROS) / CUADROS / (VUELTA_MS / 1000));
    const k = 1 - (1 - t) ** 3;
    this.rueda.rotation.z = this.giro.desde + (this.giro.hasta - this.giro.desde) * k;
  }
}

// ───────────────────────── ventana ─────────────────────────

export interface VistaRuleta {
  estado: RuletaEstado | null;
  /** Mensaje de error al pedir el panel (sin conexion con el bot, modo de prueba…). */
  error?: string;
  /** Lo que pasa con mi giro: pidiendo, en la fila (puesto), girando o el premio. */
  mio?: { fase: "pidiendo" } | { fase: "fila"; puesto: number } | { fase: "girando" } | { fase: "premio"; giro: Giro } | { fase: "error"; motivo: string };
  /** Quien gira ahora en la ruleta grande y cuantos esperan. */
  ahora: { nombre: string; origen: Giro["origen"] } | null;
  fila: number;
}

const barra = (actual: number, meta: number) => `<span class="barra"><span style="width:${Math.round(Math.min(1, actual / Math.max(1, meta)) * 100)}%"></span></span>`;

/** HTML del cuerpo de la ventana de la ruleta (main.ts lo pone en la ventana y conecta el boton). */
export function htmlRuleta(v: VistaRuleta): string {
  if (v.error) return `<p class="v-error">${esc(v.error)}</p>`;
  const e = v.estado;
  if (!e) return `<p class="v-cargando">Preguntándole a Teto por tus misiones… 🎰</p>`;
  const soloLectura = e.soloLectura === true;
  const simulacion = e.simulacion === true;
  const sandbox = e.sandbox === true;
  const cabeza = e.bloqueada
    ? `<span class="v-chip rojo">🚫 Neru te dio un machetazo: sin ruleta por ahora</span>`
    : sandbox
      ? `<span class="v-chip">🧪 Progreso aislado · no afecta Discord</span>`
      : simulacion
        ? `<span class="v-chip">🧪 Simulación · sin premios reales</span>`
      : soloLectura
        ? `<span class="v-chip">📋 Progreso real · vista previa</span>`
      : e.tiradas > 0
        ? `<span class="v-chip verde">🎟️ ${e.tiradas} ${e.tiradas === 1 ? "tirada" : "tiradas"} para hoy</span>`
        : `<span class="v-chip">${e.usadas >= e.misiones.length ? "¡Ya giraste todas las de hoy! Vuelven mañana." : "Cumple una misión y gana una tirada"}</span>`;
  const misiones = e.misiones
    .map(
      (m) => `<li class="v-mision${m.hecha ? " hecha" : ""}">
        <span class="v-icono">${m.icono}</span>
        <span class="v-mision-texto"><b>${esc(m.nombre)}</b>${barra(m.actual, m.meta)}</span>
        <span class="v-avance">${m.hecha ? "✅" : m.meta > 1 ? `${m.actual}/${m.meta}` : "pendiente"}</span>
      </li>`,
    )
    .join("");
  const casillas = e.casillas.map((c) => `<li style="--c:${esc(c.color)}" title="${esc(c.nombre)}"><span>${esc(c.icono)}</span>${esc(c.etiqueta)}</li>`).join("");
  const extras = e.extras.map((x) => `<p class="v-nota">${esc(x)}</p>`).join("");
  const mio = v.mio;
  const estadoGiro =
    mio?.fase === "pidiendo"
      ? `<p class="v-estado">🎰 Girando…</p>`
      : mio?.fase === "fila"
        ? `<p class="v-estado">⏳ Estás en la fila: ${mio.puesto === 1 ? "eres el siguiente" : `puesto ${mio.puesto}`}. Tu premio ya está decidido; mira la ruleta.</p>`
        : mio?.fase === "girando"
          ? `<p class="v-estado">👀 ¡Tu giro está en la ruleta grande!</p>`
          : mio?.fase === "premio"
            ? `<div class="v-premio"><p class="v-premio-titulo">${esc(mio.giro.titulo)}</p><p>${esc(mio.giro.subtitulo)}</p></div>`
            : mio?.fase === "error"
              ? `<p class="v-error">${esc(mio.motivo)}</p>`
              : "";
  const ocupada = v.ahora ? `<p class="v-nota">🎡 Girando ahora: <b>${esc(v.ahora.nombre)}</b>${v.ahora.origen === "discord" ? " (desde Discord)" : ""}${v.fila ? ` · ${v.fila} en la fila` : ""}</p>` : "";
  const puede = !e.bloqueada && !["pidiendo", "fila", "girando"].includes(mio?.fase ?? "") && (simulacion || (!soloLectura && e.tiradas > 0));
  const premios = soloLectura && !simulacion ? "" : `<h3 class="v-seccion">${sandbox ? "Premios del entorno de prueba" : simulacion ? "Casillas de demostración" : "Premios"}</h3><ul class="v-casillas">${casillas}</ul>`;
  const controles = soloLectura && !simulacion ? "" : `${estadoGiro}${ocupada}
    ${e.atunPendiente ? `<span class="v-chip">🐟 Premio reservado: ${esc(e.atunPendiente.premio ?? "Premio pendiente")} · ${e.atunPendiente.aplicado === false ? "sin acreditar" : "ya acreditado"}</span><button class="v-boton" data-accion="aceptar-atun">✓ Aceptar premio</button>` : ""}${e.atunPendiente?.girosRestantes ? `<button class="v-boton" data-accion="descartar-atun">🐟 Descartar premio y volver a girar (${e.atunPendiente.girosRestantes})</button>` : ""}
    ${!e.atunPendiente ? `<button class="v-boton" data-accion="girar" ${puede ? "" : "disabled"}>🎰 ${simulacion ? "Probar giro" : puede ? `Girar (${e.tiradas})` : "Sin tiradas"}</button>` : ""}`;
  const pie = sandbox
    ? "Las tiradas consumen las misiones disponibles y aplican XP, sobres o cuota al progreso aislado de la Plaza. Los cambios persisten en el preview, pero nunca modifican tu cuenta de Discord."
    : simulacion
      ? "Puedes probar la animación con premios de demostración. No se consume una tirada, no se entrega el premio y no cambia tu progreso."
    : soloLectura
      ? "El avance se consulta desde la base original. Esta vista previa es de solo lectura: no consume tiradas ni modifica XP o recompensas."
    : `Una tirada por misión, hasta ${e.misiones.length} al día; se reinician a medianoche (hora de Chile). Premios: XP, mensajes extra con los Vocaloids por hoy (con tu cuota llena, se vuelven XP) y sobres. Si alguien más está girando, tu giro espera su turno.`;
  return `
    <div class="v-cabeza">${cabeza}</div>
    <h3 class="v-seccion">Misiones de hoy</h3>
    <ul class="v-misiones">${misiones}</ul>
    ${extras}
    ${premios}
    ${controles}
    <p class="v-pie">${pie}</p>`;
}

/** Texto sobre la rueda: quien gira (y despues su premio) y quienes esperan. */
export function htmlSobreRueda(actual: Giro | null, detenida: boolean, cola: { nombre: string }[]): string {
  if (!actual) return "🎰 Ruleta grande · escribe /ruleta";
  const quien = `${esc(actual.nombre)}${actual.origen === "discord" ? " <small>(Discord)</small>" : ""}`;
  const arriba = detenida ? `${quien}: <b>${esc(actual.titulo)}</b>` : `🎰 Gira ${quien}…`;
  const fila = cola.length ? `<br><small>Siguen: ${cola.slice(0, 3).map((c) => esc(c.nombre)).join(", ")}${cola.length > 3 ? ` y ${cola.length - 3} más` : ""}</small>` : "";
  return arriba + fila;
}
