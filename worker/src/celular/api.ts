// API del celular de Neru (PLAN §3.15). La página la sirve Cloudflare desde worker/public/celular/ (npm run celular);
// aquí solo:
//   GET  /celular/api/config                   id de la app de Neru (SDK de la Actividad) y si hay modo de prueba
//   POST /celular/api/token                    código de Discord → token (con el secreto de Neru, que nunca sale de aquí)
//   POST /celular/api/entrar                   token de Discord (o Papu de prueba) → sesión de 12 h
//   GET  /celular/api/inicio                   perfil (Shaulitas y tarjeta, que deja Neru), tema y estado de los retos
//   POST /celular/api/prefs                    tema e íconos
//   GET|POST /celular/api/vocaloidle           el reto del día / un intento
//   GET|POST /celular/api/silueta              el reto del día / un intento
//   GET  /celular/api/silueta/imagen?nivel=N   la imagen de ese nivel, solo si ya se ganó verla
//   POST /celular/api/pedido                   pedido a Neru para las apps con datos del bot (tarjeta, tienda…)
//   GET  /celular/api/pedido/<id>              su resultado (cuando Neru lo resuelve)
//   GET  /celular/api/trivia/sala?instancia=…  WebSocket a una sala privada de la trivia multijugador (Trivia del celular)
//   GET  /celular/api/trivia/media/<archivo>   imagen o audio de una pregunta (los de /actividad/media/)
//   GET  /celular/api/mini/<id>                miniatura de un objeto de la tienda (las de /tarjeta/mini/)
// Todo lo que no es config/token/entrar pide la sesión en la cabecera x-celular-sesion. Las respuestas de los retos
// nunca llegan a la página antes de resolverlos.
import type { Sql } from "../../../src/cloud/sql";
import {
  aciertosPorIntentos,
  buscarPersonaje,
  comparar,
  compartir,
  completo,
  diaClave,
  elegidoDelDia,
  hash32,
  msHastaManana,
  nivelSilueta,
  numeroReto,
  type PersonajeCompleto,
} from "../../../src/celular/rules";
import type { Identidad, Saludo } from "../actividad/identidad";
import ajedrezConfig from "../../../config/ajedrez.json";
import { Partidas, UserError as AjedrezError, type AjedrezSettings } from "../../../src/ajedrez/partidas";
import { TEMAS, type DatosCelular, type EstadoSilueta, type EstadoVocaloidle, type Inicio, type Opcion, type Prefs, type Tema } from "./tipos";

export interface CelularDeps {
  sql: Sql;
  datos: DatosCelular;
  clientId?: string;
  clientSecret?: string;
  prueba?: boolean;
  /** Quién es el Papu (Discord, o uno de prueba). */
  identificar: (s: Saludo) => Promise<Identidad | { motivo: string } | null>;
  /** Archivos estáticos del worker (imágenes de Silueta, por nombre). */
  asset?: (ruta: string) => Promise<Response>;
  /** #tus-roles (app Roles): lo resuelve el worker mismo, como los menús de Miku. */
  roles?: { estado: (papu: string) => Promise<unknown>; elegir: (papu: string, datos: unknown) => Promise<{ ok: boolean; mensaje: string }> };
  /** Sala de la trivia multijugador (Durable Object) para la Trivia del celular. */
  sala?: (instancia: string, request: Request) => Promise<Response>;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const PREFIX = "/celular/api/";
const SAL_VOCALOIDLE = "papus-vocaloidle-v1";
const SAL_SILUETA = "papus-silueta-v1";
/** Apps que piden cosas a Neru y cuántos pedidos sin resolver puede tener un Papu a la vez. */
export const APPS_PEDIDO = ["tarjeta", "tienda", "mochila", "mercado", "donar", "roles", "comercio", "ruleta"] as const;
const PEDIDOS_A_LA_VEZ = 4;
/** Neru vuelve a dibujar la tarjeta como mucho una vez por minuto por Papu. */
const PERFIL_CADA_MS = 60_000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function token(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Sesion {
  token: string;
  papu_id: string;
  nombre: string;
  avatar: string;
}

interface FilaReto {
  intentos: string;
  resuelto: number;
}

export class Celular {
  private readonly now: () => number;
  private readonly completos: PersonajeCompleto[];
  private readonly opciones: { vocaloidle: Opcion[]; silueta: Opcion[] };
  /** Ajedrez entre Papus (config/ajedrez.json; 18 nov. 2026). */
  private readonly ajedrez: Partidas;

  constructor(private readonly d: CelularDeps) {
    this.now = d.now ?? Date.now;
    this.ajedrez = new Partidas(d.sql, ajedrezConfig as unknown as AjedrezSettings, { now: this.now });
    this.completos = d.datos.personajes.filter(completo);
    const nombre = new Map(d.datos.personajes.map((p) => [p.id, p.nombre]));
    const orden = (a: Opcion, b: Opcion) => a.nombre.localeCompare(b.nombre, "es");
    this.opciones = {
      vocaloidle: this.completos.map((p) => ({ id: p.id, nombre: p.nombre })).sort(orden),
      silueta: d.datos.silueta.map((s) => ({ id: s.id, nombre: nombre.get(s.id) ?? s.id })).sort(orden),
    };
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname === "/celular") return Response.redirect(`${url.origin}/celular/${url.search}`, 301);
    if (!url.pathname.startsWith(PREFIX)) return null;
    const ruta = url.pathname.slice(PREFIX.length).replace(/\/+$/, "");
    const m = request.method;

    if (ruta === "config" && m === "GET") return json({ clientId: this.d.clientId ?? null, prueba: !!this.d.prueba });
    // Archivos públicos de otras partes del worker, por aquí porque el URL mapping de la Actividad apunta a /celular.
    const media = /^trivia\/media\/([\w-]{1,64}\.(?:webp|png|jpg|mp3|ogg|m4a))$/.exec(ruta);
    if (media && m === "GET") return this.archivo(`/actividad/media/${media[1]}`, "public, max-age=86400");
    const mini = /^mini\/([a-z0-9-]{1,64})$/.exec(ruta);
    if (mini && m === "GET") return this.archivo(`/tarjeta/mini/${mini[1]}.png`, "public, max-age=86400");
    if (ruta === "trivia/sala") {
      // Sala privada: la instancia la arma la página con el id del Papu (la sala igual comprueba quién es).
      const instancia = url.searchParams.get("instancia") ?? "";
      if (!/^celular-[\w-]{1,100}$/.test(instancia) || !this.d.sala) return json({ error: "sala inválida" }, 400);
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Se espera un WebSocket" }, 426);
      return this.d.sala(instancia, request);
    }
    if (ruta === "token" && m === "POST") return this.token(request);
    if (ruta === "entrar" && m === "POST") return this.entrar(request);

    const s = await this.sesion(request);
    if (!s) return json({ error: "Tu sesión venció. Cierra y vuelve a abrir el celular." }, 401);
    if (ruta === "inicio" && m === "GET") return json(await this.inicio(s));
    if (ruta === "prefs" && m === "POST") return this.prefs(s, request);
    if (ruta === "vocaloidle" && m === "GET") return json(await this.vocaloidle(s.papu_id));
    if (ruta === "vocaloidle" && m === "POST") return this.intentoVocaloidle(s.papu_id, request);
    if (ruta === "silueta" && m === "GET") return json(await this.silueta(s.papu_id));
    if (ruta === "silueta" && m === "POST") return this.intentoSilueta(s.papu_id, request);
    if (ruta === "silueta/imagen" && m === "GET") return this.imagenSilueta(s.papu_id, Number(url.searchParams.get("nivel")));
    if (ruta === "roles" && m === "GET") return this.d.roles ? json(await this.d.roles.estado(s.papu_id)) : json({ error: "Roles apagado" }, 503);
    if (ruta === "roles" && m === "POST") {
      if (!this.d.roles) return json({ error: "Roles apagado" }, 503);
      const r = await this.d.roles.elegir(s.papu_id, await request.json().catch(() => null));
      return r.ok ? json({ mensaje: r.mensaje }) : json({ error: r.mensaje }, 400);
    }
    if (ruta === "ajedrez" || ruta.startsWith("ajedrez/")) return this.rutaAjedrez(s, ruta, request, url);
    if (ruta === "pedido" && m === "POST") return this.pedido(s, request);
    const ped = /^pedido\/(\d{1,12})$/.exec(ruta);
    if (ped && m === "GET") return this.resultado(s, Number(ped[1]));
    return json({ error: "no encontrado" }, 404);
  }

  // ───────────────────────── ajedrez (18 nov. 2026) ─────────────────────────

  private async rutaAjedrez(s: Sesion, ruta: string, request: Request, url: URL): Promise<Response> {
    const cfg = ajedrezConfig as unknown as AjedrezSettings;
    try {
      const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
      const id = String(body.id ?? url.searchParams.get("id") ?? "");
      if (ruta === "ajedrez" && request.method === "GET")
        return json({ activo: cfg.activo, apuesta: cfg.apuesta, relojMin: cfg.relojMin, comision: cfg.comision, rivales: cfg.rivales, mias: await this.ajedrez.mias(s.papu_id) });
      if (ruta === "ajedrez/partida" && request.method === "GET") return json(await this.ajedrez.ver(id, s.papu_id));
      if (ruta === "ajedrez/retar" && request.method === "POST") {
        const rival = body.rival as { id?: unknown; nombre?: unknown } | undefined;
        if (!rival || typeof rival.id !== "string" || !/^(\d{5,25}|prueba-\w{1,20})$/.test(rival.id)) throw new AjedrezError("Elige a un Papu.");
        const nombre = String(rival.nombre ?? "Papu").slice(0, 40);
        return json(await this.ajedrez.retar({ id: s.papu_id, nombre: s.nombre }, { id: rival.id, nombre }, Number(body.apuesta ?? 0)));
      }
      if (ruta === "ajedrez/responder" && request.method === "POST") {
        const accion = String(body.accion);
        if (accion !== "aceptar" && accion !== "rechazar" && accion !== "cancelar") throw new AjedrezError("No sé hacer eso.");
        return json(await this.ajedrez.responder(id, s.papu_id, accion));
      }
      if (ruta === "ajedrez/jugar" && request.method === "POST") return json(await this.ajedrez.jugar(id, s.papu_id, String(body.jugada ?? "")));
      if (ruta === "ajedrez/rendirse" && request.method === "POST") return json(await this.ajedrez.rendirse(id, s.papu_id));
      return json({ error: "no encontrado" }, 404);
    } catch (e) {
      if (e instanceof AjedrezError) return json({ error: e.message }, 400);
      throw e;
    }
  }

  // ───────────────────────── entrada ─────────────────────────

  private async token(request: Request): Promise<Response> {
    if (!this.d.clientId || !this.d.clientSecret) return json({ error: "El celular aún no está configurado (falta el secreto de Neru)." }, 503);
    const { code } = (await request.json().catch(() => ({}))) as { code?: string };
    if (!code || code.length > 200) return json({ error: "Falta el código" }, 400);
    const r = await (this.d.fetchFn ?? fetch)("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.d.clientId, client_secret: this.d.clientSecret, grant_type: "authorization_code", code }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string };
    if (!r.ok || !j.access_token) return json({ error: "Discord no aceptó el código" }, 401);
    return json({ access_token: j.access_token });
  }

  private async entrar(request: Request): Promise<Response> {
    const saludo = (await request.json().catch(() => ({}))) as Saludo;
    const id = await this.d.identificar(saludo);
    if (!id) return json({ error: "Discord no me dijo quién eres. Cierra y vuelve a abrir el celular." }, 401);
    if ("motivo" in id) return json({ error: id.motivo }, 403);
    const now = this.now();
    await this.d.sql.run("DELETE FROM celular_sesiones WHERE vence_at < ?", now);
    const t = token();
    const vence = now + this.d.datos.settings.sesionHoras * 3_600_000;
    await this.d.sql.run("INSERT INTO celular_sesiones (token, papu_id, nombre, avatar, vence_at, creado_at) VALUES (?, ?, ?, ?, ?, ?)", t, id.id, id.nombre, id.avatar, vence, now);
    await this.pedirPerfil(id.id);
    return json({ sesion: t, vence_at: vence });
  }

  private async sesion(request: Request): Promise<Sesion | null> {
    const t = request.headers.get("x-celular-sesion") ?? "";
    if (!/^[\w-]{20,64}$/.test(t)) return null;
    return (await this.d.sql.get<Sesion>("SELECT token, papu_id, nombre, avatar FROM celular_sesiones WHERE token = ? AND vence_at > ?", t, this.now())) ?? null;
  }

  /** Le pide a Neru la tarjeta y las Shaulitas (como mucho una vez por minuto). */
  private async pedirPerfil(papu: string): Promise<void> {
    const now = this.now();
    await this.d.sql.run(
      `INSERT INTO celular_perfiles (papu_id, pedido_at, actualizado_at) VALUES (?, ?, 0)
       ON CONFLICT(papu_id) DO UPDATE SET pedido_at = excluded.pedido_at WHERE celular_perfiles.actualizado_at < excluded.pedido_at - ${PERFIL_CADA_MS}`,
      papu,
      now,
    );
  }

  private async archivo(ruta: string, cache: string): Promise<Response> {
    if (!this.d.asset) return json({ error: "sin archivos" }, 503);
    const r = await this.d.asset(ruta);
    if (!r.ok) return json({ error: "no encontrado" }, 404);
    return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") ?? "application/octet-stream", "cache-control": cache } });
  }

  // ───────────────────────── pedidos a Neru ─────────────────────────

  private async pedido(s: Sesion, request: Request): Promise<Response> {
    const raw = await request.text();
    if (raw.length > 8000) return json({ error: "pedido muy grande" }, 413);
    const b = (() => {
      try {
        return JSON.parse(raw) as { app?: string; accion?: string; datos?: unknown };
      } catch {
        return null;
      }
    })();
    if (!b || !APPS_PEDIDO.includes(b.app as (typeof APPS_PEDIDO)[number]) || !/^[a-z-]{1,24}$/.test(b.accion ?? "")) return json({ error: "pedido inválido" }, 400);
    const abiertos = await this.d.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM celular_pedidos WHERE papu_id = ? AND estado IN ('pendiente', 'tomado') AND creado_at > ?", s.papu_id, this.now() - 60_000);
    if ((abiertos?.n ?? 0) >= PEDIDOS_A_LA_VEZ) return json({ error: "Neru va lento, espera un segundo." }, 429);
    const r = await this.d.sql.run(
      "INSERT INTO celular_pedidos (papu_id, nombre, app, accion, datos, creado_at) VALUES (?, ?, ?, ?, ?, ?)",
      s.papu_id,
      s.nombre,
      b.app,
      b.accion,
      JSON.stringify(b.datos ?? null),
      this.now(),
    );
    return json({ id: r.lastRowId });
  }

  private async resultado(s: Sesion, id: number): Promise<Response> {
    const r = await this.d.sql.get<{ estado: string; resultado: string | null }>("SELECT estado, resultado FROM celular_pedidos WHERE id = ? AND papu_id = ?", id, s.papu_id);
    if (!r) return json({ error: "no existe" }, 404);
    return json({ estado: r.estado, resultado: r.resultado ? (JSON.parse(r.resultado) as unknown) : null });
  }

  // ───────────────────────── inicio y preferencias ─────────────────────────

  private async inicio(s: Sesion): Promise<Inicio> {
    await this.pedirPerfil(s.papu_id);
    const perfil = await this.d.sql.get<{ shaulitas: number | null; tarjeta: string | null }>("SELECT shaulitas, tarjeta FROM celular_perfiles WHERE papu_id = ?", s.papu_id);
    const { dia, numero } = this.hoy();
    const reto = async (juego: string) => {
      const r = await this.fila(s.papu_id, juego, dia);
      return { numero, resuelto: !!r?.resuelto, jugado: !!r && (JSON.parse(r.intentos) as string[]).length > 0 };
    };
    return {
      papu: { id: s.papu_id, nombre: s.nombre, avatar: s.avatar },
      prefs: await this.leerPrefs(s.papu_id),
      perfil: { shaulitas: perfil?.shaulitas ?? null, tarjeta: perfil?.tarjeta ?? null },
      vocaloidle: await reto("vocaloidle"),
      silueta: await reto("silueta"),
      opciones: this.opciones,
    };
  }

  private async leerPrefs(papu: string): Promise<Prefs> {
    const r = await this.d.sql.get<{ tema: string; iconos: string }>("SELECT tema, iconos FROM celular_prefs WHERE papu_id = ?", papu);
    return { tema: TEMAS.includes(r?.tema as Tema) ? (r!.tema as Tema) : "neru", iconos: r?.iconos === "orig" ? "orig" : "tema" };
  }

  private async prefs(s: Sesion, request: Request): Promise<Response> {
    const b = (await request.json().catch(() => null)) as Partial<Prefs> | null;
    const actual = await this.leerPrefs(s.papu_id);
    const tema = b?.tema && TEMAS.includes(b.tema) ? b.tema : actual.tema;
    const iconos = b?.iconos === "orig" || b?.iconos === "tema" ? b.iconos : actual.iconos;
    await this.d.sql.run(
      "INSERT INTO celular_prefs (papu_id, tema, iconos, actualizado_at) VALUES (?, ?, ?, ?) ON CONFLICT(papu_id) DO UPDATE SET tema = excluded.tema, iconos = excluded.iconos, actualizado_at = excluded.actualizado_at",
      s.papu_id,
      tema,
      iconos,
      this.now(),
    );
    return json({ tema, iconos });
  }

  // ───────────────────────── retos del día ─────────────────────────

  private hoy(): { dia: string; numero: number; siguienteEn: number } {
    const st = this.d.datos.settings;
    const now = this.now();
    const dia = diaClave(now, st.zonaHoraria);
    return { dia, numero: numeroReto(dia, st.inicio), siguienteEn: msHastaManana(now, st.zonaHoraria) };
  }

  private fila(papu: string, juego: string, dia: string): Promise<FilaReto | undefined> {
    return this.d.sql.get<FilaReto>("SELECT intentos, resuelto FROM celular_retos WHERE papu_id = ? AND juego = ? AND dia = ?", papu, juego, dia);
  }

  /**
   * Suma un intento al reto (si no estaba resuelto ni repetido). Si alguien escribió a la vez, no pisa: devuelve null.
   * Al resolver deja el premio para que Neru dé la XP (una sola vez por juego y día).
   */
  private async intentar(papu: string, juego: string, dia: string, id: string, acierto: boolean): Promise<{ intentos: string[] } | { error: string } | null> {
    const r = await this.fila(papu, juego, dia);
    const antes = r ? (JSON.parse(r.intentos) as string[]) : [];
    if (r?.resuelto) return { error: "Ya resolviste el de hoy. Vuelve mañana." };
    if (antes.includes(id)) return { error: "Ya probaste con ese personaje." };
    const intentos = [...antes, id];
    const now = this.now();
    const res = r
      ? await this.d.sql.run("UPDATE celular_retos SET intentos = ?, resuelto = ?, actualizado_at = ? WHERE papu_id = ? AND juego = ? AND dia = ? AND intentos = ?", JSON.stringify(intentos), acierto ? 1 : 0, now, papu, juego, dia, r.intentos)
      : await this.d.sql.run("INSERT INTO celular_retos (papu_id, juego, dia, intentos, resuelto, actualizado_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING", papu, juego, dia, JSON.stringify(intentos), acierto ? 1 : 0, now);
    if (!res.changes) return null;
    if (acierto) {
      await this.d.sql.run(
        "INSERT INTO celular_premios (papu_id, juego, dia, intentos, aciertos, creado_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        papu,
        juego,
        dia,
        intentos.length,
        aciertosPorIntentos(this.d.datos.settings, intentos.length),
        now,
      );
    }
    return { intentos };
  }

  // Vocaloidle

  private secretoVocaloidle(numero: number): PersonajeCompleto {
    const id = elegidoDelDia(this.completos.map((p) => p.id), numero, SAL_VOCALOIDLE);
    return this.completos.find((p) => p.id === id)!;
  }

  async vocaloidle(papu: string): Promise<EstadoVocaloidle> {
    const { dia, numero, siguienteEn } = this.hoy();
    const r = await this.fila(papu, "vocaloidle", dia);
    const secreto = this.secretoVocaloidle(numero);
    const pistas = (r ? (JSON.parse(r.intentos) as string[]) : [])
      .map((id) => this.completos.find((p) => p.id === id))
      .filter((p): p is PersonajeCompleto => !!p)
      .map((p) => comparar(p, secreto));
    const resuelto = !!r?.resuelto;
    return {
      numero,
      pistas,
      resuelto,
      compartir: resuelto ? compartir(numero, pistas) : null,
      aciertos: resuelto ? aciertosPorIntentos(this.d.datos.settings, pistas.length) : null,
      siguienteEn,
    };
  }

  private async intentoVocaloidle(papu: string, request: Request): Promise<Response> {
    const b = (await request.json().catch(() => null)) as { personaje?: string } | null;
    const p = buscarPersonaje(this.completos, String(b?.personaje ?? "").slice(0, 60));
    if (!p) return json({ error: "No conozco a ese personaje. Elige uno de la lista." }, 400);
    const { dia, numero } = this.hoy();
    const r = await this.intentar(papu, "vocaloidle", dia, p.id, p.id === this.secretoVocaloidle(numero).id);
    if (!r) return json({ error: "Ups, se cruzaron dos intentos. Prueba otra vez." }, 409);
    if ("error" in r) return json({ error: r.error }, 400);
    return json(await this.vocaloidle(papu));
  }

  // Silueta

  private secretoSilueta(numero: number): { id: string; imagen: string[] } {
    const pool = this.d.datos.silueta;
    const id = elegidoDelDia(pool.map((s) => s.id), numero, SAL_SILUETA);
    const imgs = pool.find((s) => s.id === id)!.imagenes;
    return { id, imagen: imgs[hash32(`${SAL_SILUETA}:img:${numero}`) % imgs.length]! };
  }

  async silueta(papu: string): Promise<EstadoSilueta> {
    const st = this.d.datos.settings;
    const { dia, numero, siguienteEn } = this.hoy();
    const r = await this.fila(papu, "silueta", dia);
    const intentos = r ? (JSON.parse(r.intentos) as string[]) : [];
    const resuelto = !!r?.resuelto;
    const fallidos = resuelto ? intentos.slice(0, -1) : intentos;
    const nombre = (id: string) => this.opciones.silueta.find((o) => o.id === id)?.nombre ?? id;
    return {
      numero,
      fallidos: fallidos.map(nombre),
      resuelto,
      nivel: nivelSilueta(st, fallidos.length, resuelto),
      niveles: st.silueta.bloques.length + 1,
      respuesta: resuelto ? nombre(this.secretoSilueta(numero).id) : null,
      compartir: resuelto ? [`Silueta #${numero} · ${intentos.length} ${intentos.length === 1 ? "intento" : "intentos"}`, `${"🟥".repeat(fallidos.length)}🟩`].join("\n") : null,
      aciertos: resuelto ? aciertosPorIntentos(st, intentos.length) : null,
      siguienteEn,
    };
  }

  private async intentoSilueta(papu: string, request: Request): Promise<Response> {
    const b = (await request.json().catch(() => null)) as { personaje?: string } | null;
    const p = buscarPersonaje(
      this.opciones.silueta.map((o) => ({ ...o, empresa: null, anio: null, pelo: null, origen: null, voz: null })),
      String(b?.personaje ?? "").slice(0, 60),
    );
    if (!p) return json({ error: "No conozco a ese personaje. Elige uno de la lista." }, 400);
    const { dia, numero } = this.hoy();
    const r = await this.intentar(papu, "silueta", dia, p.id, p.id === this.secretoSilueta(numero).id);
    if (!r) return json({ error: "Ups, se cruzaron dos intentos. Prueba otra vez." }, 409);
    if ("error" in r) return json({ error: r.error }, 400);
    return json(await this.silueta(papu));
  }

  private async imagenSilueta(papu: string, nivel: number): Promise<Response> {
    const estado = await this.silueta(papu);
    if (!Number.isInteger(nivel) || nivel < 0 || nivel > estado.nivel) return json({ error: "Esa imagen todavía no." }, 403);
    if (!this.d.asset) return json({ error: "sin imágenes" }, 503);
    const archivo = this.secretoSilueta(estado.numero).imagen[nivel];
    if (!archivo) return json({ error: "no encontrado" }, 404);
    const r = await this.d.asset(`/celular/s/${archivo}`);
    if (!r.ok) return json({ error: "no encontrado" }, 404);
    return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") ?? "image/webp", "cache-control": "private, no-store" } });
  }
}
