import { Injectable } from '@nestjs/common';
import type {
  AiProvider,
  AiProviderMessage,
  AiProviderOptions,
  AiProviderStreamChunk,
} from './ai-provider.interface';
import type { ToolDefinition } from '../tools/tool.types';

const CHUNK_DELAY_MS = 30;

/**
 * Implémentation temporaire de `AiProvider` (AI-02) : ne contacte aucun
 * fournisseur réel, ne contient aucune logique de fournisseur. Renvoie un texte
 * fixe reprenant le dernier message utilisateur, découpé en fragments pour
 * exercer réellement le flux SSE de bout en bout (ouverture, fragments,
 * fermeture). Ignore volontairement `tools` (voir AI-03 : les 6 premiers outils
 * existent dans le registre mais aucun tool calling réel n'est encore effectué
 * par ce fournisseur temporaire) et `options` — à remplacer par un fournisseur
 * réel dans un ticket ultérieur (AI-04+) : aucun autre fichier ne dépend de
 * cette classe directement, tous passent par l'interface `AiProvider` et le
 * jeton `AI_PROVIDER`. Respecte `signal` (AI-03) : vérifié avant chaque
 * fragment, pour s'arrêter proprement dès l'annulation cliente.
 */
@Injectable()
export class EchoAiProvider implements AiProvider {
  async *streamResponse(
    messages: AiProviderMessage[],
    _tools: ToolDefinition[],
    _options: AiProviderOptions,
    signal: AbortSignal,
  ): AsyncIterable<AiProviderStreamChunk> {
    // `tools`/`options` font partie du contrat `AiProvider` mais ne sont pas
    // encore exploités par ce fournisseur temporaire (voir commentaire de classe).
    void _tools;
    void _options;

    if (signal.aborted) return;

    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user');
    const text = lastUserMessage
      ? `Assistant en cours de construction (AI-02). Vous avez écrit : "${lastUserMessage.content}".`
      : 'Assistant en cours de construction (AI-02). Aucun message reçu.';

    for (const word of text.split(' ')) {
      if (signal.aborted) return;
      await delay(CHUNK_DELAY_MS);
      if (signal.aborted) return;
      yield { type: 'text', delta: `${word} ` };
    }
    if (!signal.aborted) {
      yield { type: 'done' };
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
