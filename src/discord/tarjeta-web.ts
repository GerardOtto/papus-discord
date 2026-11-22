// Puente del bot con la página de personalizar la tarjeta (worker/src/tarjeta/api.ts). Crea la sesión con lo que el
// Papu tiene (enlace privado de 30 min) y, mientras haya alguna abierta, cada 3 s toma los pedidos: «vista previa»
// dibuja su tarjeta real con lo elegido; «guardar» lo aplica (solo lo que tiene) y devuelve cómo quedó.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { toCardEquip } from "../coins/equip";
import type { CoinService } from "../coins/service";
import { aplicar, elegidos, snapshot, type Eleccion } from "../coins/tarjeta-web";
import { renderCard, type CardData, type CardEquip } from "../levels/card";
import type { LevelStore } from "../levels/store";

export interface TarjetaWebDeps {
  coins: CoinService;
  store: LevelStore;
  /** Datos de su tarjeta (nivel, avatar, frase…), como en /nivel. */
  cardData: (userId: string) => Promise<CardData>;
  /** Número de fundador (para el borde de estrellas). */
  founder: (userId: string) => number | null;
  /** https://papus-bots.<sub>.workers.dev (PAPUS_WEB en .env). */
  base: string;
  /** TARJETA_CLAVE en .env (la misma que tiene el worker). */
  clave: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

const SESION_MS = 30 * 60_000;

/** La tarjeta dibujada (fija: un cuadro), en JPEG base64. También la usa el celular de Neru (Mi tarjeta). */
export async function dibujarTarjeta(cardData: (userId: string) => Promise<CardData>, userId: string, equip: CardEquip, lado: Eleccion["lado"]): Promise<string> {
  const png = await renderCard({ ...(await cardData(userId)), lado }, { ...equip, animado: false });
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#16131f";
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return c.toBuffer("image/jpeg", 88).toString("base64");
}

export class TarjetaWeb {
  private abiertaHasta = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private trabajando = false;

  constructor(private readonly d: TarjetaWebDeps) {}

  private get f(): typeof fetch {
    return this.d.fetch ?? fetch;
  }

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await this.f(`${this.d.base}/tarjeta/api/${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-papus-clave": this.d.clave, ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`tarjeta web ${path}: HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  private dibujar(userId: string, equip: CardEquip, lado: Eleccion["lado"]): Promise<string> {
    return dibujarTarjeta(this.d.cardData, userId, equip, lado);
  }

  /** Crea la sesión y devuelve el enlace privado. Empieza a escuchar pedidos. */
  async abrir(userId: string, nombre: string): Promise<string> {
    const lado = this.d.store.get(userId).card.lado;
    const datos = snapshot(this.d.coins, userId, nombre, lado);
    datos.tarjeta = await this.dibujar(userId, await toCardEquip(this.d.coins.equipped(userId), this.d.founder(userId)), datos.equipado.lado);
    const r = await this.api<{ token: string }>("sesion", { method: "POST", body: JSON.stringify({ papu: userId, datos }) });
    this.abiertaHasta = this.now() + SESION_MS;
    this.iniciar();
    return `${this.d.base}/tarjeta/?t=${r.token}`;
  }

  private iniciar(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 3000);
    this.timer.unref?.();
  }

  /** Toma y resuelve los pedidos pendientes. Se apaga solo cuando ya no queda ninguna sesión abierta. */
  async tick(): Promise<number> {
    if (this.trabajando) return 0;
    if (this.now() > this.abiertaHasta) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return 0;
    }
    this.trabajando = true;
    try {
      const pedidos = await this.api<{ id: number; papu: string; tipo: "vista" | "guardar"; eleccion: Eleccion }[]>("pendientes");
      for (const p of pedidos) await this.resolver(p).catch((e) => this.d.log?.(`tarjeta web pedido ${p.id}: ${(e as Error).message}`));
      return pedidos.length;
    } catch (e) {
      this.d.log?.(`tarjeta web: ${(e as Error).message}`);
      return 0;
    } finally {
      this.trabajando = false;
    }
  }

  private async resolver(p: { id: number; papu: string; tipo: "vista" | "guardar"; eleccion: Eleccion }): Promise<void> {
    const lado = p.eleccion.lado === "derecha" ? "derecha" : "izquierda";
    const nota = (descartados: string[]) => (descartados.length ? ` (${descartados.length} objeto(s) que ya no tienes no se pusieron)` : "");
    try {
      if (p.tipo === "vista") {
        const { equipo, descartados } = elegidos(this.d.coins, p.papu, p.eleccion);
        const imagen = await this.dibujar(p.papu, await toCardEquip(equipo, this.d.founder(p.papu)), lado);
        const animado = [...equipo.values()].some((o) => o.animado || o.rareza === "mitica");
        await this.api("resultado", {
          method: "POST",
          body: JSON.stringify({ id: p.id, ok: true, imagen, mensaje: `Así se vería${animado ? " (en Discord se mueve)" : ""}. Si te gusta, toca Guardar.${nota(descartados)}` }),
        });
        return;
      }
      const { descartados } = aplicar(this.d.coins, p.papu, p.eleccion);
      this.d.store.setCard(p.papu, { lado: lado === "derecha" ? "derecha" : null });
      const imagen = await this.dibujar(p.papu, await toCardEquip(this.d.coins.equipped(p.papu), this.d.founder(p.papu)), lado);
      const datos = snapshot(this.d.coins, p.papu, "", this.d.store.get(p.papu).card.lado);
      await this.api("resultado", {
        method: "POST",
        body: JSON.stringify({ id: p.id, ok: true, imagen, mensaje: `¡Guardado! Así sale en /nivel.${nota(descartados)}`, datos: { ...datos, nombre: undefined } }),
      });
    } catch (e) {
      await this.api("resultado", { method: "POST", body: JSON.stringify({ id: p.id, ok: false, mensaje: "No pude dibujar tu tarjeta. Prueba de nuevo." }) });
      throw e;
    }
  }
}
