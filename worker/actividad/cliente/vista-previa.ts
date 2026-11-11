// Vista previa del arte de la trivia multijugador con datos de ejemplo (sin sala ni Discord). Solo para revisar el
// diseño: npm run actividad:vista arma la pagina y sus capturas en una carpeta temporal; nunca se publica.
import type { JugadorVista, Vista } from "../../src/actividad/tipos";
import { fin, pregunta, sala } from "./vistas";

const app = document.getElementById("app")!;
const j = (id: string, nombre: string, extra: Partial<JugadorVista> = {}): JugadorVista => ({
  id,
  nombre,
  avatar: `av-${id}.png`,
  conectado: true,
  juega: true,
  vivo: true,
  fallo: false,
  racha: 0,
  aciertos: 0,
  xp: 0,
  respondio: false,
  ...extra,
});
const base = (extra: Partial<Vista>): Vista => ({
  fase: "sala",
  modo: "eliminatoria",
  eleccion: "mezcla",
  host: "teto",
  yo: "teto",
  jugadores: [j("teto", "GyroP"), j("miku", "Wicho el Bicho"), j("luka", "wiwi"), j("neru", "Mango9374")],
  disponibles: { mezcla: 5733, facil: 2025, medio: 2773, dificil: 935 },
  ...extra,
});
const opciones = ["Kasane Teto", "Hatsune Miku", "Akita Neru", "Megurine Luka"];

const ESTADOS: Record<string, Vista> = {
  sala: base({}),
  "sala-invitado": base({ yo: "miku", modo: "cooperativo", eleccion: "facil" }),
  pregunta: base({
    fase: "pregunta",
    jugadores: [j("teto", "GyroP", { racha: 3, respondio: true }), j("miku", "Wicho el Bicho", { respondio: true }), j("luka", "wiwi"), j("neru", "Mango9374", { vivo: false })],
    pregunta: { n: 4, nonce: "a", dificultad: "medio", tipo: "opciones", texto: "👾 Pixelado a propósito. ¿Quién es?", opciones, media: { tipo: "imagen", url: "muestra.webp" }, segundos: 20, restante: 12_000, elecciones: [["teto"], [], ["miku"], []] },
  }),
  acierto: base({
    fase: "revelar",
    jugadores: [j("teto", "GyroP", { racha: 4, aciertos: 4, xp: 112 }), j("miku", "Wicho el Bicho", { aciertos: 3, xp: 80 }), j("luka", "wiwi", { aciertos: 3, xp: 75 }), j("neru", "Mango9374", { vivo: false, aciertos: 1, xp: 20 })],
    pregunta: { n: 4, nonce: "a", dificultad: "medio", tipo: "opciones", texto: "🎧 ¿Qué canción es este fragmento?", opciones: ["Senbonzakura", "Luka Luka★Night Fever", "Ghost Rule", "Dancing Samurai"], media: { tipo: "audio", url: "" }, segundos: 30, restante: 0, elecciones: [[], ["teto", "luka"], ["miku"], []] },
    revelar: { correcta: 1, respuesta: "Luka Luka★Night Fever", dato: "Era «Luka Luka★Night Fever», de **samfree**, con Megurine Luka.", resultados: { teto: { ok: true, xp: 28, opcion: 1 }, luka: { ok: true, xp: 25, opcion: 1 }, miku: { ok: false, xp: 0, opcion: 2 } }, caen: ["miku"], nadieCae: false, restante: 5000 },
  }),
  texto: base({
    fase: "revelar",
    yo: "miku",
    modo: "cooperativo",
    jugadores: [j("teto", "GyroP", { aciertos: 2, xp: 50 }), j("miku", "Wicho el Bicho", { fallo: true, aciertos: 1, xp: 25 }), j("luka", "wiwi", { aciertos: 2, xp: 48 })],
    pregunta: { n: 3, nonce: "b", dificultad: "facil", tipo: "texto", texto: "Tengo taladros en el pelo y me encanta el pan. ¿Quién soy?", opciones: [], segundos: 45, restante: 0, elecciones: [] },
    revelar: { correcta: -1, respuesta: "Kasane Teto", resultados: { teto: { ok: true, xp: 25, texto: "teto" }, miku: { ok: false, xp: 0, texto: "miku" }, luka: { ok: true, xp: 23, texto: "kasane teto" } }, caen: [], nadieCae: false, restante: 4000 },
  }),
  escribir: base({
    fase: "pregunta",
    modo: "cooperativo",
    jugadores: [j("teto", "GyroP", { racha: 2 }), j("miku", "Wicho el Bicho", { respondio: true }), j("luka", "wiwi", { fallo: true })],
    pregunta: { n: 2, nonce: "c", dificultad: "dificil", tipo: "texto", texto: "✍️🎧 Escribe el nombre de esta canción.", opciones: [], media: { tipo: "audio", url: "" }, segundos: 45, restante: 3_000, elecciones: [] },
  }),
  fin: base({
    fase: "fin",
    jugadores: [j("teto", "GyroP", { aciertos: 7, xp: 210 }), j("miku", "Wicho el Bicho", { vivo: false, aciertos: 6, xp: 170 }), j("luka", "wiwi", { vivo: false, aciertos: 4, xp: 98 }), j("neru", "Mango9374", { vivo: false, aciertos: 1, xp: 20 })],
    fin: { motivo: "ganador", ganador: "teto", preguntas: 8 },
  }),
};

const e = location.hash.slice(1) || "sala";
const v = ESTADOS[e]!;
app.innerHTML = v.fase === "sala" ? sala(v) : v.fase === "fin" ? fin(v) : pregunta(v);
app.classList.add("quieto");
// La barra de tiempo y la imagen o el disco de audio, como los dibuja main.ts.
const barra = document.getElementById("tiempo");
if (barra && v.pregunta && !v.revelar) {
  (barra.firstElementChild as HTMLElement).style.width = `${(v.pregunta.restante / (v.pregunta.segundos * 1000)) * 100}%`;
  barra.classList.toggle("poco", v.pregunta.restante < 5000);
  document.getElementById("segundos")!.textContent = `⏳ ${Math.ceil(v.pregunta.restante / 1000)} s`;
} else if (barra && v.revelar) {
  barra.style.visibility = "hidden";
  document.getElementById("segundos")!.textContent = "Siguiente en 5 s";
}
const hueco = document.getElementById("media");
if (hueco && v.pregunta?.media) {
  const m = document.createElement("div");
  m.className = "media";
  m.innerHTML = v.pregunta.media.tipo === "imagen" ? `<img src="${v.pregunta.media.url}" alt="" />` : `<div class="disco"></div><button class="azul">▶️ Escuchar de nuevo</button>`;
  hueco.replaceWith(m);
}
