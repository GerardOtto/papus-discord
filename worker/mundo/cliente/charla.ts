// Ventana de charla con los Vocaloids (pedido de GyroP, 9 nov. 2026): al hablarle a uno con @ (gasta cuota, como en
// Discord) se abre a la izquierda una lista con el mensaje del Papu y debajo la respuesta del Vocaloid, con su nombre
// y su color como borde de la burbuja. Cada mensaje nuevo, a cualquier Vocaloid, sigue la lista hacia abajo. Se puede
// minimizar; minimizada cuenta las respuestas sin leer. Solo la ve quien hablo (las burbujas sobre la cabeza siguen
// siendo para toda la plaza).

/** Nombre visible y color de subtitulos de cada Vocaloid (los de characters.json del motor, ../Proyecto1). */
const VOCALOIDS: Record<string, { nombre: string; color: string }> = {
  teto: { nombre: "Kasane Teto", color: "#E58FB5" },
  miku: { nombre: "Hatsune Miku", color: "#39C5BB" },
  luka: { nombre: "Megurine Luka", color: "#E285B2" },
  neru: { nombre: "Akita Neru", color: "#E8D44D" },
  rin: { nombre: "Kagamine Rin", color: "#F6C744" },
  len: { nombre: "Kagamine Len", color: "#F2B544" },
  kaito: { nombre: "Kaito", color: "#3D6BFF" },
  meiko: { nombre: "Meiko", color: "#E0383E" },
  gumi: { nombre: "Gumi", color: "#7FCB4B" },
  gakupo: { nombre: "Gakupo", color: "#A77BFF" },
  haku: { nombre: "Yowane Haku", color: "#B7A9E6" },
  ia: { nombre: "IA", color: "#F4A7C0" },
  flower: { nombre: "flower", color: "#8E5BD8" },
  adachirei: { nombre: "Adachi Rei", color: "#FF7A2F" },
  ruko: { nombre: "Ruko", color: "#5B8CFF" },
};
const vocaloid = (id: string) => VOCALOIDS[id] ?? { nombre: id.charAt(0).toUpperCase() + id.slice(1), color: "#9a8aa6" };

/** Mensajes que guarda la ventana (los mas viejos se van). */
const MAX_LINEAS = 80;

export class Charla {
  private readonly raiz: HTMLElement;
  private readonly lista: HTMLElement;
  private readonly contador: HTMLElement;
  private minimizada = false;
  private sinLeer = 0;
  /** Burbuja "escribiendo" de cada Vocaloid, que se reemplaza con su respuesta. */
  private readonly escribiendo = new Map<string, HTMLElement>();

  constructor(raiz: HTMLElement) {
    this.raiz = raiz;
    raiz.innerHTML = `<button class="charla-cabeza" type="button" aria-expanded="true">
        <span>💬 Charla con los Vocaloids</span><span class="charla-sin-leer" hidden></span><span class="charla-flecha" aria-hidden="true">–</span>
      </button>
      <ol class="charla-lista" aria-live="polite"></ol>`;
    this.lista = raiz.querySelector(".charla-lista")!;
    this.contador = raiz.querySelector(".charla-sin-leer")!;
    raiz.querySelector(".charla-cabeza")!.addEventListener("click", () => this.minimizar(!this.minimizada));
  }

  /** Lo que dijo el Papu (con @ a uno o mas Vocaloids). */
  papu(nombre: string, texto: string): void {
    // Lo propio siempre baja la lista y no cuenta como "sin leer".
    this.agregar(this.linea("papu", nombre, texto), false);
    this.alFondo(true);
  }

  /** Lo que respondio un Vocaloid a este Papu. */
  vocaloid(bot: string, tipo: "texto" | "escribiendo" | "reaccion" | "aviso", texto: string): void {
    const v = vocaloid(bot);
    const pendiente = this.escribiendo.get(bot);
    if (tipo === "escribiendo") {
      if (pendiente) return;
      const li = this.linea("bot escribiendo", v.nombre, "✍️ …", v.color);
      this.escribiendo.set(bot, li);
      return this.agregar(li, false);
    }
    // Avisos (cuota agotada, fuera de servicio…): nota gris, sin borde de color.
    const li = tipo === "aviso" ? this.linea("nota", "", texto) : this.linea("bot", v.nombre, texto, v.color);
    if (pendiente) {
      pendiente.replaceWith(li);
      this.escribiendo.delete(bot);
      this.alFondo(true);
      this.contarSinLeer();
    } else this.agregar(li);
  }

  private linea(clase: string, quien: string, texto: string, color?: string): HTMLElement {
    const li = document.createElement("li");
    li.className = `charla-linea ${clase}`;
    if (color) li.style.setProperty("--color", color);
    if (quien) {
      const n = document.createElement("span");
      n.className = "charla-quien";
      n.textContent = quien;
      li.append(n);
    }
    const b = document.createElement("p");
    b.className = "charla-texto";
    b.textContent = texto;
    li.append(b);
    return li;
  }

  private agregar(li: HTMLElement, cuenta = true): void {
    const abajo = this.estaAbajo();
    this.raiz.hidden = false;
    this.lista.append(li);
    while (this.lista.children.length > MAX_LINEAS) this.lista.firstElementChild!.remove();
    this.alFondo(abajo);
    if (cuenta) this.contarSinLeer();
  }

  private contarSinLeer(): void {
    if (!this.minimizada) return;
    this.sinLeer++;
    this.contador.textContent = String(this.sinLeer);
    this.contador.hidden = false;
  }

  private estaAbajo(): boolean {
    return this.lista.scrollHeight - this.lista.scrollTop - this.lista.clientHeight < 40;
  }

  /** Baja al ultimo mensaje si ya estaba abajo (si el Papu subio a leer algo viejo, no lo mueve). */
  private alFondo(abajo: boolean): void {
    if (abajo) this.lista.scrollTop = this.lista.scrollHeight;
  }

  minimizar(si: boolean): void {
    this.minimizada = si;
    this.raiz.classList.toggle("minimizada", si);
    this.raiz.querySelector(".charla-cabeza")!.setAttribute("aria-expanded", String(!si));
    this.raiz.querySelector(".charla-flecha")!.textContent = si ? "+" : "–";
    if (!si) {
      this.sinLeer = 0;
      this.contador.hidden = true;
      this.lista.scrollTop = this.lista.scrollHeight;
    }
  }
}
