// Lector de los datos del motor de videos (../Proyecto1). SOLO LECTURA: este modulo no tiene
// ninguna funcion que escriba; las rutas salen de config/engine-paths.json. Los Vocaloids que el motor no tiene en
// su elenco (Gakupo, IA, Haku, flower) toman sus datos de content/lore-extra.json; si el motor los agrega, manda el motor.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BotId } from "../config";

interface PathEntry {
  path: string;
  use: string;
  usedBy: string[];
}
interface EnginePaths {
  engine: Record<string, PathEntry>;
  delivery: Record<string, PathEntry>;
}

export interface CharacterInfo {
  id: BotId;
  displayName: string;
  /** Color de los embeds del bot (subtitleColor del motor), como entero 0xRRGGBB. */
  color: number;
  avatarDir: string;
  reactions: Record<string, string>;
  /** Datos de lore del personaje (lore.json -> characters.<id>). */
  lore: string[];
  /** Dinamicas compartidas y memes de la comunidad donde aparece el personaje. */
  shared: string[];
  community: string[];
  /** Reglas generales de lore (no contradecir, Project Sekai excluido, etc.). */
  loreRules: string[];
}

export class EngineDataError extends Error {}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export class EngineReader {
  private readonly paths: EnginePaths;

  constructor(
    readonly engineDir: string,
    readonly deliveryDir: string | null = null,
    pathsFile = path.join(REPO_ROOT, "config/engine-paths.json"),
    private readonly extraLoreFile = path.join(REPO_ROOT, "content/lore-extra.json"),
  ) {
    this.paths = JSON.parse(readFileSync(pathsFile, "utf8")) as EnginePaths;
  }

  /** Datos de los Vocaloids fuera del elenco del motor (content/lore-extra.json -> characters.<id>). */
  private extraLore(id: string): string[] | undefined {
    if (!existsSync(this.extraLoreFile)) return undefined;
    const extra = JSON.parse(readFileSync(this.extraLoreFile, "utf8")) as { characters?: Record<string, string[]> };
    return extra.characters?.[id];
  }

  /** Ruta absoluta de un dato del motor; `vars` reemplaza {id}, {episodeId}, etc. */
  resolve(key: string, vars: Record<string, string> = {}): string {
    const entry = this.paths.engine[key];
    if (!entry) throw new EngineDataError(`Dato del motor desconocido: ${key}`);
    const rel = entry.path.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k];
      if (v === undefined) throw new EngineDataError(`Falta la variable {${k}} para ${key}`);
      return v;
    });
    return path.join(this.engineDir, rel);
  }

  resolveDelivery(key: string): string | null {
    const entry = this.paths.delivery[key];
    if (!entry || !this.deliveryDir) return null;
    return path.join(this.deliveryDir, entry.path);
  }

  readJson<T = unknown>(key: string, vars: Record<string, string> = {}): T {
    const file = this.resolve(key, vars);
    if (!existsSync(file)) throw new EngineDataError(`No existe ${file} (dato del motor "${key}")`);
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch (e) {
      throw new EngineDataError(`JSON invalido en ${file}: ${(e as Error).message}`);
    }
  }

  /** Lista que falta, para el chequeo inicial. */
  missing(): string[] {
    return Object.entries(this.paths.engine)
      .filter(([, e]) => !e.path.includes("{"))
      .map(([key]) => key)
      .filter((key) => !existsSync(this.resolve(key)));
  }

  character(id: BotId): CharacterInfo {
    type Lore = {
      rules: string[];
      characters: Record<string, string[]>;
      shared: { characters: string[]; facts: string[] }[];
      community: { characters: string[]; facts: string[] }[];
    };
    type Chars = { characters: Record<string, { displayName: string; subtitleColor: string; avatarDir: string; reactions: Record<string, string> }> };
    const lore = this.readJson<Lore>("lore");
    const chars = this.readJson<Chars>("characters");
    const c = chars.characters[id];
    const facts = lore.characters[id] ?? this.extraLore(id);
    if (!c || !facts) throw new EngineDataError(`El motor no tiene datos del personaje ${id}`);
    const pick = (list: { characters: string[]; facts: string[] }[]) =>
      list.filter((x) => x.characters.includes(id)).flatMap((x) => x.facts);
    return {
      id,
      displayName: c.displayName,
      color: parseInt(c.subtitleColor.replace("#", ""), 16),
      avatarDir: path.join(this.engineDir, c.avatarDir),
      reactions: c.reactions,
      lore: facts,
      shared: pick(lore.shared),
      community: pick(lore.community),
      loreRules: lore.rules,
    };
  }

  /** Elenco del canal (lore.json -> characters) con su nombre visible: los Vocaloids que se pueden pedir en un video. */
  cast(): { id: string; name: string }[] {
    const lore = this.readJson<{ characters: Record<string, unknown> }>("lore");
    const chars = this.readJson<{ characters: Record<string, { displayName: string }> }>("characters");
    return Object.keys(lore.characters).map((id) => ({ id, name: chars.characters[id]?.displayName ?? id }));
  }

  /** Imagen de una emocion del personaje (ej.: neru + enojado), o null si no existe. */
  reactionImage(info: CharacterInfo, emotion: string): string | null {
    const file = info.reactions[emotion];
    if (!file) return null;
    const full = path.join(info.avatarDir, file);
    return existsSync(full) ? full : null;
  }
}
