// Redes de los Papus para #🎨・fanart (PLAN §8; pedido de GyroP, 13 nov. 2026). Opcional: cada Papu guarda su usuario
// de Instagram y de X con /redes y Teto los muestra en cada fanart suyo. Solo se acepta el formato de usuario (nunca
// un enlace cualquiera) y el enlace lo arma el bot. Como hay Papus de 14 años, nunca se toma nada de su perfil sin que
// lo pida.
import type { Db } from "../db/database";

export interface Redes {
  instagram: string | null;
  x: string | null;
}

/** Usuario de Instagram (sin @): letras, números, punto y guion bajo, hasta 30. null si no sirve. */
export function usuarioInstagram(texto: string): string | null {
  const u = texto.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(u) && !/^\.|\.\.|\.$/.test(u) ? u : null;
}

/** Usuario de X/Twitter (sin @): letras, números y guion bajo, hasta 15. null si no sirve. */
export function usuarioX(texto: string): string | null {
  const u = texto.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/\/.*$/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(u) ? u : null;
}

/** Enlaces para mostrar (vacío si no guardó nada). */
export function enlacesRedes(r: Redes | null): string[] {
  if (!r) return [];
  return [
    ...(r.instagram ? [`📸 [Instagram](https://instagram.com/${r.instagram})`] : []),
    ...(r.x ? [`𝕏 [X](https://x.com/${r.x})`] : []),
  ];
}

export class RedesStore {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  get(userId: string): Redes | null {
    const r = this.db.prepare("SELECT instagram, x FROM redes WHERE user_id = ?").get(userId) as { instagram: string | null; x: string | null } | undefined;
    return r && (r.instagram || r.x) ? { instagram: r.instagram, x: r.x } : null;
  }

  /** Guarda (o borra, con null) sus redes. */
  set(userId: string, r: Redes): void {
    if (!r.instagram && !r.x) {
      this.db.prepare("DELETE FROM redes WHERE user_id = ?").run(userId);
      return;
    }
    this.db.prepare("INSERT INTO redes (user_id, instagram, x, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET instagram = excluded.instagram, x = excluded.x, at = excluded.at").run(userId, r.instagram, r.x, this.now());
  }
}
