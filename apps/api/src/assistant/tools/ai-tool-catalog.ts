import type { ToolDefinition } from './tool.types';
import type { AiJsonSchema, AiToolSpec } from '../providers/ai-tool-spec';

/**
 * Traduit le registre interne (`ToolDefinition[]`, voir tool.types.ts) vers le
 * contrat neutre transmis aux fournisseurs IA (`AiToolSpec[]`, voir
 * providers/ai-tool-spec.ts) — un provider ne voit jamais `handler`, `permission`
 * ni `inputSchema` (classe `class-validator`) d'un `ToolDefinition` (AI-04).
 *
 * Écrits à la main (pas de dépendance `class-validator-jsonschema` ni
 * équivalente, décision AI-04) : un schéma par outil, à tenir manuellement en
 * cohérence avec le DTO réel de l'outil (voir tools/dto/*.dto.ts). Si un outil
 * enregistré n'a pas d'entrée ici, `buildAiToolCatalog` échoue explicitement
 * plutôt que de transmettre un schéma erroné ou absent à un fournisseur.
 */

const EMPTY_OBJECT_SCHEMA: AiJsonSchema = { type: 'object', properties: {} };

const TOOL_INPUT_JSON_SCHEMAS: Record<string, AiJsonSchema> = {
  'dashboard.getSummary': EMPTY_OBJECT_SCHEMA,
  'stock.getArticleAvailability': {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "Texte recherché dans le nom ou la référence OpenSi d'un article.",
        minLength: 1,
      },
    },
    required: ['query'],
  },
  'stock.listLowStockItems': EMPTY_OBJECT_SCHEMA,
  'traceability.getLotByNumber': {
    type: 'object',
    properties: {
      lotNumber: {
        type: 'string',
        description:
          'Numéro de lot métier tel que fourni par l’utilisateur — jamais un numéro inventé.',
        minLength: 1,
      },
    },
    required: ['lotNumber'],
  },
  'production.getBatch': {
    type: 'object',
    properties: {
      batchId: {
        type: 'string',
        description:
          "Identifiant technique (UUID) du batch — jamais un numéro inventé, ce module n'a pas de code lisible.",
      },
    },
    required: ['batchId'],
  },
  'imports.getImportHistory': {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description: "Nombre maximal d'entrées à renvoyer (1 à 50).",
        minimum: 1,
        maximum: 50,
      },
    },
  },
};

export function buildAiToolCatalog(tools: ToolDefinition[]): AiToolSpec[] {
  return tools.map((tool) => {
    const inputSchema = TOOL_INPUT_JSON_SCHEMAS[tool.name];
    if (!inputSchema) {
      throw new Error(
        `Aucun schéma JSON déclaré pour l'outil "${tool.name}" — voir TOOL_INPUT_JSON_SCHEMAS dans ai-tool-catalog.ts.`,
      );
    }
    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
    };
  });
}
