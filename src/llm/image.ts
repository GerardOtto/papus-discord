// Imagenes para la cadena de vision (PLAN §5.1): se bajan de Discord, se achican y se mandan como data URL JPEG.
// Nada se guarda: la imagen vive solo en memoria mientras dura la peticion.
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Tipos que se miran (un GIF animado se mira por su primer cuadro). */
const TIPOS = /^image\/(?:png|jpe?g|webp|gif)$/i;

export interface ImageAttachment {
  url: string;
  /** Tipo MIME que informa Discord (null si no lo sabe). */
  contentType: string | null;
  /** Peso en bytes. */
  size: number;
}

/** La primera imagen que se puede mirar (tipo conocido y no mas pesada que `maxMB`), o null. */
export function pickImage(attachments: Iterable<ImageAttachment>, maxMB: number): ImageAttachment | null {
  for (const a of attachments) {
    if (a.contentType && TIPOS.test(a.contentType.split(";")[0]!.trim()) && a.size <= maxMB * 1024 * 1024) return a;
  }
  return null;
}

/** Medidas para que el lado mas largo no pase de `max` (nunca agranda). */
export function fitSize(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Achica una imagen (bytes) y la devuelve como data URL JPEG; null si no se puede leer. */
export async function shrinkImage(bytes: Buffer, maxSide: number): Promise<string | null> {
  try {
    const img = await loadImage(bytes);
    if (!img.width || !img.height) return null;
    const { width, height } = fitSize(img.width, img.height, maxSide);
    const c = createCanvas(width, height);
    const ctx = c.getContext("2d");
    // Fondo blanco: un PNG transparente en JPEG quedaria negro y el modelo no veria el dibujo.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return `data:image/jpeg;base64,${c.toBuffer("image/jpeg", 82).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Baja la imagen de Discord y la achica; null si falla (el Vocaloid responde sin verla). */
export async function fetchImage(
  a: ImageAttachment,
  maxSide: number,
  maxMB: number,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const timeout = AbortSignal.timeout(15_000);
    const res = await fetchFn(a.url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxMB * 1024 * 1024) return null;
    return await shrinkImage(buf, maxSide);
  } catch {
    return null;
  }
}
