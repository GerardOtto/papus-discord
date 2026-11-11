// Ventana centrada de la plaza (decision de GyroP, 9 nov. 2026): un tablero con la estetica del canal, como la
// Actividad de la trivia (degradado vino a marino con cuadricula, Fredoka con contorno y la franja de colores al pie).
// La usan la ruleta y, despues, la tienda, el mercado negro, la mochila y las apuestas. Una sola a la vez.

export class Ventana {
  private readonly fondo: HTMLElement;
  private readonly titulo: HTMLElement;
  readonly cuerpo: HTMLElement;
  private alCerrar: (() => void) | null = null;
  /** Que ventana esta abierta ("ruleta"…), o null. */
  id: string | null = null;

  constructor(raiz: HTMLElement) {
    this.fondo = raiz;
    raiz.innerHTML = `<div class="ventana" role="dialog" aria-modal="true" aria-labelledby="ventana-titulo">
        <header class="ventana-cabeza"><h2 id="ventana-titulo" class="ventana-titulo"></h2><button class="ventana-cerrar" type="button" aria-label="Cerrar">✕</button></header>
        <div class="ventana-cuerpo"></div>
      </div>`;
    this.titulo = raiz.querySelector(".ventana-titulo")!;
    this.cuerpo = raiz.querySelector(".ventana-cuerpo")!;
    raiz.querySelector(".ventana-cerrar")!.addEventListener("click", () => this.cerrar());
    // Clic fuera de la ventana: se cierra.
    raiz.addEventListener("pointerdown", (e) => {
      if (e.target === raiz) this.cerrar();
    });
  }

  get abierta(): boolean {
    return this.id !== null;
  }

  abrir(id: string, titulo: string, html: string, alCerrar?: () => void): void {
    if (this.id && this.id !== id) this.cerrar();
    this.id = id;
    this.alCerrar = alCerrar ?? null;
    this.titulo.innerHTML = titulo;
    this.cuerpo.innerHTML = html;
    this.fondo.hidden = false;
    this.fondo.querySelector<HTMLButtonElement>(".ventana-cerrar")!.focus({ preventScroll: true });
  }

  /** Cambia el contenido sin mover el scroll (si sigue abierta la misma ventana). */
  poner(id: string, html: string): void {
    if (this.id !== id) return;
    const y = this.cuerpo.scrollTop;
    this.cuerpo.innerHTML = html;
    this.cuerpo.scrollTop = y;
  }

  cerrar(): void {
    if (!this.id) return;
    this.id = null;
    this.fondo.hidden = true;
    const f = this.alCerrar;
    this.alCerrar = null;
    f?.();
  }
}
