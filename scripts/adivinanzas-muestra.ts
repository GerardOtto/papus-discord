// Muestra de los banners de «¡Adivina, Papu!» con adivinanzas reales del banco (PLAN §3.17).
//   npm run adivinanzas:muestra   → docs/propuestas/adivinanzas/muestras/*.png
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bannerAdivinanza, bannerGanador, bannerNadie } from "../src/adivinanzas/images";
import { CATEGORIAS, letrasPista, loadAdivinanzasSettings, loadBanco, pozo } from "../src/adivinanzas/rules";
import { avatarFile } from "../src/peleas/images";

const OUT = path.resolve(import.meta.dirname, "../docs/propuestas/adivinanzas/muestras");
mkdirSync(OUT, { recursive: true });
const s = loadAdivinanzasSettings();
const { adivinanzas } = loadBanco();
const marcas = { palabras: s.pistas.palabras, tope: s.subidaSeg, letras: s.pistas.letras };
const emoji = adivinanzas.find((a) => a.t.includes("es esta?"))!;
const tc = adivinanzas.find((a) => a.c === "tetociencia")!;
writeFileSync(path.join(OUT, "emoji-pista1.png"), await bannerAdivinanza({ avatar: readFileSync(avatarFile("miku")), nombre: "Miku", color: "#39C5BB", categoria: CATEGORIAS[emoji.c], texto: emoji.t, pozo: pozo(s, 7_000, false), pozoMax: 150, bote: 0, ms: 7_000, totalMs: s.duracionSeg * 1000, marcas, pista: `PISTA 1: ${emoji.p}`, dorada: false }));
writeFileSync(path.join(OUT, "tetociencia-letras.png"), await bannerAdivinanza({ avatar: readFileSync(avatarFile("teto")), nombre: "Teto", color: "#D23246", categoria: CATEGORIAS[tc.c], texto: tc.t, pozo: pozo(s, 12_000, false) + 50, pozoMax: 200, bote: 50, ms: 12_000, totalMs: s.duracionSeg * 1000, marcas, pista: `PISTA 2:  ${letrasPista(tc.r[0]!)}`, dorada: false }));
writeFileSync(path.join(OUT, "ganador.png"), await bannerGanador({ avatar: readFileSync(avatarFile("gumi")), color: "#6CC24A", papu: "ZanahoriaLover", respuesta: tc.r[0]!, tiempo: "1:12", premio: 150, hoy: 2, dorada: false }));
writeFileSync(path.join(OUT, "nadie.png"), await bannerNadie({ avatar: readFileSync(avatarFile("luka")), color: "#E285B2", respuesta: emoji.r[0]!, frase: "Treinta segundos y ni uno la sacó… qué vergüenza, Papus 😔", bote: 50 }));
console.log("ok", OUT);
