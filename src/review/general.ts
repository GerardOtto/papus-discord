// Registro completo de #general (npm run conversaciones): como ahí el lenguaje es libre (PLAN §7), GyroP lo lee una vez
// al día para moderar a mano el acoso y el maltrato a Papus inocentes (/advertir, /strikes). Con nombres reales (hay que
// saber a quién advertir); el informe queda en data/ (fuera del repo). Arriba, lo que en otro canal habría sido sanción,
// para saber dónde mirar primero: son reglas fijas, nunca el LLM (regla 3).
import type { RuleSet } from "../moderation/rules";

export interface GeneralMessage {
  id: string;
  /** "general" o el nombre del hilo. */
  channel: string;
  authorId: string;
  /** "Nombre (@usuario)". */
  authorName: string;
  /** Contenido crudo de Discord (con <@id>). */
  content: string;
  createdAt: number;
  replyToId: string | null;
  /** Nombres de los adjuntos (imágenes, videos…). */
  attachments: string[];
}

export interface GeneralInput {
  messages: GeneralMessage[];
  /** userId del bot -> nombre del personaje. */
  bots: ReadonlyMap<string, string>;
  /** GyroP (sale como "GyroP" y no se marca). */
  owners: ReadonlySet<string>;
  rules: RuleSet;
  /** Nombres de los mencionados que no escribieron en el periodo (userId -> "Nombre (@usuario)"). */
  userNames?: ReadonlyMap<string, string>;
  title: string;
  timeZone: string;
}

export interface Flagged {
  message: GeneralMessage;
  detail: string;
}

/** Mensajes de Papus que fuera de #general habrían sido sanción (mayúsculas no cuentan). */
export function flagGeneral(input: Omit<GeneralInput, "title" | "timeZone">): Flagged[] {
  const byId = new Map(input.messages.map((m) => [m.id, m]));
  const out: Flagged[] = [];
  for (const m of input.messages) {
    if (input.bots.has(m.authorId) || input.owners.has(m.authorId)) continue;
    const replied = m.replyToId ? byId.get(m.replyToId) : undefined;
    const mentioned = [...m.content.matchAll(/<@!?(\d+)>/g)].map((x) => x[1]!).filter((id) => id !== m.authorId);
    const targetsSomeone = mentioned.some((id) => !input.bots.has(id)) || (!!replied && !input.bots.has(replied.authorId) && replied.authorId !== m.authorId);
    const targetsBot = mentioned.some((id) => input.bots.has(id)) || (!!replied && input.bots.has(replied.authorId));
    const v = input.rules.check({ text: m.content, targetsSomeone, targetsBot, memberAgeHours: 1000 });
    if (v && v.kind !== "mayusculas") out.push({ message: m, detail: v.detail });
  }
  return out;
}

export function renderGeneral(input: GeneralInput): string {
  const hour = (t: number) => new Intl.DateTimeFormat("es-CL", { timeZone: input.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
  const names = new Map<string, string>(input.userNames);
  for (const m of input.messages) names.set(m.authorId, who(m, input));
  const plain = (text: string) => text.replace(/<@!?(\d+)>/g, (_, id: string) => `@${names.get(id)?.replace(/ \(@.*\)$/, "") ?? "alguien"}`).replace(/\n/g, " ");
  const line = (m: GeneralMessage) => {
    const files = m.attachments.length ? ` [adjunto: ${m.attachments.join(", ")}]` : "";
    return `${plain(m.content)}${files}`.trim() || "_(sin texto)_";
  };

  const flagged = flagGeneral(input);
  const flaggedIds = new Set(flagged.map((f) => f.message.id));
  const papus = new Set(input.messages.filter((m) => !input.bots.has(m.authorId)).map((m) => m.authorId));
  const lines = [
    `# ${input.title}`,
    "",
    `${input.messages.length} mensajes de ${papus.size} personas. ⚠️ = en otro canal habría sido sanción (${flagged.length}).`,
    "Ojo: lo marcado es solo dónde mirar primero. El acoso y el maltrato sin groserías no se marcan: lee todo.",
  ];
  if (flagged.length) {
    lines.push("", "## ⚠️ Para revisar primero");
    for (const f of flagged) lines.push(`- ${hour(f.message.createdAt)} · ${channelLabel(f.message.channel)} · **${names.get(f.message.authorId)}** · ${f.detail}: ${line(f.message)}`);
  }

  const byId = new Map(input.messages.map((m) => [m.id, m]));
  const channels = [...new Set(input.messages.map((m) => m.channel))].sort((a, b) => (a === "general" ? -1 : b === "general" ? 1 : a.localeCompare(b)));
  for (const ch of channels) {
    lines.push("", `## ${channelLabel(ch)}`, "");
    for (const m of input.messages.filter((x) => x.channel === ch).sort((a, b) => a.createdAt - b.createdAt)) {
      const replied = m.replyToId ? byId.get(m.replyToId) : undefined;
      const to = replied ? ` ↪ ${names.get(replied.authorId)?.replace(/ \(@.*\)$/, "")}` : "";
      lines.push(`- ${flaggedIds.has(m.id) ? "⚠️ " : ""}${hour(m.createdAt)} **${names.get(m.authorId)}**${to}: ${line(m)}`);
    }
  }
  if (!input.messages.length) lines.push("", "No hubo mensajes en #general en este periodo.");
  return `${lines.join("\n")}\n`;
}

function who(m: GeneralMessage, input: Pick<GeneralInput, "bots" | "owners">): string {
  const bot = input.bots.get(m.authorId);
  if (bot) return `${bot} (bot)`;
  return input.owners.has(m.authorId) ? "GyroP" : m.authorName;
}

const channelLabel = (ch: string) => (ch === "general" ? "#general" : `#general › hilo "${ch}"`);
