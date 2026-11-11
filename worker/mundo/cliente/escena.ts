// El mundo de los Papus: la plaza de la fuente y sus zonas alrededor (mapa de zonas, decisiones de GyroP, 9 nov. 2026),
// unidas por caminos y un anillo, con bosque en el borde. Todo con geometria simple y sombreado plano (low-poly), sin
// texturas salvo los carteles, para que corra en celulares. En esta etapa las zonas son solo decorado.
import * as THREE from "three";
import { OBSTACULOS, RADIO, TABLON, TIENDAS, ZONAS } from "../../src/mundo/juego";
import { material } from "./personaje";

/** Azar con semilla: todos ven los mismos arboles en el mismo lugar. */
function semilla(s: number): () => number {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Plaza {
  escena: THREE.Scene;
  /** Circulos con los que se choca: los de la sala mas arboles y adornos. */
  choques: { x: number; z: number; r: number }[];
  /** Agua de la fuente (se anima a saltos). */
  agua: THREE.Mesh;
  /** Llamas de la fogata (parpadean a saltos). */
  fuego: THREE.Object3D[];
  /** Tablas y cartel del mercado negro: visibles mientras esta cerrado. */
  mercadoCerrado: THREE.Group;
  /** Disco de la ruleta grande (gira en su eje z; ruleta.ts le pone las casillas). */
  rueda: THREE.Mesh<THREE.CircleGeometry, THREE.MeshLambertMaterial>;
}

/** Cartel con texto (textura de canvas), mirando siempre a la camara. */
export function cartel(texto: string, fondo: string, color = "#fff", ancho = 3.2): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = fondo;
  g.beginPath();
  g.roundRect(8, 8, 496, 112, 28);
  g.fill();
  g.fillStyle = color;
  g.font = "bold 56px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(texto, 256, 66, 470);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(ancho, ancho / 4, 1);
  return s;
}

const caja = (w: number, h: number, d: number, color: string, x = 0, y = h / 2, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  m.position.set(x, y, z);
  return m;
};
const cilindro = (rt: number, rb: number, h: number, color: string, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material(color));

/** Grupo puesto en (x, z), con su frente (+z local) al sur: hacia la camara (ver ZONAS en juego.ts). */
function enZona(x: number, z: number, g: THREE.Group): THREE.Group {
  g.position.set(x, 0, z);
  return g;
}

// ───────────────────────── vegetacion ─────────────────────────

function arbol(rnd: () => number, escala = 1): THREE.Group {
  const g = new THREE.Group();
  const alto = (1 + rnd() * 0.8) * escala;
  const tronco = cilindro(0.16 * escala, 0.22 * escala, alto, "#7a5232", 5);
  tronco.position.y = alto / 2;
  g.add(tronco);
  const verdes = ["#3f8f4f", "#4fa35a", "#357a43", "#5bb062"];
  if (rnd() < 0.5) {
    for (let i = 0; i < 3; i++) {
      const cono = new THREE.Mesh(new THREE.ConeGeometry((1.1 - i * 0.28) * escala, 1.1 * escala, 6), material(verdes[i % 3]!));
      cono.position.y = alto + (0.3 + i * 0.6) * escala;
      g.add(cono);
    }
  } else {
    const copa = new THREE.Mesh(new THREE.IcosahedronGeometry((1 + rnd() * 0.4) * escala, 0), material(verdes[Math.floor(rnd() * 4)]!));
    copa.position.y = alto + 0.7 * escala;
    g.add(copa);
  }
  g.rotation.y = rnd() * Math.PI;
  return g;
}

/** Matas de flores: muchas, en una sola malla instanciada por color (barato en celulares). */
function flores(escena: THREE.Scene, rnd: () => number, libres: (x: number, z: number) => boolean): void {
  const geo = new THREE.ConeGeometry(0.12, 0.3, 5);
  for (const color of ["#ff8fb8", "#ffd84d", "#ffffff", "#b48cff"]) {
    const n = 90;
    const inst = new THREE.InstancedMesh(geo, material(color), n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < n * 4 && k < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const d = 14 + rnd() * (RADIO - 14);
      const x = Math.cos(ang) * d;
      const z = Math.sin(ang) * d;
      if (!libres(x, z)) continue;
      m.makeRotationX(Math.PI);
      m.setPosition(x, 0.15, z);
      inst.setMatrixAt(k++, m);
    }
    inst.count = k;
    escena.add(inst);
  }
}

// ───────────────────────── zonas ─────────────────────────

function tablon(): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-1.1, 1.1]) g.add(caja(0.16, 2.2, 0.16, "#7a5232", x, 1.1));
  g.add(caja(2.6, 1.5, 0.12, "#b98552", 0, 1.55));
  const papeles = ["#fff7e0", "#ffe0ef", "#e0f2ff", "#fff7e0", "#e8ffe0"];
  papeles.forEach((c, i) => {
    const p = caja(0.45, 0.55, 0.02, c, -0.95 + i * 0.48, 1.55 + (i % 2 ? 0.25 : -0.2), 0.08);
    p.rotation.z = (i % 2 ? 1 : -1) * 0.06;
    g.add(p);
  });
  const c = cartel("Tablón", "#2a1830", "#fff", 2.2);
  c.position.set(0, 2.75, 0);
  g.add(c);
  return g;
}

function arena(): THREE.Group {
  const g = new THREE.Group();
  g.add(caja(12, 0.7, 12, "#cfcac0", 0, 0.35));
  g.add(caja(11, 0.06, 11, "#3b6fd9", 0, 0.73));
  const esquinas: [number, number, string][] = [[-5.6, -5.6, "#d4344a"], [5.6, -5.6, "#3b6fd9"], [-5.6, 5.6, "#3b6fd9"], [5.6, 5.6, "#d4344a"]];
  for (const [x, z, c] of esquinas) {
    const p = cilindro(0.18, 0.18, 2, c, 6);
    p.position.set(x, 1.7, z);
    g.add(p);
  }
  // Cuerdas: tres alturas por lado.
  for (const y of [1.2, 1.7, 2.2])
    for (const [x, z, w, d] of [[0, -5.6, 11.2, 0.06], [0, 5.6, 11.2, 0.06], [-5.6, 0, 0.06, 11.2], [5.6, 0, 0.06, 11.2]] as const) g.add(caja(w, 0.06, d, "#fff", x, y, z));
  // Gradas a los costados.
  for (const lado of [-1, 1])
    for (let i = 0; i < 3; i++) g.add(caja(1.4, 0.5 + i * 0.5, 10, i % 2 ? "#b98552" : "#a8743f", lado * (8 + i * 1.4), (0.5 + i * 0.5) / 2));
  const c = cartel("Arena del 1vs1", "#d4344a", "#fff", 5);
  c.position.set(0, 4.6, 0);
  g.add(c);
  return g;
}

function stand(nombre: string, color: string, oscuro: boolean): THREE.Group {
  const g = new THREE.Group();
  const madera = oscuro ? "#3a2a2a" : "#b98552";
  g.add(caja(3, 1.1, 1.4, madera), caja(3.04, 0.35, 1.44, color, 0, 0.9));
  for (const x of [-1.4, 1.4]) for (const z of [-0.6, 0.6]) g.add(caja(0.12, 2.6, 0.12, madera, x, 1.3, z));
  const toldo = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const raya = caja(0.52, 0.06, 1.9, i % 2 ? (oscuro ? "#111" : "#fff") : color, -1.3 + i * 0.52, 0);
    toldo.add(raya);
  }
  toldo.position.set(0, 2.65, 0.1);
  toldo.rotation.x = 0.22;
  g.add(toldo);
  const c = cartel(nombre, oscuro ? "#1b1023" : color, oscuro ? "#d9b8ff" : "#3a1830");
  c.position.set(0, 3.45, 0.3);
  g.add(c);
  for (let i = 0; i < 4; i++) {
    const b = caja(0.3, 0.3, 0.3, ["#f2d541", "#39c5bb", "#d4344a", "#7a4fd6"][i]!, -1 + i * 0.66, 1.25, 0.2);
    b.rotation.y = i * 0.4;
    if (!oscuro) g.add(b);
  }
  return g;
}

/** Mercado negro fuera de su hora: tablas cruzadas sobre el mostrador y el cartel de "Cerrado" (se quitan al abrir). */
function cerrado(): THREE.Group {
  const g = new THREE.Group();
  for (const r of [0.35, -0.35]) {
    const tabla = caja(3.3, 0.22, 0.06, "#6b4a2b", 0, 0.75, 0.76);
    tabla.rotation.z = r;
    g.add(tabla);
  }
  const c = cartel("Cerrado", "#7a1f2b", "#fff", 1.8);
  c.position.set(0, 1.75, 0.9);
  g.add(c);
  return g;
}

function ruleta(): { g: THREE.Group; rueda: Plaza["rueda"] } {
  const g = new THREE.Group();
  g.add(caja(2.6, 0.5, 1.6, "#7a5232"));
  const poste = caja(0.4, 3.4, 0.4, "#7a5232", 0, 2.2);
  g.add(poste);
  // Rueda de pie, de frente a la camara: respaldo de madera, disco con las casillas (textura de ruleta.ts), borde y eje.
  const respaldo = cilindro(3.1, 3.1, 0.24, "#7a5232", 24);
  respaldo.rotation.x = Math.PI / 2;
  respaldo.position.set(0, 4.1, 0.2);
  g.add(respaldo);
  const rueda = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
  rueda.position.set(0, 4.1, 0.33);
  g.add(rueda);
  const borde = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.14, 6, 32), material("#f7e7b0"));
  borde.position.set(0, 4.1, 0.33);
  g.add(borde);
  const centro = cilindro(0.42, 0.42, 0.3, "#f7e7b0", 10);
  centro.rotation.x = Math.PI / 2;
  centro.position.set(0, 4.1, 0.45);
  g.add(centro);
  const flecha = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), material("#2a1830"));
  flecha.rotation.z = Math.PI;
  flecha.position.set(0, 7.4, 0.6);
  g.add(flecha);
  const c = cartel("Ruleta", "#f2d541", "#3a1830", 3);
  c.position.set(0, 8.4, 0);
  g.add(c);
  return { g, rueda };
}

function escuela(): THREE.Group {
  const g = new THREE.Group();
  const casa = new THREE.Group();
  casa.add(caja(6, 3.2, 5, "#f3e3c3"));
  const techo = new THREE.Mesh(new THREE.ConeGeometry(4.7, 2.2, 4), material("#3b6fd9"));
  techo.rotation.y = Math.PI / 4;
  techo.position.y = 4.3;
  casa.add(techo);
  casa.add(caja(1.1, 2, 0.1, "#7a5232", 0, 1, 2.52));
  for (const x of [-2, 2]) casa.add(caja(1, 0.9, 0.1, "#a8dcff", x, 1.9, 2.52));
  const campanario = caja(1, 1.2, 1, "#f3e3c3", 0, 5.6);
  casa.add(campanario);
  const campana = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 6), material("#f2d541"));
  campana.position.set(0, 5.6, 0.51);
  casa.add(campana);
  casa.position.z = -2.8;
  g.add(casa);
  // Pizarra de las mejores rachas, delante de la puerta.
  for (const x of [-1, 1]) g.add(caja(0.12, 1.8, 0.12, "#7a5232", x, 0.9, 1.6));
  g.add(caja(2.3, 1.2, 0.08, "#2f5d3a", 0, 1.4, 1.6));
  const c = cartel("Escuela de la trivia", "#3b6fd9", "#fff", 5);
  c.position.set(0, 7.4, -2.8);
  g.add(c);
  return g;
}

function estanque(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const orilla = new THREE.Mesh(new THREE.CircleGeometry(5.9, 14), material("#d8c9aa"));
  orilla.rotation.x = -Math.PI / 2;
  orilla.scale.set(1.25, 0.9, 1);
  orilla.position.set(0, 0.03, 2);
  const agua = new THREE.Mesh(new THREE.CircleGeometry(5.1, 14), material("#4fb8e8"));
  agua.rotation.x = -Math.PI / 2;
  agua.scale.set(1.25, 0.9, 1);
  agua.position.set(0, 0.06, 2);
  g.add(orilla, agua);
  // Muelle hacia el agua y nenufares.
  // El muelle sale justo donde llega el camino desde la fuente.
  g.add(caja(1.3, 0.15, 4, "#a8743f", 0, 0.3, 0.6));
  for (const z of [-1.2, 2.2]) for (const x of [-0.55, 0.55]) g.add(caja(0.14, 0.6, 0.14, "#7a5232", x, 0.2, z));
  for (let i = 0; i < 6; i++) {
    const n = new THREE.Mesh(new THREE.CircleGeometry(0.35, 7), material("#5bb062"));
    n.rotation.x = -Math.PI / 2;
    n.position.set((rnd() < 0.5 ? -1 : 1) * (1.4 + rnd() * 2.6), 0.08, 1 + rnd() * 3);
    g.add(n);
  }
  // Juncos en la orilla.
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const j = cilindro(0.04, 0.05, 1.1, "#4a7a3a", 4);
    j.position.set(Math.cos(a) * 6.4, 0.55, Math.sin(a) * 4.5 + 2);
    const punta = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.25, 2, 5), material("#7a5232"));
    punta.position.set(j.position.x, 1.2, j.position.z);
    g.add(j, punta);
  }
  const c = cartel("Estanque", "#39c5bb", "#fff", 3);
  c.position.set(0, 3, 2);
  g.add(c);
  return g;
}

function fogata(): { g: THREE.Group; llamas: THREE.Object3D[] } {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const piedra = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), material("#8a8a82"));
    piedra.position.set(Math.cos(a) * 0.85, 0.18, Math.sin(a) * 0.85);
    g.add(piedra);
  }
  for (const r of [0.5, -0.5, 1.6]) {
    const lena = cilindro(0.1, 0.1, 1.2, "#6b4a2b", 5);
    lena.rotation.set(Math.PI / 2, 0, r);
    lena.position.y = 0.2;
    g.add(lena);
  }
  const llamas: THREE.Object3D[] = [];
  for (const [c, h, r] of [["#ff7a1a", 1.2, 0.45], ["#ffd84d", 0.8, 0.28]] as const) {
    const llama = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), new THREE.MeshBasicMaterial({ color: c }));
    llama.position.y = 0.3 + h / 2;
    g.add(llama);
    llamas.push(llama);
  }
  // Troncos para sentarse alrededor: acostados de lado (tangentes al circulo), con el lado largo hacia el fuego.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const asiento = cilindro(0.32, 0.32, 1.5, "#8a5a32", 7);
    asiento.rotation.set(0, -a - Math.PI / 2, Math.PI / 2);
    asiento.position.set(Math.cos(a) * 3, 0.32, Math.sin(a) * 3);
    g.add(asiento);
  }
  const c = cartel("Fogata", "#e07a2e", "#fff", 2.6);
  c.position.set(0, 3.2, 0);
  g.add(c);
  return { g, llamas };
}

function altar(): THREE.Group {
  const g = new THREE.Group();
  g.add(caja(7, 0.3, 6, "#f7f2ea", 0, 0.15, -0.5));
  g.add(caja(1.4, 0.02, 6, "#c23a55", 0, 0.31, -0.5));
  // Arco con flores.
  const arco = new THREE.Group();
  for (const x of [-1.8, 1.8]) arco.add(caja(0.35, 2.6, 0.35, "#ffffff", x, 1.6));
  const curva = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.18, 6, 16, Math.PI), material("#ffffff"));
  curva.position.y = 2.9;
  arco.add(curva);
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    const flor = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), material(i % 2 ? "#ff8fb8" : "#ffd1e3"));
    flor.position.set(Math.cos(a) * 1.8, 2.9 + Math.sin(a) * 1.8, 0.15);
    arco.add(flor);
  }
  arco.position.z = -2.1;
  g.add(arco);
  // Bancas a los lados del pasillo.
  for (const lado of [-1, 1]) for (const z of [0.6, 2]) g.add(caja(2, 0.45, 0.5, "#b98552", lado * 2, 0.5, z));
  const c = cartel("Altar de bodas", "#ffffff", "#c23a55", 4);
  c.position.set(0, 5.4, -2.1);
  g.add(c);
  return g;
}

function fama(): THREE.Group {
  const g = new THREE.Group();
  const podios: [number, number, string][] = [[0, 1.5, "#f2c94c"], [-1.7, 1, "#c9ccd6"], [1.7, 0.7, "#cd8a4a"]];
  for (const [x, h, c] of podios) g.add(caja(1.6, h, 1.6, c, x, h / 2, -1));
  // Trofeos.
  for (const x of [-4, 4]) {
    const base = caja(0.8, 1.4, 0.8, "#e9e2d0", x, 0.7, -1);
    const copa = cilindro(0.45, 0.2, 0.7, "#f2c94c", 8);
    copa.position.set(x, 1.8, -1);
    g.add(base, copa);
  }
  g.add(caja(10, 3.2, 0.3, "#7a4fd6", 0, 1.6, -2.8));
  const c = cartel("Salón de la fama", "#7a4fd6", "#fff", 4.6);
  c.position.set(0, 4.3, -2.6);
  g.add(c);
  return g;
}

function sorteo(): THREE.Group {
  const g = new THREE.Group();
  g.add(caja(7, 1, 4, "#a8743f", 0, 0.5, -1.5));
  for (let i = 0; i < 2; i++) g.add(caja(2, 0.33 * (i + 1), 0.6, "#b98552", 0, (0.33 * (i + 1)) / 2, 0.8 - i * 0.6));
  g.add(caja(7.2, 4, 0.3, "#b8233c", 0, 3, -3.5));
  for (const x of [-3.3, 3.3]) g.add(caja(0.6, 4.4, 0.6, "#f2d541", x, 3.2, -3.4));
  for (let i = 0; i < 3; i++) {
    const regalo = caja(0.7, 0.7, 0.7, ["#39c5bb", "#ff8fb8", "#f2d541"][i]!, -1.6 + i * 1.6, 1.35, -2.2);
    regalo.rotation.y = i * 0.5;
    g.add(regalo);
  }
  const c = cartel("Sorteo de GyroP", "#4a9a4a", "#fff", 4.4);
  c.position.set(0, 6, -3.2);
  g.add(c);
  return g;
}

/** Farol del camino: poste y una esfera que brilla (sin luz real, para no gastar en celulares). */
function farol(): THREE.Group {
  const g = new THREE.Group();
  g.add(caja(0.14, 2.6, 0.14, "#3a3540", 0, 1.3));
  const luz = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), new THREE.MeshBasicMaterial({ color: "#fff1b8" }));
  luz.position.y = 2.75;
  g.add(luz);
  return g;
}

// ───────────────────────── mundo ─────────────────────────

export function crearPlaza(): Plaza {
  const escena = new THREE.Scene();
  escena.background = new THREE.Color("#a8dcff");
  escena.fog = new THREE.Fog("#a8dcff", 38, 85);
  escena.add(new THREE.HemisphereLight("#ffffff", "#5b8a4a", 1.6));
  const sol = new THREE.DirectionalLight("#fff4dc", 1.8);
  sol.position.set(8, 14, 6);
  escena.add(sol);
  const rnd = semilla(17);

  // Pasto facetado con manchas de dos verdes.
  const suelo = new THREE.PlaneGeometry(240, 240, 48, 48);
  const pos = suelo.attributes.position!;
  const colores: number[] = [];
  const claro = new THREE.Color("#86cc6f");
  const oscuro = new THREE.Color("#6db35a");
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, (rnd() - 0.5) * 0.3 - 0.1);
    const c = claro.clone().lerp(oscuro, rnd());
    colores.push(c.r, c.g, c.b);
  }
  suelo.setAttribute("color", new THREE.Float32BufferAttribute(colores, 3));
  suelo.computeVertexNormals();
  const pasto = new THREE.Mesh(suelo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  pasto.rotation.x = -Math.PI / 2;
  escena.add(pasto);

  const plano = (geo: THREE.BufferGeometry, color: string, y: number) => {
    const m = new THREE.Mesh(geo, material(color));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    escena.add(m);
    return m;
  };
  plano(new THREE.CircleGeometry(13, 16), "#e3d6bb", 0.05);
  plano(new THREE.RingGeometry(12.2, 13, 16), "#cbbd9e", 0.06);
  plano(new THREE.RingGeometry(29.2, 31.6, 48), "#d8c9aa", 0.04);
  // Caminos de la fuente a cada zona.
  for (const z of ZONAS) {
    const ang = Math.atan2(z.z, z.x);
    const largo = Math.hypot(z.x, z.z) - 12;
    const camino = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, largo), material("#d8c9aa"));
    const mitad = 12 + largo / 2;
    camino.position.set(Math.cos(ang) * mitad, 0.04, Math.sin(ang) * mitad);
    camino.rotation.y = -ang + Math.PI / 2;
    escena.add(camino);
  }

  // Fuente.
  const base = cilindro(3, 3.2, 0.7, "#b8b2a6", 10);
  base.position.y = 0.35;
  const agua = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 10), new THREE.MeshLambertMaterial({ color: "#4fb8e8", flatShading: true }));
  agua.position.y = 0.66;
  const pilar = cilindro(0.3, 0.45, 1.8, "#b8b2a6", 6);
  pilar.position.y = 1.2;
  const taza = cilindro(1.1, 0.5, 0.4, "#c9c3b6", 8);
  taza.position.y = 2.15;
  escena.add(base, agua, pilar, taza);

  // Zonas.
  escena.add(enZona(TABLON.x, TABLON.z, tablon()));
  const [zArena, , zRuleta, zEscuela, zEstanque, zFogata, zAltar, zFama, zSorteo] = ZONAS;
  escena.add(enZona(zArena.x, zArena.z, arena()));
  let mercadoCerrado = new THREE.Group();
  for (const t of TIENDAS) {
    const g = stand(t.nombre, t.color, t.id === "mercado");
    if (t.id === "mercado") g.add((mercadoCerrado = cerrado()));
    escena.add(enZona(t.x, t.z, g));
  }
  const r = ruleta();
  escena.add(enZona(zRuleta.x, zRuleta.z, r.g));
  escena.add(enZona(zEscuela.x, zEscuela.z, escuela()));
  escena.add(enZona(zEstanque.x, zEstanque.z, estanque(rnd)));
  const f = fogata();
  escena.add(enZona(zFogata.x, zFogata.z, f.g));
  escena.add(enZona(zAltar.x, zAltar.z, altar()));
  escena.add(enZona(zFama.x, zFama.z, fama()));
  escena.add(enZona(zSorteo.x, zSorteo.z, sorteo()));

  // Faroles en el anillo, entre zonas.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    const l = farol();
    l.position.set(Math.cos(a) * 32.2, 0, Math.sin(a) * 32.2);
    escena.add(l);
  }

  // Arboles entre zonas (con choque) y bosque tupido fuera del borde (sin choque: no se llega).
  const choques = [...OBSTACULOS];
  const lejosDeZonas = (x: number, z: number, margen: number) =>
    // La arena es mas ancha (ring y gradas): mas espacio libre alrededor.
    ZONAS.every((zz) => Math.hypot(zz.x - x, zz.z - z) > margen + (zz.id === "arena" ? 6 : 0)) && Math.hypot(TIENDAS[0]!.x - x, TIENDAS[0]!.z - z) > margen;
  const lejosDeCaminos = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    if (d > 28 && d < 33) return false; // anillo
    return ZONAS.every((zz) => {
      const ang = Math.atan2(zz.z, zz.x);
      const dot = x * Math.cos(ang) + z * Math.sin(ang);
      const lateral = Math.abs(-x * Math.sin(ang) + z * Math.cos(ang));
      return dot < 0 || lateral > 2.6;
    });
  };
  let puestos = 0;
  for (let i = 0; i < 600 && puestos < 55; i++) {
    const ang = rnd() * Math.PI * 2;
    const d = 16 + rnd() * (RADIO - 17);
    const x = Math.cos(ang) * d;
    const z = Math.sin(ang) * d;
    if (!lejosDeZonas(x, z, 10) || !lejosDeCaminos(x, z) || choques.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2.2)) continue;
    const t = arbol(rnd);
    t.position.set(x, 0, z);
    escena.add(t);
    choques.push({ x, z, r: 0.5 });
    puestos++;
  }
  for (let i = 0; i < 140; i++) {
    const ang = rnd() * Math.PI * 2;
    const d = RADIO + 4 + rnd() * 22;
    const t = arbol(rnd, 1.2 + rnd() * 0.6);
    t.position.set(Math.cos(ang) * d, 0, Math.sin(ang) * d);
    escena.add(t);
  }
  for (let i = 0; i < 90; i++) {
    const ang = (i / 90) * Math.PI * 2 + rnd() * 0.03;
    const roca = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rnd() * 0.6, 0), material(rnd() < 0.5 ? "#9a9a92" : "#86867e"));
    roca.position.set(Math.cos(ang) * (RADIO + 1.4), 0.2, Math.sin(ang) * (RADIO + 1.4));
    roca.rotation.set(rnd() * 3, rnd() * 3, 0);
    escena.add(roca);
  }
  flores(escena, rnd, (x, z) => lejosDeZonas(x, z, 9) && lejosDeCaminos(x, z) && !choques.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.4));

  return { escena, choques, agua, fuego: f.llamas, mercadoCerrado, rueda: r.rueda };
}
