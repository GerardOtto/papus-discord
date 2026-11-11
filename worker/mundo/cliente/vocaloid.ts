// Vocaloid de la plaza hecho con renders (hoja de sprites de npm run mundo:sprites, nunca el modelo 3D): un recorte
// de papel que mira a la camara y cambia de cuadro segun hacia donde camina (8 direcciones) y el paso (stop-motion).
// Su paseo depende solo de la hora, asi todos los Papus la ven en el mismo lugar sin pasar por la sala.
import * as THREE from "three";

interface Hoja {
  char: string;
  direcciones: number;
  cuadros: number;
  celda: [number, number];
  /** Pies dentro de la celda (0,0 = abajo a la izquierda). */
  pie: [number, number];
  /** Alto de la celda en unidades del mundo. */
  alto: number;
}

export interface Parada {
  x: number;
  z: number;
  /** Segundos que se queda quieta al llegar. */
  espera: number;
  /** Hacia donde mira mientras espera (radianes, 0 = hacia la camara). */
  mira?: number;
}

const VELOCIDAD = 2.2;
const PASOS_POR_SEGUNDO = 8;
/** Cuanto se adelanta el recorte hacia la camara para que el suelo no le tape los pies. */
const ADELANTE = 0.9;
/** Inclinacion de la camara aerea (offset 0, 8.5, 10.5). */
const INCLINACION_AEREA = Math.atan2(8.5, 10.5);

/**
 * Hacia donde mira la camara ahora (la actualiza main.ts cada cuadro). `yaw` 0 = mirando al norte (-z), como la vista
 * aerea; `inclinacion` = cuanto mira hacia abajo (casi 0 en tercera persona, a nivel del suelo).
 */
export const vista = { yaw: 0, inclinacion: INCLINACION_AEREA };

export class Vocaloid {
  readonly raiz = new THREE.Group();
  private readonly sprite: THREE.Sprite;
  private readonly mat: THREE.SpriteMaterial;
  /** Hoja que carga siempre (celdas de 256) y la de detalle (512), solo mientras esta cerca de la camara. */
  private readonly tex: THREE.Texture;
  private hd: THREE.Texture | null = null;
  private pidiendoHd = false;
  /** Lo que se quiere ahora (la hoja HD puede tardar en llegar o llegar cuando ya no hace falta). */
  private quiereHd = false;
  /** Tramos del paseo con su hora de inicio (s) dentro del ciclo. */
  private readonly tramos: { desde: Parada; hasta: Parada; t0: number; camina: number; espera: number }[] = [];
  private readonly ciclo: number;
  /** Hacia donde mira ahora (para el cartel de frases y el cuadro). */
  rumbo = 0;
  /** Altura del suelo donde pisa (0 = pasto; mas alto sobre el ring o el altar). */
  base = 0;

  private constructor(
    private readonly char: string,
    private readonly hoja: Hoja,
    tex: THREE.Texture,
    paradas: Parada[],
  ) {
    this.tex = this.preparar(tex);
    // Borde suave: con el antialias del lienzo, la transparencia del borde decide cuanto cubre cada pixel
    // (alphaToCoverage), sin el serrucho del recorte de todo o nada y sin ordenar transparencias.
    this.mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.08, alphaToCoverage: true, transparent: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(hoja.pie[0], hoja.pie[1]);
    this.sprite.scale.set((hoja.alto * hoja.celda[0]) / hoja.celda[1], hoja.alto, 1);
    const sombra = new THREE.Mesh(new THREE.CircleGeometry(0.4, 10), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    sombra.rotation.x = -Math.PI / 2;
    sombra.position.y = 0.02;
    this.raiz.add(sombra, this.sprite);

    let t = 0;
    paradas.forEach((desde, i) => {
      const hasta = paradas[(i + 1) % paradas.length]!;
      const camina = Math.hypot(hasta.x - desde.x, hasta.z - desde.z) / VELOCIDAD;
      this.tramos.push({ desde, hasta, t0: t, camina, espera: hasta.espera });
      t += camina + hasta.espera;
    });
    this.ciclo = t;
  }

  static async cargar(char: string, paradas: Parada[]): Promise<Vocaloid> {
    const hoja = (await fetch(`${char}.json`).then((r) => r.json())) as Hoja;
    const tex = await new THREE.TextureLoader().loadAsync(`${char}.webp`);
    return new Vocaloid(char, hoja, tex, paradas);
  }

  private preparar(tex: THREE.Texture): THREE.Texture {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.repeat.set(1 / this.hoja.cuadros, 1 / this.hoja.direcciones);
    return tex;
  }

  /**
   * Hoja de detalle (512) si `si`: la pide main.ts solo para las 1-2 Vocaloids mas cerca de la camara. Cada hoja HD
   * ocupa ~64 MB de memoria de video, asi que al alejarse se suelta.
   */
  detalle(si: boolean): void {
    this.quiereHd = si;
    if (si && this.hd) this.mat.map = this.hd;
    else if (!si && this.hd) {
      this.mat.map = this.tex;
      this.hd.dispose();
      this.hd = null;
    } else if (si && !this.pidiendoHd) {
      this.pidiendoHd = true;
      new THREE.TextureLoader()
        .loadAsync(`${this.char}-hd.webp`)
        .then((t) => {
          if (!this.quiereHd) return t.dispose();
          this.hd = this.preparar(t);
          this.hd.offset.copy(this.tex.offset);
          this.mat.map = this.hd;
        })
        .catch(() => {
          // Sin hoja HD (no se renderizo): se queda con la normal.
        })
        .finally(() => (this.pidiendoHd = false));
    }
  }

  /** Posicion y cuadro segun la hora (ms desde 1970: igual para todos). */
  actualizar(ahoraMs: number): void {
    const t = (ahoraMs / 1000) % this.ciclo;
    const tramo = this.tramos.find((s) => t >= s.t0 && t < s.t0 + s.camina + s.espera) ?? this.tramos[0]!;
    const dentro = t - tramo.t0;
    const { desde, hasta } = tramo;
    let cuadro = 0;
    if (dentro < tramo.camina) {
      const k = dentro / tramo.camina;
      this.raiz.position.set(desde.x + (hasta.x - desde.x) * k, this.base, desde.z + (hasta.z - desde.z) * k);
      this.rumbo = Math.atan2(hasta.x - desde.x, hasta.z - desde.z);
      cuadro = 1 + (Math.floor(dentro * PASOS_POR_SEGUNDO) % (this.hoja.cuadros - 1));
    } else {
      this.raiz.position.set(hasta.x, this.base, hasta.z);
      this.rumbo = hasta.mira ?? 0;
    }
    // El recorte mira a la camara (inclinado): lo de abajo del punto de los pies (el pie que va adelante) quedaria
    // bajo el suelo. Se adelanta hacia la camara: en pantalla queda en el mismo lugar. A nivel del suelo casi no se
    // inclina, asi que casi no hace falta.
    const { yaw, inclinacion } = vista;
    const k = ADELANTE * Math.max(0, Math.sin(inclinacion) / Math.sin(INCLINACION_AEREA));
    this.sprite.position.set(Math.sin(yaw) * Math.cos(inclinacion) * k, Math.sin(inclinacion) * k, Math.cos(yaw) * Math.cos(inclinacion) * k);
    // Cuadro segun el rumbo respecto de la camara (0 = de frente a ella, + = a la derecha).
    const n = this.hoja.direcciones;
    const dir = ((Math.round((this.rumbo - yaw) / ((Math.PI * 2) / n)) % n) + n) % n;
    this.tex.offset.set(cuadro / this.hoja.cuadros, 1 - (dir + 1) / n);
    this.hd?.offset.copy(this.tex.offset);
  }

  /**
   * Altura (en el mundo, sobre los pies) donde va el nombre: un poco sobre la cabeza. El recorte se dibuja de frente
   * a la camara inclinada, asi que su alto en pantalla equivale a mas altura vertical: se divide por el coseno de la
   * inclinacion de la camara.
   */
  get cabeza(): number {
    return (this.hoja.alto * (1 - this.hoja.pie[1])) / Math.cos(vista.inclinacion) + 0.15;
  }
}
