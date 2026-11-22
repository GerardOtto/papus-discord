// Vista previa de las imagenes de las carreras (PLAN §3.14) con datos de ejemplo: las 3 versiones del banner
// «¡Se abren las apuestas!», una lanzada por un Papu con membresia y el podio con patrocinadores.
//   npm run carreras:banners   → docs/propuestas/carreras/banners/*.png
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bannerApuestas, bannerPodio, repartirApostadores, VERSIONES_APUESTAS, type Apostador, type Corredor, type PodioCorredor } from "../src/carreras/images";
import { marcoDe } from "../src/membresias/marco";
import { loadMembresiaSettings } from "../src/membresias/rules";
import { avatarFile } from "../src/peleas/images";

const OUT = path.resolve(import.meta.dirname, "../docs/propuestas/carreras/banners");
mkdirSync(OUT, { recursive: true });

const corredor = (id: string, nombre: string, color: string): Corredor & { id: string } => ({ id, nombre, color, avatar: readFileSync(avatarFile(id)) });
const corredores = [
  corredor("teto", "Teto", "#D23246"),
  corredor("miku", "Miku", "#39C5BB"),
  corredor("neru", "Neru", "#E8C21A"),
  corredor("kaito", "Kaito", "#3B5BDB"),
  corredor("gumi", "Gumi", "#6CC24A"),
  corredor("pina", "Piña", "#F6BE32"),
];

const niveles = loadMembresiaSettings().niveles;

for (const version of VERSIONES_APUESTAS) {
  writeFileSync(path.join(OUT, `apuestas-${version}.png`), await bannerApuestas({ version, corredores, hora: "17:40", minutos: 5 }));
  console.log(`ok apuestas-${version}.png`);
}
writeFileSync(
  path.join(OUT, "apuestas-lanzada-triple-baka.png"),
  await bannerApuestas({ version: "euforia", corredores, hora: "19:10", minutos: 5, membresia: marcoDe(niveles[4]) }),
);
console.log("ok apuestas-lanzada-triple-baka.png");

// Podio de ejemplo: gana Miku, 2.ª Gumi, 3.ª Teto. Papus inventados; de icono, emojis del servidor (como si fueran sus
// iconos de Discord) y algunos sin icono (sale su inicial).
const icono = (f: string | null) => (f ? readFileSync(path.resolve(import.meta.dirname, "../assets/emojis/gratis", f)) : null);
const papu = (nombre: string, nivel: number, avatar: string | null): Apostador => ({ nombre, nivel, avatar: icono(avatar), marco: nivel >= 0 ? marcoDe(niveles[nivel]) : undefined });
const a = papu("ElBurrero99", 4, "gato_pulgar.png"), b = papu("MikuMikuBeam", 2, "miku_feliz.png"), c = papu("TetoTerritory", 3, "teto_hola.png");
const d = papu("PuerroPower", 0, "pera.png"), e = papu("AtunConMayo", 1, null), f = papu("NeruNoPerdona", 3, "neru_jeje.png");
const g = papu("KaitoHeladero", 0, "kaito.png");
const sin = ["gato_nerd.png", "nugget.png", null, "gato_lengua.png", "haku.png", null, "gumi.png", "gato_sorprendido.png", "ia.png", null, "flower.png", "gakupo.png"];
const nombres = ["xX_Papu_Xx", "LaMeraMeraPiña", "Chencho", "Wicho el Bicho", "Hakuuuu", "Sin_Nombre_Ingenioso", "ZanahoriaLover", "Panchito", "IA_No_Es_IA", "Lalo", "FlowerPower", "Samurái"];
const otros = nombres.map((n, i) => papu(n, -1, sin[i]!));
const honor = ["Abuelita Vocaloid", "DonPapu", "MaestroPuerro", "LaLeyenda40"].map((n, i) => papu(n, -1, ["luka_hola.png", "gato_tarjeta_roja.png", "miku_feliz.png", null][i]!));
const apuestas = [
  { papu: a, corredor: "miku", monto: 400 },
  { papu: b, corredor: "miku", monto: 250 },
  { papu: d, corredor: "miku", monto: 50 },
  { papu: e, corredor: "gumi", monto: 80 },
  { papu: c, corredor: "teto", monto: 600 },
  { papu: f, corredor: "neru", monto: 900 },
  { papu: g, corredor: "kaito", monto: 200 },
  ...otros.map((p, i) => ({ papu: p, corredor: ["miku", "gumi", "teto", "neru", "kaito", "pina"][i % 6]!, monto: 20 + i * 15 })),
];
const { porCorredor, vallas, tambien } = repartirApostadores(["miku", "gumi", "teto"], apuestas, honor);
const pagos = { miku: { ganador: 2.4, segundo: 1.4, tercero: 1.1 }, gumi: { segundo: 2.3, tercero: 1.6 }, teto: { tercero: 1.3 } } as const;
const repartido = { miku: 1240, gumi: 386, teto: 912 } as const;
const pod = (id: "miku" | "gumi" | "teto"): PodioCorredor => ({ ...corredores.find((x) => x.id === id)!, pagos: pagos[id], repartido: repartido[id], apostadores: porCorredor.get(id)! });
writeFileSync(path.join(OUT, "podio.png"), await bannerPodio({ podio: [pod("miku"), pod("gumi"), pod("teto")], vallas, tambien, hora: "17:40" }));
console.log("ok podio.png");

// Carrera tranquila: casi nadie apostó; las vallas se llenan con Papus de honor.
const r2 = repartirApostadores(["neru", "pina", "kaito"], [{ papu: otros[0]!, corredor: "pina", monto: 30 }], honor);
const vacio = (id: string, pg: PodioCorredor["pagos"], rep: number): PodioCorredor => ({ ...corredores.find((x) => x.id === id)!, pagos: pg, repartido: rep, apostadores: r2.porCorredor.get(id)! });
writeFileSync(
  path.join(OUT, "podio-sin-patrocinadores.png"),
  await bannerPodio({ podio: [vacio("neru", { ganador: 1.05, segundo: 1.05, tercero: 1.05 }, 0), vacio("pina", { segundo: 1.9, tercero: 1.4 }, 42), vacio("kaito", { tercero: 1.05 }, 0)], vallas: r2.vallas, tambien: r2.tambien, hora: "20:25" }),
);
console.log("ok podio-sin-patrocinadores.png");
