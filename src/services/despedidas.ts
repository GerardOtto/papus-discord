// #👋・despedidas (idea de Flor_fino en #ideas-y-opiniones, 31 oct. 2026; GyroP, 18 nov.): Teto avisa quién se fue del
// servidor con una frase fija (teto.se_fue, sin LLM ni cuota) y cuánto estuvo. Sin mención (ya no está: Discord la
// mostraría como «@usuario-desconocido»), con su nombre y su @. A los baneados no los despide: eso es de GyroP.

export interface Despedida {
  /** Nombre visible (apodo del servidor o nombre global) y nombre de usuario. */
  nombre: string;
  usuario: string;
  /** Cuándo entró (ms); null si Discord no lo sabe. */
  entro: number | null;
  nivel: number;
  prestigio: number;
}

const DIA = 86_400_000;

/** «3 días», «1 día», «hoy mismo». */
export function tiempoEnServidor(entro: number | null, ahora: number): string | null {
  if (entro === null) return null;
  const dias = Math.floor((ahora - entro) / DIA);
  if (dias < 1) return "llegó hoy mismo";
  return `estuvo **${dias}** ${dias === 1 ? "día" : "días"}`;
}

/** Texto del aviso: la frase de Teto y una línea con su tiempo en el servidor y su nivel. */
export function textoDespedida(frase: (papu: string) => string, d: Despedida, ahora: number): string {
  const quien = d.nombre && d.nombre.toLowerCase() !== d.usuario.toLowerCase() ? `**${d.nombre}** (@${d.usuario})` : `**@${d.usuario}**`;
  const datos = [tiempoEnServidor(d.entro, ahora), d.prestigio > 0 ? `prestigio ${d.prestigio}, nivel ${d.nivel}` : `nivel ${d.nivel}`].filter(Boolean).join(" · ");
  return `👋 ${frase(quien)}\n-# ${datos[0]!.toUpperCase()}${datos.slice(1)}`;
}
