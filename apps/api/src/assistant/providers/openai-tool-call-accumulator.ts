/** Fragment brut d'un appel d'outil tel que streamé par OpenAI (un extrait de
 * `ChatCompletionChunk.Choice.Delta.ToolCall`) — jamais le type SDK complet
 * importé ici, uniquement la forme dont l'accumulateur a besoin. */
export interface OpenAiToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface AccumulatedToolCall {
  id: string;
  name: string;
  input: unknown;
}

interface PendingToolCall {
  id?: string;
  name: string;
  argsBuffer: string;
}

/**
 * Accumule les fragments de tool calls reçus au fil du flux OpenAI (id, nom et
 * arguments peuvent arriver en plusieurs morceaux, voir AI-06 §Assemblage Tool
 * Calls) et ne produit un appel interne que si, à la clôture du tour :
 * identifiant présent, nom présent, arguments JSON complets et valides.
 * Sinon : lève une erreur explicite (jamais une invention silencieuse) —
 * l'appelant (voir openai-ai-provider.service.ts) la traduit en catégorie
 * `malformed_provider_response`.
 */
export class OpenAiToolCallAccumulator {
  private readonly pending = new Map<number, PendingToolCall>();

  addDelta(delta: OpenAiToolCallDelta): void {
    const existing = this.pending.get(delta.index) ?? {
      name: '',
      argsBuffer: '',
    };
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name += delta.function.name;
    if (delta.function?.arguments)
      existing.argsBuffer += delta.function.arguments;
    this.pending.set(delta.index, existing);
  }

  finalize(): AccumulatedToolCall[] {
    const indices = [...this.pending.keys()].sort((a, b) => a - b);
    const results: AccumulatedToolCall[] = [];

    for (const index of indices) {
      const call = this.pending.get(index)!;
      if (!call.id || call.name.length === 0) {
        throw new Error(
          `Appel d'outil incomplet reçu du fournisseur (identifiant ou nom manquant, index ${index}).`,
        );
      }

      let input: unknown;
      try {
        input = call.argsBuffer.length > 0 ? JSON.parse(call.argsBuffer) : {};
      } catch {
        throw new Error(
          `Arguments JSON invalides reçus du fournisseur pour l'outil "${call.name}".`,
        );
      }

      results.push({ id: call.id, name: call.name, input });
    }

    return results;
  }
}
