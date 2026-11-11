// Registro en consola con hora. Nunca recibe tokens ni claves (los errores de los proveedores ya vienen resumidos).
export type LogFn = (msg: string) => void;

// Hora local del PC (sv-SE da el formato AAAA-MM-DD HH:MM:SS).
const stamp = () => new Date().toLocaleString("sv-SE");

export const log: LogFn = (msg) => console.log(`[${stamp()}] ${msg}`);
export const logError = (msg: string, err?: unknown) =>
  console.error(`[${stamp()}] ✘ ${msg}${err ? `: ${(err as Error)?.message ?? String(err)}` : ""}`);
