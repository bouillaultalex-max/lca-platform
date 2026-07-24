/**
 * Contrat officiel décrivant un outil à un fournisseur IA (AI-04) : un provider
 * ne connaît jamais `ToolDefinition`/`ToolRegistryService`/`ToolExecutorService`
 * (voir tools/tool.types.ts) — uniquement cette forme neutre, construite par
 * `buildAiToolCatalog` (voir tools/ai-tool-catalog.ts). Aucune dépendance à un
 * format de fournisseur réel (OpenAI, Anthropic, ...) : chaque adaptateur futur
 * traduira `AiToolSpec` vers son propre format de function/tool calling.
 */

/** Sous-ensemble volontairement restreint de JSON Schema : uniquement ce dont
 * les 6 outils actuels ont besoin pour décrire leurs paramètres (voir AI-03,
 * tools/dto/*.dto.ts). Étendre au cas par cas si un futur outil l'exige. */
export interface AiJsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  minLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface AiJsonSchema {
  type: 'object';
  properties: Record<string, AiJsonSchemaProperty>;
  required?: string[];
}

export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: AiJsonSchema;
}
