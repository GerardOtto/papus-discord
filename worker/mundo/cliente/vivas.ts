// Zonas vivas de la plaza: muestran la "foto" del servidor que deja el bot (src/mundo/estado.ts, /mundo/api/estado):
// la boda mas reciente en el altar, la pelea en la arena, Neru en el mercado cuando abre, los tres primeros del ranking
// en los podios y el ultimo sorteo. Solo mirar: aqui no se hace nada (las acciones vienen despues).
import * as THREE from "three";
import type { EstadoMundo } from "../../../src/mundo/estado";
import { enZona, TIENDAS, ZONAS, type ZonaId } from "../../src/mundo/juego";
import type { Aspecto } from "../../src/mundo/tipos";
import type { Plaza } from "./escena";
import { Personaje } from "./personaje";
import { Vocaloid } from "./vocaloid";

/** Hoja de sprites de cada Vocaloid que tiene modelo en Diva-a-Render (npm run mundo:sprites -- <codigo>). */
export const SPRITE: Record<string, string> = {
  teto: "tet",
  miku: "mik",
  luka: "luk",
  neru: "ner",
  rin: "rin",
  len: "len",
  kaito: "kai",
  meiko: "mei",
  haku: "hak",
};

export interface Respuesta {
  estado: EstadoMundo | null;
  aspectos: Record<string, Aspecto>;
}

/** Etiqueta HTML sobre algo del mundo (la dibuja main.ts cada cuadro). */
export type Etiquetar = (obj: THREE.Object3D, alto: number, html: string, clase?: string) => HTMLElement;

const zona = (id: ZonaId) => ZONAS.find((z) => z.id === id)!;
const hora = (ms: number) => new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class ZonasVivas {
  private readonly grupo = new THREE.Group();
  private sprites: Vocaloid[] = [];
  private etiquetas: HTMLElement[] = [];
  private huella = "";
  /** Fichas que cambian con la foto (la del mercado dice si esta abierto, la de la arena quien pelea…). */
  fichas: Partial<Record<ZonaId, string>> = {};

  constructor(
    private readonly plaza: Plaza,
    private readonly etiquetar: Etiquetar,
    private readonly quitarEtiqueta: (el: HTMLElement) => void,
  ) {
    plaza.escena.add(this.grupo);
  }

  /** Vocaloids de las zonas (para darles la hoja de detalle cuando estan cerca). */
  get vocaloids(): readonly Vocaloid[] {
    return this.sprites;
  }

  /** Cada cuadro: los sprites quietos solo necesitan su cuadro (direccion) al dia. */
  actualizar(ahoraMs: number): void {
    for (const s of this.sprites) s.actualizar(ahoraMs);
  }

  /** Arma de nuevo las zonas si la foto cambio. */
  async aplicar(r: Respuesta): Promise<void> {
    const h = JSON.stringify(r);
    if (h === this.huella) return;
    this.huella = h;
    this.limpiar();
    const e = r.estado;
    this.fichas = {};
    this.plaza.mercadoCerrado.visible = !e?.mercado.abierto;
    if (!e) return;
    await Promise.all([this.altar(e, r.aspectos), this.arena(e), this.mercado(e)]);
    this.fama(e, r.aspectos);
    this.sorteo(e);
  }

  private limpiar(): void {
    this.grupo.clear();
    for (const s of this.sprites) this.plaza.escena.remove(s.raiz);
    this.sprites = [];
    for (const el of this.etiquetas) this.quitarEtiqueta(el);
    this.etiquetas = [];
  }

  /** Un Vocaloid quieto en (x, z), mirando a `mira`; null si no tiene hoja de sprites. */
  private async quieto(bot: string, x: number, z: number, mira: number, base = 0): Promise<Vocaloid | null> {
    const char = SPRITE[bot];
    if (!char) return null;
    try {
      const v = await Vocaloid.cargar(char, [{ x, z, espera: 3600, mira }]);
      v.base = base;
      v.actualizar(Date.now());
      this.plaza.escena.add(v.raiz);
      this.sprites.push(v);
      return v;
    } catch {
      return null;
    }
  }

  /** Un Papu de cajas con su aspecto de la plaza (o el inicial si nunca entro). */
  private papu(aspecto: Aspecto | undefined, x: number, z: number, y: number, mira: number): Personaje {
    const p = new Personaje(aspecto ?? { ropa: 0, piel: 0, sombrero: 0 });
    p.raiz.position.set(x, y, z);
    p.raiz.rotation.y = mira;
    p.animar(0, 0, false);
    this.grupo.add(p.raiz);
    return p;
  }

  private etiqueta(obj: THREE.Object3D, alto: number, html: string, clase = "zona-viva"): void {
    this.etiquetas.push(this.etiquetar(obj, alto, html, clase));
  }

  private async altar(e: EstadoMundo, aspectos: Record<string, Aspecto>): Promise<void> {
    if (!e.boda) {
      this.fichas.altar = "💍 <b>Altar de bodas</b><br>Aún no hay bodas. Adivina el acertijo de una Vocaloid en Discord para casarte 24 h.";
      return;
    }
    const z = zona("altar");
    // Bajo el arco, de frente a la camara (como todas las zonas).
    const ella = enZona(z.x, z.z, -0.75, -1.2);
    const el = enZona(z.x, z.z, 0.75, -1.2);
    const mira = 0;
    const v = await this.quieto(e.boda.bot, ella.x, ella.z, 0, 0.3);
    const p = this.papu(aspectos[e.boda.papuId], el.x, el.z, 0.3, mira);
    const nombreBot = e.boda.bot.charAt(0).toUpperCase() + e.boda.bot.slice(1);
    const texto = `${e.boda.vigente ? "💍" : "🤍"} ${esc(nombreBot)} y ${esc(e.boda.nombre)}`;
    this.etiqueta(v?.raiz ?? p.raiz, 3.1, texto, "zona-viva boda");
    this.fichas.altar = e.boda.vigente
      ? `💍 <b>Altar de bodas</b><br>${esc(nombreBot)} y ${esc(e.boda.nombre)} están casados hasta las ${hora(e.boda.hasta)}.`
      : `🤍 <b>Altar de bodas</b><br>La última boda fue de ${esc(nombreBot)} y ${esc(e.boda.nombre)}.`;
  }

  private async arena(e: EstadoMundo): Promise<void> {
    const p = e.pelea;
    if (!p) return;
    const z = zona("arena");
    const enJuego = p.estado === "abierta" || p.estado === "peleando";
    const lados = [
      { l: p.a, pos: enZona(z.x, z.z, -2.6, 0), mira: Math.PI / 2 },
      { l: p.b, pos: enZona(z.x, z.z, 2.6, 0), mira: -Math.PI / 2 },
    ];
    // Terminada: solo el ganador, al centro del ring.
    const quienes = enJuego ? lados : lados.filter((x) => x.l.id === p.ganador).map((x) => ({ ...x, pos: enZona(z.x, z.z, 0, 0), mira: 0 }));
    for (const { l, pos, mira } of quienes) {
      const v = await this.quieto(l.id, pos.x, pos.z, mira, 0.73);
      const ancla = v?.raiz ?? Object.assign(new THREE.Object3D(), { position: new THREE.Vector3(pos.x, 0.73, pos.z) });
      if (!v) this.grupo.add(ancla);
      this.etiqueta(ancla, 3.2, enJuego ? `${esc(l.nombre)} · x${l.cuota}` : `🏆 ${esc(l.nombre)}`, "zona-viva pelea");
    }
    const ganador = p.ganador === p.a.id ? p.a.nombre : p.ganador === p.b.id ? p.b.nombre : null;
    this.fichas.arena =
      p.estado === "abierta"
        ? `⚔️ <b>${esc(p.a.nombre)} vs ${esc(p.b.nombre)}</b><br>Apuestas abiertas hasta las ${hora(p.cierraAt)} (x${p.a.cuota} · x${p.b.cuota}). Apuesta en Discord con /pelea.`
        : p.estado === "peleando"
          ? `⚔️ <b>${esc(p.a.nombre)} vs ${esc(p.b.nombre)}</b><br>¡Están peleando ahora! Míralo en #peleas.`
          : `⚔️ <b>Arena del 1vs1</b><br>La última pelea la ganó ${esc(ganador ?? "nadie")} (${esc(p.a.nombre)} vs ${esc(p.b.nombre)}).`;
  }

  private async mercado(e: EstadoMundo): Promise<void> {
    if (!e.mercado.abierto) {
      this.fichas.mercado = `🕶️ <b>Mercado negro</b> · Cerrado<br>Abre una hora al día, a hora sorpresa. Neru llega cuando abre.`;
      return;
    }
    const t = TIENDAS.find((x) => x.id === "mercado")!;
    const frente = enZona(t.x, t.z, 0, 1.7);
    const v = await this.quieto("neru", frente.x, frente.z, 0);
    if (v) this.etiqueta(v.raiz, 3, "🕶️ Neru", "zona-viva mercado");
    this.fichas.mercado = `🕶️ <b>Mercado negro</b> · ¡Abierto!<br>Neru atiende hasta las ${hora(e.mercado.cierra)}. Solo con monedas ganadas.`;
  }

  private fama(e: EstadoMundo, aspectos: Record<string, Aspecto>): void {
    const z = zona("fama");
    // Podios: 1.º al centro (el mas alto), 2.º a la izquierda y 3.º a la derecha, como en escena.ts.
    const podios: [number, number][] = [[0, 1.5], [-1.7, 1], [1.7, 0.7]];
    const mira = 0;
    e.fama.forEach((f, i) => {
      const [lx, alto] = podios[i]!;
      const pos = enZona(z.x, z.z, lx, -1);
      const p = this.papu(aspectos[f.papuId], pos.x, pos.z, alto, mira);
      this.etiqueta(p.raiz, 2.2, `${i + 1}. ${esc(f.nombre)} · Nv. ${f.nivel}${f.prestigio ? ` ✦${f.prestigio}` : ""}`, "zona-viva fama");
    });
    if (e.fama.length) this.fichas.fama = `🏆 <b>Salón de la fama</b><br>${e.fama.map((f, i) => `${i + 1}. ${esc(f.nombre)} · Nv. ${f.nivel} (${esc(f.rango)})`).join("<br>")}`;
  }

  private sorteo(e: EstadoMundo): void {
    if (!e.sorteo) return;
    const z = zona("sorteo");
    const pos = enZona(z.x, z.z, 0, -1.5);
    const ancla = new THREE.Object3D();
    ancla.position.set(pos.x, 1, pos.z);
    this.grupo.add(ancla);
    this.etiqueta(ancla, 2.2, `🎁 ${esc(e.sorteo.premio || "Sorteo")} → ${esc(e.sorteo.nombre)}`, "zona-viva sorteo");
    this.fichas.sorteo = `🎁 <b>Sorteo de GyroP</b><br>El último lo ganó ${esc(e.sorteo.nombre)}: ${esc(e.sorteo.premio || "premio sorpresa")}.`;
  }
}
