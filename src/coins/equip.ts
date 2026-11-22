// Objetos equipados -> dibujos de la tarjeta de nivel (src/levels/card.ts, CardEquip). Los fondos con renders y la
// insignia de fundador son imágenes de assets/coleccion (se cargan una vez); lo demás, los dibujos de src/coins/arte.ts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadImage, type Image } from "@napi-rs/canvas";
import type { CardEquip } from "../levels/card";
import { CARD_H, CARD_W } from "../levels/card";
import { AROS, BARRAS, BORDES, FONDOS, NOMBRES, bordeFundador, type Paint } from "./arte";
import { EFECTOS } from "./efectos";
import { RAREZA_COLOR, type Objeto } from "./rules";

export const COLECCION_DIR = path.resolve(import.meta.dirname, "../../assets/coleccion");
const images = new Map<string, Promise<Image | null>>();

/** Imagen de assets/coleccion (cacheada). null si falta el archivo. */
export function coleccionImage(rel: string): Promise<Image | null> {
  let p = images.get(rel);
  if (!p) {
    const file = path.join(COLECCION_DIR, rel);
    p = existsSync(file) ? loadImage(readFileSync(file)).catch(() => null) : Promise.resolve(null);
    images.set(rel, p);
  }
  return p;
}

/** ¿Existe el dibujo de un objeto de arte propio? (para validar el catálogo). */
export function hasArt(o: Objeto): boolean {
  if (o.origen === "render") return !o.efecto || o.efecto in EFECTOS;
  switch (o.tipo) {
    case "fondo": return o.id in FONDOS;
    case "borde": return o.id in BORDES || o.id === "estrella-fundadora";
    case "barra": return o.id in BARRAS;
    case "nombre": return o.id in NOMBRES;
    case "aro": return o.id in AROS;
    case "insignia":
    case "titulo": return !!o.valor;
  }
}

/**
 * Fondo animado con renders: la escena detrás (dibujada, o una foto real con la luz y el movimiento de la escena
 * encima), los personajes (capa transparente) y lo que pasa por delante.
 */
export function escena(efecto: string, personajes: Image | null, colores: string[], foto: Image | null = null): Paint {
  const ef = EFECTOS[efecto]!;
  return (ctx, t) => {
    if (foto) {
      ctx.drawImage(foto, 0, 0, CARD_W, CARD_H);
      ef.sobreFoto?.(ctx, t, colores);
    } else ef.atras(ctx, t, colores);
    if (personajes) ctx.drawImage(personajes, 0, 0, CARD_W, CARD_H);
    ef.delante?.(ctx, t, colores);
  };
}

/** Lo equipado (ranura -> objeto) convertido en lo que dibuja la tarjeta. `fundador` = su número, para el borde. */
export async function toCardEquip(equipped: Map<string, Objeto>, fundador: number | null): Promise<CardEquip> {
  const e: CardEquip = {};
  let animado = false;
  for (const [ranura, o] of equipped) {
    if (o.animado) animado = true;
    switch (o.tipo) {
      case "fondo":
        if (o.origen === "render" && o.efecto && EFECTOS[o.efecto]) {
          e.fondo = escena(o.efecto, (o.imagen && (await coleccionImage(o.imagen))) || null, o.colores ?? [], (o.foto && (await coleccionImage(o.foto))) || null);
          animado = true;
        } else if (o.origen === "render" && o.imagen) e.fondo = (await coleccionImage(o.imagen)) ?? undefined;
        else if (FONDOS[o.id]) e.fondo = FONDOS[o.id];
        // Fondo reencuadrado con el personaje a la derecha (18 nov. 2026): la tarjeta deja el avatar y los datos a la
        // izquierda, elija lo que elija el Papu.
        if (o.encuadre) e.lado = o.lado ?? "izquierda";
        break;
      case "borde":
        if (o.id === "estrella-fundadora") e.borde = bordeFundador(fundador ?? 0);
        else if (BORDES[o.id]) e.borde = BORDES[o.id];
        break;
      case "barra":
        if (BARRAS[o.id]) e.barra = BARRAS[o.id];
        break;
      case "nombre":
        if (NOMBRES[o.id]) e.nombre = NOMBRES[o.id];
        break;
      case "aro":
        if (AROS[o.id]) e.aro = AROS[o.id];
        break;
      case "insignia": {
        const slot = Number(ranura.slice("insignia".length)) - 1;
        const list = (e.insignias ??= []);
        list[Math.max(0, slot)] = o.imagen ? ((await coleccionImage(o.imagen)) ?? o.valor ?? "⭐") : o.valor!;
        break;
      }
      case "titulo":
        e.titulo = { texto: o.valor!, color: o.rareza === "mitica" ? "rainbow" : RAREZA_COLOR[o.rareza] };
        if (o.rareza === "mitica") animado = true;
        break;
    }
  }
  if (e.insignias) e.insignias = e.insignias.filter((x) => x !== undefined);
  e.animado = animado;
  return e;
}
