// Revisión de conversaciones (npm run conversaciones): junta cada respuesta de los Vocaloids con el mensaje del Papu
// que la provocó, para buscar alucinaciones y refinar las fichas. Solo lectura del historial de Discord; los Papus
// salen con seudónimo ("Papu 3") y el informe queda en data/ (fuera del repo). Sin Discord: se prueba con datos.

export interface RawMessage {
  id: string;
  channel: string;
  authorId: string;
  /** Contenido crudo de Discord (con <@id>). */
  content: string;
  createdAt: number;
  replyToId: string | null;
}

export interface Answer {
  bot: string;
  text: string;
  /** Frase fija (sin LLM): no sirve para buscar alucinaciones. */
  fixed: boolean;
}

export interface Exchange {
  channel: string;
  at: number;
  papu: string;
  question: string;
  /** Mensajes anteriores del canal (contexto que vio el LLM). */
  context: { author: string; text: string }[];
  answers: Answer[];
}

export interface ReviewInput {
  messages: RawMessage[];
  /** userId del bot -> nombre del personaje. */
  bots: ReadonlyMap<string, string>;
  /** GyroP (sale con su nombre). */
  owners: ReadonlySet<string>;
  isFixedPhrase: (text: string) => boolean;
  contextLines?: number;
}

/** Reconoce frases fijas de content/frases: cada {campo} acepta cualquier texto. */
export function fixedPhraseMatcher(phrases: string[]): (text: string) => boolean {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = phrases.map((p) => new RegExp(`^${p.split(/\{\w+\}/).map(escape).join("[\\s\\S]+?")}$`));
  return (text) => patterns.some((r) => r.test(text.trim()));
}

export function buildExchanges(input: ReviewInput): Exchange[] {
  const { bots, owners } = input;
  const contextLines = input.contextLines ?? 3;
  const sorted = [...input.messages].sort((a, b) => a.createdAt - b.createdAt);
  const byId = new Map(sorted.map((m) => [m.id, m]));
  const aliases = new Map<string, string>();
  const nameOf = (userId: string): string => {
    const bot = bots.get(userId);
    if (bot) return bot;
    if (owners.has(userId)) return "GyroP";
    let alias = aliases.get(userId);
    if (!alias) aliases.set(userId, (alias = `Papu ${aliases.size + 1}`));
    return alias;
  };
  // Seudónimos en orden cronológico ("Papu 1" = el primero que escribió en el periodo).
  for (const m of sorted) nameOf(m.authorId);
  const clean = (text: string) =>
    text.replace(/<@!?(\d+)>/g, (_, id: string) => `@${bots.get(id) ?? (owners.has(id) ? "GyroP" : aliases.get(id) ?? "alguien")}`).trim();

  const out: Exchange[] = [];
  const byQuestion = new Map<string, Exchange>();
  for (const m of sorted) {
    const bot = bots.get(m.authorId);
    if (!bot || !m.replyToId) continue;
    const q = byId.get(m.replyToId);
    if (!q || bots.has(q.authorId)) continue;
    let ex = byQuestion.get(q.id);
    if (!ex) {
      const papu = nameOf(q.authorId);
      const before = sorted.filter((x) => x.channel === q.channel && x.createdAt < q.createdAt && x.content.trim()).slice(-contextLines);
      ex = {
        channel: q.channel,
        at: q.createdAt,
        papu,
        question: clean(q.content),
        context: before.map((x) => ({ author: nameOf(x.authorId), text: clean(x.content) })),
        answers: [],
      };
      byQuestion.set(q.id, ex);
      out.push(ex);
    }
    ex.answers.push({ bot, text: clean(m.content), fixed: input.isFixedPhrase(m.content) });
  }
  return out;
}

export function renderReview(exchanges: Exchange[], title: string, timeZone: string): string {
  const hour = (t: number) => new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit" }).format(t);
  const stats = new Map<string, { llm: number; fixed: number }>();
  for (const ex of exchanges)
    for (const a of ex.answers) {
      const s = stats.get(a.bot) ?? { llm: 0, fixed: 0 };
      if (a.fixed) s.fixed++;
      else s.llm++;
      stats.set(a.bot, s);
    }
  const lines = [
    `# ${title}`,
    "",
    "Respuestas por personaje (LLM / frases fijas):",
    ...[...stats.entries()].sort((a, b) => b[1].llm - a[1].llm).map(([bot, s]) => `- ${bot}: ${s.llm} / ${s.fixed}`),
    "",
    "Las respuestas marcadas [frase fija] no usan el LLM: no sirven para buscar alucinaciones.",
  ];
  let channel = "";
  const ordered = [...exchanges].sort((a, b) => a.channel.localeCompare(b.channel) || a.at - b.at);
  for (const ex of ordered) {
    if (ex.channel !== channel) {
      channel = ex.channel;
      lines.push("", `## #${channel}`);
    }
    lines.push("", `### ${hour(ex.at)} · ${ex.papu}`);
    if (ex.context.length) lines.push(...ex.context.map((c) => `> _${c.author}: ${c.text.replace(/\n/g, " ")}_`), ">");
    lines.push(`> **${ex.papu}:** ${ex.question.replace(/\n/g, " ")}`);
    for (const a of ex.answers) lines.push(`- **${a.bot}**${a.fixed ? " [frase fija]" : ""}: ${a.text.replace(/\n/g, " ")}`);
  }
  if (!exchanges.length) lines.push("", "No hubo conversaciones con los Vocaloids en este periodo.");
  return `${lines.join("\n")}\n`;
}
