// Tablero publico de la cola (#cola-de-pedidos, lo ven los Triple Baka): numero, ocasion, quien lo pidio (mencion),
// estado y plazo. NUNCA el nombre de quien recibe el video ni los detalles (datos de un tercero).
import { OCCASIONS, STATE_LABEL, type Order } from "./queue";

const MAX_LINES = 40;
const unix = (ms: number) => Math.floor(ms / 1000);

export function boardLine(o: Order, position: number): string {
  const who = o.origen === "tienda" ? (o.papuId ? `<@${o.papuId}> (tienda)` : "🛍️ pedido de la tienda") : `<@${o.papuId}>`;
  return `\`${String(position).padStart(2, " ")}.\` **#${o.id}** · ${OCCASIONS[o.ocasion]} · ${who} · ${STATE_LABEL[o.estado]} · a más tardar <t:${unix(o.plazoAt)}:D>`;
}

export function renderBoard(active: Order[], deliveredLast30Days: number): { title: string; description: string; footer: string } {
  const lines = active.slice(0, MAX_LINES).map((o, i) => boardLine(o, i + 1));
  if (active.length > MAX_LINES) lines.push(`…y ${active.length - MAX_LINES} más.`);
  return {
    title: "📋 Así va la cola",
    description: active.length
      ? `Por orden de llegada, sin saltarse a nadie ✨\n\n${lines.join("\n")}`
      : "¡La cola está vacía! Si eres 💥 **Triple Baka**, pide el tuyo con **/pedido** ✨ ٩(◕‿◕)۶",
    footer: `🎬 ${active.length} en la cola · ✅ ${deliveredLast30Days} entregados en los últimos 30 días · /mi-pedido para ver el tuyo`,
  };
}
