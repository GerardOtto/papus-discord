// Arma la cadena de LLM desde config/llm.json y las claves del entorno. Un proveedor sin clave se omite.
import { readFileSync } from "node:fs";
import path from "node:path";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { LLMProvider } from "./provider";

export interface LLMSettings {
  providers: {
    name: string;
    baseUrl: string;
    model: string;
    /** Variable del .env con la clave; sin ella (LLM local, ej. Ollama) no se exige clave. */
    keyEnv?: string;
    dailyRequests?: number;
    /** Tiempo maximo de este proveedor (si no, el general). El local usa uno corto para ceder rapido si la tarjeta esta ocupada. */
    timeoutMs?: number;
    extra?: Record<string, unknown>;
  }[];
  timeoutMs: number;
  /** "apis" = las APIs se turnan y el local es respaldo; "local" (por defecto) = el local primero (src/llm/router.ts). */
  preferencia?: "local" | "apis";
  maxTokens: number;
  temperature: number;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadLLMSettings(file = path.join(REPO_ROOT, "config/llm.json")): LLMSettings {
  return JSON.parse(readFileSync(file, "utf8")) as LLMSettings;
}

export function buildProviders(
  settings: LLMSettings,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn?: typeof fetch,
): { providers: LLMProvider[]; skipped: string[]; dailyLimits: Record<string, number> } {
  const providers: LLMProvider[] = [];
  const skipped: string[] = [];
  const dailyLimits: Record<string, number> = {};
  for (const p of settings.providers) {
    const apiKey = p.keyEnv ? env[p.keyEnv]?.trim() : "local";
    let missingVar = !apiKey;
    const baseUrl = p.baseUrl.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = env[k]?.trim();
      if (!v) missingVar = true;
      return v ?? "";
    });
    if (missingVar) {
      skipped.push(p.name);
      continue;
    }
    providers.push(
      new OpenAICompatibleProvider({
        name: p.name,
        baseUrl,
        model: p.model,
        apiKey: apiKey!,
        timeoutMs: p.timeoutMs ?? settings.timeoutMs,
        extra: p.extra,
        fetchFn,
      }),
    );
    if (p.dailyRequests) dailyLimits[p.name] = p.dailyRequests;
  }
  return { providers, skipped, dailyLimits };
}
