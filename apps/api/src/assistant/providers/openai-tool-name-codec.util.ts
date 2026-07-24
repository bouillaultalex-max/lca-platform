import type { AiToolSpec } from './ai-tool-spec';

/**
 * OpenAI restreint les noms de fonction à `[a-zA-Z0-9_-]` (64 caractères max) —
 * nos noms internes (`dashboard.getSummary`, ...) contiennent des points,
 * interdits. Cette correspondance bidirectionnelle reste strictement interne à
 * l'adaptateur OpenAI : `AiToolSpec.name` n'est jamais modifié à la source
 * (voir tools/ai-tool-catalog.ts), uniquement traduit à l'aller (vers OpenAI)
 * et au retour (depuis un `tool_call` reçu).
 */
export interface OpenAiToolNameCodec {
  toOpenAiName(internalName: string): string;
  /** Ne devine ni ne corrige jamais un nom inconnu : renvoie le nom OpenAI reçu
   * tel quel si aucune correspondance n'existe, pour laisser ToolRegistry (en
   * aval, jamais consulté ici) constater lui-même l'outil inconnu. */
  toInternalName(openAiName: string): string;
}

const DISALLOWED_CHARACTERS = /[^a-zA-Z0-9_-]/g;
const MAX_NAME_LENGTH = 64;

function sanitizeToolName(name: string): string {
  return name.replace(DISALLOWED_CHARACTERS, '_').slice(0, MAX_NAME_LENGTH);
}

export function buildOpenAiToolNameCodec(
  tools: AiToolSpec[],
): OpenAiToolNameCodec {
  const toOpenAi = new Map<string, string>();
  const toInternal = new Map<string, string>();

  for (const tool of tools) {
    const sanitized = sanitizeToolName(tool.name);
    const existing = toInternal.get(sanitized);
    if (existing !== undefined && existing !== tool.name) {
      throw new Error(
        `Collision de nom d'outil après normalisation OpenAI : "${tool.name}" et "${existing}" produisent tous deux "${sanitized}".`,
      );
    }
    toOpenAi.set(tool.name, sanitized);
    toInternal.set(sanitized, tool.name);
  }

  return {
    toOpenAiName: (internalName) =>
      toOpenAi.get(internalName) ?? sanitizeToolName(internalName),
    toInternalName: (openAiName) => toInternal.get(openAiName) ?? openAiName,
  };
}
