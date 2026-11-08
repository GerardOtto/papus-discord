// Imágenes fijas de la tienda (menú, paquetes, sobre cerrado, ayuda y la vitrina vigente): Teto las sube UNA vez a un
// hilo de staff («🖼️ Imágenes de la tienda», en #registro-bots) y las pantallas privadas solo apuntan a ellas, en vez de
// volver a subirlas en cada botón (pedido de GyroP, 27 oct. 2026: ahorrar uso del servidor). Se vuelven a subir solo si
// cambian (versión distinta). Discord firma las direcciones de los adjuntos y las vence cada tanto: si a una le queda
// poco, se pide el mensaje otra vez y viene con la dirección renovada.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AttachmentBuilder, ChannelType, ThreadAutoArchiveDuration, type Guild, type Message, type TextChannel, type ThreadChannel } from "discord.js";
import { kvGet, kvSet, type Db } from "../db/database";
import { CHANNELS, findTextChannel } from "./channels";

const THREAD_KEY = "tienda:img:hilo";
const THREAD_NAME = "🖼️ Imágenes de la tienda";
/** Margen antes del vencimiento para renovar la dirección (las pantallas viven a lo más 15 min). */
const MARGIN_MS = 3 * 3_600_000;

interface Stored {
  version: string;
  messageId: string;
  url: string;
}

/** Cuándo vence una dirección firmada de Discord (parámetro ex=, segundos en hexadecimal). null si no trae. */
export function urlExpiry(url: string): number | null {
  try {
    const ex = new URL(url).searchParams.get("ex");
    return ex ? parseInt(ex, 16) * 1000 : null;
  } catch {
    return null;
  }
}

/** Versión de un archivo según su contenido (cambia solo si el archivo cambia). */
export function fileVersion(...files: string[]): string {
  const h = createHash("sha1");
  for (const f of files) h.update(readFileSync(f));
  return h.digest("hex").slice(0, 12);
}

export class StoredImages {
  /** Una subida a la vez: dos pantallas pidiendo la misma imagen no la suben dos veces. */
  private pending = new Map<string, Promise<string | null>>();

  constructor(private readonly d: { db: Db; guild: () => Guild; now?: () => number }) {}

  /** Dirección de la imagen `key` en su versión `version` (la sube con `make` si falta o cambió). */
  url(key: string, version: string, make: () => Promise<Buffer>, name: string): Promise<string | null> {
    const id = `${key}:${version}`;
    let p = this.pending.get(id);
    if (!p) {
      p = this.resolve(key, version, make, name).finally(() => this.pending.delete(id));
      this.pending.set(id, p);
    }
    return p;
  }

  private async resolve(key: string, version: string, make: () => Promise<Buffer>, name: string): Promise<string | null> {
    const kvKey = `tienda:img:${key}`;
    const prev = JSON.parse(kvGet(this.d.db, kvKey) ?? "null") as Stored | null;
    const thread = await this.thread();
    if (!thread) return null;
    const now = (this.d.now ?? Date.now)();
    if (prev?.version === version) {
      const ex = urlExpiry(prev.url);
      if (ex === null || ex - now > MARGIN_MS) return prev.url;
      const msg = await thread.messages.fetch(prev.messageId).catch(() => null);
      const fresh = msg?.attachments.first()?.url;
      if (fresh) {
        kvSet(this.d.db, kvKey, JSON.stringify({ ...prev, url: fresh }));
        return fresh;
      }
    }
    const msg: Message = await thread.send({ content: `${key} · ${version}`, files: [new AttachmentBuilder(await make(), { name })] });
    const url = msg.attachments.first()?.url;
    if (!url) return null;
    kvSet(this.d.db, kvKey, JSON.stringify({ version, messageId: msg.id, url } satisfies Stored));
    // La versión vieja ya no se usa: se borra para que el hilo no crezca.
    if (prev && prev.messageId !== msg.id) await thread.messages.delete(prev.messageId).catch(() => {});
    return url;
  }

  /** El hilo de staff donde viven las imágenes (lo crea si no existe). */
  private async thread(): Promise<ThreadChannel | null> {
    const guild = this.d.guild();
    const saved = kvGet(this.d.db, THREAD_KEY);
    if (saved) {
      const t = await guild.channels.fetch(saved).catch(() => null);
      if (t?.isThread()) {
        if (t.archived) await t.setArchived(false).catch(() => {});
        return t;
      }
    }
    const parent = findTextChannel(guild, CHANNELS.registro) as TextChannel | null;
    if (!parent || parent.type !== ChannelType.GuildText) return null;
    const t = await parent.threads.create({ name: THREAD_NAME, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, reason: "Imágenes fijas de la tienda" });
    kvSet(this.d.db, THREAD_KEY, t.id);
    return t;
  }
}
