// Pantallas de la trivia multijugador (HTML a partir de la vista de la sala): sala, pregunta (y su respuesta) y fin.
// Sin red ni Discord: main.ts las dibuja y npm run actividad:vista las muestra con datos de ejemplo para revisar el arte.
import type { Dificultad, Eleccion, JugadorVista, Vista } from "../../src/actividad/tipos";

const LETRAS = ["A", "B", "C", "D"];
const ELECCIONES: Eleccion[] = ["mezcla", "facil", "medio", "dificil"];
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Negritas de Markdown (**x**) de los datos curiosos, despues de escapar. */
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

/** Lo que las pantallas necesitan ademas de la vista: nombres de las dificultades, el aviso y las caras ya animadas. */
export const estado = {
  dificultades: {
    facil: { nombre: "Fácil", emoji: "🟢" },
    medio: { nombre: "Media", emoji: "🟡" },
    dificil: { nombre: "Difícil", emoji: "🔴" },
  } as Record<Dificultad, { nombre: string; emoji: string }>,
  aviso: "",
  caras: new Set<string>(),
};

// ───────────────────────── piezas ─────────────────────────

function cara(j: JugadorVista | undefined, clase = "cara"): string {
  return j ? `<img class="${clase}" src="${esc(j.avatar)}" alt="" title="${esc(j.nombre)}" />` : "";
}

function quien(v: Vista, id: string): JugadorVista | undefined {
  return v.jugadores.find((j) => j.id === id);
}

function chipDificultad(d: Dificultad): string {
  return `<span class="chip ${d}">${estado.dificultades[d].emoji} ${esc(estado.dificultades[d].nombre)}</span>`;
}

function jugadores(v: Vista): string {
  return `<div class="jugadores">${v.jugadores
    .filter((j) => j.conectado || j.juega)
    .map((j) => {
      const fuera = (v.modo === "eliminatoria" && j.juega && !j.vivo) || !j.juega || !j.conectado;
      const host = j.id === v.host && (v.fase === "sala" || v.fase === "fin");
      const marca = !j.juega ? "👀" : v.modo === "eliminatoria" && !j.vivo ? "💀" : j.fallo ? "💔" : j.respondio ? "✅" : host ? "👑" : "";
      const puntos = v.fase === "sala" ? "" : `<span class="pts">${j.aciertos} ✔${j.xp ? ` · ${fmt(j.xp)} XP` : ""}</span>`;
      const clase = ["jugador", fuera ? "fuera" : "", j.respondio ? "listo" : "", host ? "host" : ""].filter(Boolean).join(" ");
      return `<div class="${clase}">${cara(j, "cara grande")}<span class="marca">${marca}</span><span class="nombre">${esc(j.nombre)}</span>${puntos}</div>`;
    })
    .join("")}</div>`;
}

// ───────────────────────── pantallas ─────────────────────────

export function sala(v: Vista): string {
  const host = v.yo === v.host;
  const nombreHost = quien(v, v.host ?? "")?.nombre ?? "el anfitrión";
  const off = host ? "" : "disabled";
  const modo = (m: Vista["modo"], t: string, d: string) => `<button data-modo="${m}" class="opcion-sala${v.modo === m ? " activo" : ""}" ${off}><span class="t">${t}</span><span class="d">${d}</span></button>`;
  const elec = (e: Eleccion) => {
    const t = e === "mezcla" ? "🎲 Mezcla" : `${estado.dificultades[e].emoji} ${esc(estado.dificultades[e].nombre)}`;
    return `<button data-eleccion="${e}" class="opcion-sala ${e}${v.eleccion === e ? " activo" : ""}" ${off}><span class="t">${t}</span><span class="d">${fmt(v.disponibles[e])} preguntas</span></button>`;
  };
  const n = v.jugadores.filter((j) => j.conectado).length;
  return `
    <img class="portada" src="portada.webp" alt="Trivia Vocaloid" />
    <div class="seccion">Modo</div>
    <div class="grupo">
      ${modo("eliminatoria", "⚔️ Eliminatoria", "Quien falla queda fuera. Si fallan todos, nadie cae. Gana el último en pie.")}
      ${modo("cooperativo", "🤝 Cooperativo", "En equipo: pierden cuando todos fallaron al menos una vez.")}
    </div>
    <div class="seccion">Preguntas</div>
    <div class="grupo">${ELECCIONES.map(elec).join("")}</div>
    <p class="nota">Cada acierto cuenta como en /trivia: XP con racha, partidas y tope del día, preguntas superadas e hitos.</p>
    ${host ? `<button class="verde grande" data-accion="empezar">▶️ Empezar · ${n} ${n === 1 ? "Papu" : "Papus"}</button>` : `<div class="tarjeta espera"><img src="teto-nerd.webp" alt="" /><span>Esperando a que <b>${esc(nombreHost)}</b> 👑 empiece<span class="puntos"></span></span></div>`}
    ${estado.aviso ? `<p class="error">${esc(estado.aviso)}</p>` : ""}
    ${jugadores(v)}
    <img class="logo" src="logo.webp" alt="TetoCiencia" />`;
}

export function pregunta(v: Vista): string {
  const p = v.pregunta!;
  const r = v.revelar;
  const yo = quien(v, v.yo);
  const juego = !!yo?.juega && (v.modo === "cooperativo" || yo.vivo);
  const mia = r?.resultados[v.yo];
  const quedan = v.modo === "eliminatoria" ? `⚔️ ${v.jugadores.filter((j) => j.juega && j.vivo).length} en pie` : `🤝 ${v.jugadores.filter((j) => j.juega && !j.fallo).length} sin fallar`;
  const racha = yo && yo.racha > 1 && !r ? `<span class="chip racha">🔥 ${yo.racha}</span>` : "";
  let cuerpo: string;
  if (p.tipo === "opciones") {
    const yaElegi = p.elecciones.findIndex((ids) => ids.includes(v.yo));
    cuerpo = `<div class="opciones${p.opciones.length === 2 ? " dos" : ""}">${p.opciones
      .map((o, k) => {
        const oculta = !r && (p.ocultas ?? []).includes(k);
        const clase = r ? (k === r.correcta ? "correcta" : yaElegi === k ? "mal" : "apagada") : oculta ? "apagada" : yaElegi === k ? "mia" : "";
        const caras = (p.elecciones[k] ?? []).map((id) => {
          const nueva = !estado.caras.has(`${p.nonce}:${id}`);
          estado.caras.add(`${p.nonce}:${id}`);
          return cara(quien(v, id), nueva ? "cara nueva" : "cara");
        });
        return `<button class="opcion ${clase}" data-opcion="${k}" ${!juego || yaElegi >= 0 || r || oculta ? "disabled" : ""}><span class="letra">${LETRAS[k]}</span><span class="txt">${oculta ? "••••••••" : esc(o)}</span><span class="caras">${caras.join("")}</span></button>`;
      })
      .join("")}</div>`;
  } else if (!r) {
    const respondi = !!yo?.respondio;
    cuerpo = juego && !respondi
      ? `<form class="escribir" id="escribir"><input id="texto" maxlength="100" autocomplete="off" placeholder="✍️ Escribe tu respuesta…" /><button class="azul">Enviar</button></form>`
      : `<div class="tarjeta espera"><img src="teto-nerd.webp" alt="" /><span>${respondi ? "Respuesta enviada. Esperando a los demás" : "Mirando esta pregunta"}<span class="puntos"></span></span></div>`;
    cuerpo += `<div class="respondieron">${v.jugadores.filter((j) => j.respondio).map((j) => cara(j)).join("")}</div>`;
  } else {
    cuerpo = `<ul class="lista">${Object.entries(r.resultados)
      .map(([id, res]) => `<li>${cara(quien(v, id))} <b>${esc(quien(v, id)?.nombre ?? "")}</b> ${res.ok ? "✅" : "❌"} <i>${esc(res.texto ?? "(sin respuesta)")}</i><span class="num">${res.ok && res.xp ? `+${fmt(res.xp)} XP` : ""}</span></li>`)
      .join("")}</ul>`;
  }
  const extras = v.consumibles;
  const herramientas = !r && juego && extras ? `<div class="grupo" style="margin:12px 0">
    ${extras.celular ? `<button data-consumible="celular">📱 Neru 50/50 · ${extras.celular}</button>` : ""}
    ${extras.guitarra && !extras.guitarraActiva ? `<button data-consumible="guitarra">🎸 Doble XP · ${extras.guitarra}</button>` : extras.guitarraActiva ? `<span class="chip">🎸 Guitarra activa · doble XP</span>` : ""}
    ${extras.zanahoria && p.temas?.length ? `<label class="chip">🥕 Gumi <select id="tema-zanahoria">${p.temas.map(t=>`<option value="${esc(t.tema)}">${esc(t.tema)} (${t.n})</option>`).join("")}</select><button data-consumible="zanahoria">Elegir tema · ${extras.zanahoria}</button></label>` : ""}
  </div>` : "";
  let resultado = "";
  if (r) {
    const xp = mia?.ok ? (mia.xp ? `<span class="xp">+${fmt(mia.xp)} XP</span>` : mia.xp === null ? `<span class="nota"> (Teto está calculando tu XP)</span>` : "") : "";
    const linea = !mia
      ? `Era <b>${esc(r.respuesta)}</b>`
      : mia.ok
        ? `✅ ¡Correcto!${xp}`
        : mia.opcion === undefined && mia.texto === undefined
          ? `⌛ ¡Se acabó el tiempo! Era <b>${esc(r.respuesta)}</b>`
          : `❌ Incorrecto. Era <b>${esc(r.respuesta)}</b>`;
    const caen = r.nadieCae
      ? `<p>😅 ¡Fallaron todos los que quedaban! Nadie cae esta vez.</p>`
      : r.caen.length
        ? `<p>💀 Quedan fuera: <b>${r.caen.map((id) => esc(quien(v, id)?.nombre ?? "")).join(", ")}</b></p>`
        : "";
    const teto = mia?.ok ? "teto-riendo.webp" : mia ? "teto-shock.webp" : "teto-nerd.webp";
    const dato = r.dato ? `<div class="dato"><img src="dato.webp" alt="Dato curioso" /><p>${md(r.dato)}</p></div>` : "";
    resultado = `<div class="resultado ${mia?.ok ? "ok" : mia ? "no" : ""}"><img class="teto" src="${teto}" alt="" /><div class="cuerpo"><div class="linea">${linea}</div>${caen}${dato}</div></div>`;
  }
  const mirando = juego || r ? "" : `<p class="nota" style="text-align:center">${yo?.juega ? "💀 Quedaste fuera: mira cómo sigue." : "👀 Llegaste con la partida empezada: juegas en la siguiente."}</p>`;
  return `
    <div class="barra">
      <div class="chips">${chipDificultad(p.dificultad)}<span class="chip">Pregunta ${p.n}</span>${racha}</div>
      <div class="chips"><span class="chip">${quedan}</span><span class="segundos" id="segundos"></span></div>
    </div>
    <div class="tiempo" id="tiempo"><div></div></div>
    <p class="pregunta">${esc(p.texto)}</p>
    <div id="media"></div>
    ${cuerpo}
    ${herramientas}
    ${resultado}
    ${mirando}
    ${jugadores(v)}`;
}

export function fin(v: Vista): string {
  const f = v.fin!;
  const host = v.yo === v.host;
  const ganador = f.ganador ? quien(v, f.ganador) : undefined;
  const titulo =
    f.motivo === "ganador" && ganador
      ? `🏆 ¡${esc(ganador.nombre)} es el último en pie!`
      : f.motivo === "todos-fallaron"
        ? `🤝 El equipo cayó en la pregunta ${f.preguntas}`
        : f.motivo === "sin-preguntas"
          ? "🌟 ¡Se acabaron las preguntas!"
          : f.motivo === "abandonaron"
            ? "🚪 Todos se fueron"
            : "💀 Nadie quedó en pie";
  const orden = [...v.jugadores].filter((j) => j.juega).sort((a, b) => (f.ganador ? Number(b.id === f.ganador) - Number(a.id === f.ganador) : 0) || b.aciertos - a.aciertos || b.xp - a.xp);
  const puesto = (j: JugadorVista | undefined, k: number) =>
    j ? `<div class="puesto p${k}">${cara(j, "cara grande")}<span class="n">${esc(j.nombre)}</span><span class="s">${j.aciertos} ✔${j.xp ? ` · +${fmt(j.xp)} XP` : ""}</span><div class="bloque">${k}</div></div>` : "";
  const podio = `<div class="podio">${puesto(orden[1], 2)}${puesto(orden[0], 1)}${puesto(orden[2], 3)}</div>`;
  const resto = orden.slice(3).map((j, k) => `<li>${k + 4}. ${cara(j)} ${esc(j.nombre)}<span class="num">${j.aciertos} ✔${j.xp ? ` · +${fmt(j.xp)} XP` : ""}</span></li>`).join("");
  return `
    <div class="fin-cabeza"><img src="${f.motivo === "ganador" || f.motivo === "sin-preguntas" ? "teto-presumida.webp" : "teto-shock.webp"}" alt="" /><h1 class="titulo">${titulo}</h1></div>
    <p class="nota" style="text-align:center">${v.modo === "eliminatoria" ? "⚔️ Eliminatoria" : "🤝 Cooperativo"} · ${f.preguntas} preguntas · Teto suma la XP en unos segundos.</p>
    ${podio}
    ${resto ? `<ul class="lista">${resto}</ul>` : ""}
    ${host ? `<button class="verde grande" data-accion="otra">🔁 Otra partida</button>` : `<div class="tarjeta espera"><span>El anfitrión 👑 puede empezar otra<span class="puntos"></span></span></div>`}`;
}
