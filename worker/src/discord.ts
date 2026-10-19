// Discord desde Cloudflare: verificacion de firma de las interacciones y llamadas a la API REST (sin conexion
// permanente: el worker solo responde comandos y tareas programadas).
export type BotKey = "miku" | "luka";

export interface DiscordApi {
  /** Llamada a la API con el token del bot. */
  call<T = unknown>(bot: BotKey, method: string, path: string, body?: unknown): Promise<T>;
  /** Edita la respuesta (diferida) de una interaccion. No usa el token del bot. */
  editOriginal(applicationId: string, token: string, body: unknown): Promise<void>;
  /** Mensaje adicional de la interaccion (ultimo recurso si no se pudo editar). */
  followUp(applicationId: string, token: string, body: unknown): Promise<void>;
}

const API = "https://discord.com/api/v10";

/**
 * Candado contra @everyone y @here: los bots tienen ese permiso (Discord lo exige para mencionar los roles de nivel,
 * que no son mencionables), asi que ningun mensaje lo usa aunque el texto lo traiga. Solo notifica a los usuarios y
 * roles que el envio nombra; sin `allowed_mentions`, solo a los usuarios.
 */
export function safeMentions(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const b = body as Record<string, unknown>;
  if (!("content" in b || "embeds" in b || "poll" in b || "allowed_mentions" in b)) return body;
  const am = (b.allowed_mentions ?? { parse: ["users"] }) as { parse?: string[] };
  return { ...b, allowed_mentions: { ...am, parse: (am.parse ?? []).filter((p) => p === "users") } };
}

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function restApi(tokens: Record<BotKey, string>, fetchFn: typeof fetch = fetch): DiscordApi {
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      // Cada llamada tiene su propio tope: una conexion trabada no deja al worker esperando.
      const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(8000) });
      if (res.status !== 429 || attempt >= 2) return res;
      const wait = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, Math.min(5, Number.isFinite(wait) ? wait : 1) * 1000));
    }
  };
  const parse = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new DiscordError(res.status, `Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  };
  return {
    call: async <T>(bot: BotKey, method: string, path: string, body?: unknown) =>
      parse<T>(
        await send(`${API}${path}`, {
          method,
          headers: { Authorization: `Bot ${tokens[bot]}`, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(safeMentions(body)),
        }),
      ),
    editOriginal: async (applicationId, token, body) => {
      // Si el trabajo termina muy rapido (ej.: un error de validacion), Discord puede no haber registrado aun la
      // respuesta diferida y contesta "Unknown Webhook" (10015): se espera un poco y se reintenta.
      for (let attempt = 0; ; attempt++) {
        const res = await send(`${API}/webhooks/${applicationId}/${token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(safeMentions(body)),
        });
        if (res.status === 404 && attempt < 6) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        await parse(res);
        return;
      }
    },
    followUp: async (applicationId, token, body) => {
      await parse(
        await send(`${API}/webhooks/${applicationId}/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(safeMentions(body)),
        }),
      );
    },
  };
}

const hexToBytes = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));

/** Discord firma cada interaccion con Ed25519: sin firma valida, el worker no responde nada. */
export async function verifySignature(publicKeyHex: string, signatureHex: string, timestamp: string, body: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signatureHex), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

/** Nombre de canal o rol comparable: sin emojis, acentos, mayusculas ni signos ("🗳️・votaciones" = "votaciones"). */
export function channelKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}
