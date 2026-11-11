// Personaje low-poly del mundo de los Papus, hecho con cajas y conos (sin modelos externos todavia). La animacion es
// a proposito "stop-motion": el ciclo de pasos va en saltos de 6 cuadros a 8-10 por segundo, no suave.
import * as THREE from "three";
import { ASPECTOS } from "../../src/mundo/juego";
import type { Andar, Aspecto } from "../../src/mundo/tipos";

const materiales = new Map<string, THREE.MeshLambertMaterial>();
export function material(color: string): THREE.MeshLambertMaterial {
  let m = materiales.get(color);
  if (!m) materiales.set(color, (m = new THREE.MeshLambertMaterial({ color, flatShading: true })));
  return m;
}

/** Caja con el pivote arriba (para piernas y brazos que giran desde la cadera o el hombro). */
function extremidad(w: number, h: number, color: string): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, w);
  g.translate(0, -h / 2, 0);
  return new THREE.Mesh(g, material(color));
}

const CUADROS = 6;

export class Personaje {
  /** En el suelo; rotation.y = hacia donde mira (0 = hacia +z). */
  readonly raiz = new THREE.Group();
  private readonly cuerpo = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly cabeza: THREE.Mesh;
  private readonly piernas: [THREE.Mesh, THREE.Mesh];
  private readonly brazos: [THREE.Mesh, THREE.Mesh];
  private readonly sombrero = new THREE.Group();
  private readonly montura = new THREE.Group();

  constructor(aspecto: Aspecto) {
    this.raiz.add(this.cuerpo, this.montura);
    // Sombra de mentira: un circulo oscuro (mas barato que sombras reales en celulares).
    const sombra = new THREE.Mesh(new THREE.CircleGeometry(0.45, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    sombra.rotation.x = -Math.PI / 2;
    sombra.position.y = 0.02;
    this.raiz.add(sombra);

    this.piernas = [extremidad(0.22, 0.5, "#333"), extremidad(0.22, 0.5, "#333")];
    this.piernas.forEach((p, i) => p.position.set(i ? -0.13 : 0.13, 0.5, 0));
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.58, 0.34), material("#fff"));
    this.torso.position.y = 0.79;
    this.brazos = [extremidad(0.16, 0.5, "#fff"), extremidad(0.16, 0.5, "#fff")];
    this.brazos.forEach((b, i) => b.position.set(i ? -0.37 : 0.37, 1.06, 0));
    this.cabeza = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.54, 0.54), material("#fff"));
    this.cabeza.position.y = 1.38;
    for (const x of [-0.13, 0.13]) {
      const ojo = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.02), material("#1d1d24"));
      ojo.position.set(x, 0.03, 0.28);
      this.cabeza.add(ojo);
    }
    this.cabeza.add(this.sombrero);
    this.cuerpo.add(...this.piernas, this.torso, ...this.brazos, this.cabeza);

    // Patineta: tabla, y cuatro ruedas.
    const tabla = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 1.25), material("#c9874a"));
    tabla.position.y = 0.16;
    this.montura.add(tabla);
    for (const [x, z] of [[-0.18, 0.42], [0.18, 0.42], [-0.18, -0.42], [0.18, -0.42]] as const) {
      const rueda = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 6), material("#2b2b33"));
      rueda.rotation.z = Math.PI / 2;
      rueda.position.set(x, 0.07, z);
      this.montura.add(rueda);
    }
    this.montura.visible = false;
    this.vestir(aspecto);
  }

  vestir(a: Aspecto): void {
    const ropa = ASPECTOS.ropa[a.ropa] ?? ASPECTOS.ropa[0];
    const piel = ASPECTOS.piel[a.piel] ?? ASPECTOS.piel[0];
    this.torso.material = material(ropa);
    this.brazos.forEach((b) => (b.material = material(piel)));
    this.cabeza.material = material(piel);
    this.sombrero.clear();
    const tipo = ASPECTOS.sombrero[a.sombrero] ?? "nada";
    if (tipo === "fiesta") {
      const cono = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 6), material("#ff5c8a"));
      cono.position.y = 0.48;
      cono.rotation.z = -0.15;
      this.sombrero.add(cono);
    } else if (tipo === "copa") {
      const ala = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 8), material("#1d1d24"));
      ala.position.y = 0.29;
      const copa = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.34, 8), material("#1d1d24"));
      copa.position.y = 0.47;
      this.sombrero.add(ala, copa);
    } else if (tipo === "gato") {
      for (const x of [-0.18, 0.18]) {
        const oreja = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 4), material(ropa));
        oreja.position.set(x, 0.36, 0);
        this.sombrero.add(oreja);
      }
    } else if (tipo === "puerro") {
      // Puerro en la cabeza, de lado (como antena).
      const blanco = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.4, 6), material("#f1f1e6"));
      const verde = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.36, 6), material("#4a9a4a"));
      blanco.position.y = 0.2;
      verde.position.y = 0.58;
      const tallo = new THREE.Group();
      tallo.add(blanco, verde);
      tallo.position.set(0.2, 0.22, 0);
      tallo.rotation.z = -0.5;
      this.sombrero.add(tallo);
    }
  }

  /** Pose del cuadro actual. `t` en segundos; cada Papu tiene `desfase` para no ir todos al mismo paso. */
  animar(t: number, andar: Andar, montado: boolean, desfase = 0): void {
    this.montura.visible = montado;
    const [pi, pd] = this.piernas;
    const [bi, bd] = this.brazos;
    if (montado) {
      // De pie en la patineta: rodillas firmes, brazos abiertos y un vaiven a saltos.
      const f = Math.floor((t + desfase) * 4) % 2;
      this.cuerpo.position.y = 0.2 + f * 0.03;
      this.cuerpo.rotation.set(0, 0, f ? 0.06 : -0.06);
      pi.rotation.x = pd.rotation.x = 0;
      bi.rotation.set(0, 0, 0.7);
      bd.rotation.set(0, 0, -0.7);
      return;
    }
    bi.rotation.z = bd.rotation.z = 0;
    this.cuerpo.rotation.z = 0;
    if (andar === 0) {
      const f = Math.floor((t + desfase) * 2) % 2;
      this.cuerpo.position.y = f * 0.02;
      this.cuerpo.rotation.x = 0;
      pi.rotation.x = pd.rotation.x = bi.rotation.x = bd.rotation.x = 0;
      return;
    }
    const corre = andar === 2;
    const f = Math.floor((t + desfase) * (corre ? 11 : 8)) % CUADROS;
    const fase = (f / CUADROS) * Math.PI * 2;
    const paso = Math.sin(fase) * (corre ? 0.95 : 0.55);
    pi.rotation.x = paso;
    pd.rotation.x = -paso;
    bi.rotation.x = -paso * 0.8;
    bd.rotation.x = paso * 0.8;
    this.cuerpo.position.y = Math.abs(Math.sin(fase)) * (corre ? 0.09 : 0.05);
    this.cuerpo.rotation.x = corre ? 0.18 : 0.04;
  }
}
