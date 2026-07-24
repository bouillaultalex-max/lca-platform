import { Injectable } from '@nestjs/common';
import type {
  AiProvider,
  AiProviderMessage,
  AiProviderOptions,
  AiProviderStreamChunk,
} from './ai-provider.interface';
import type { AiToolSpec } from './ai-tool-spec';

const CHUNK_DELAY_MS = 30;

/**
 * Implémentation temporaire de `AiProvider` — ne contacte aucun fournisseur
 * réel, ne contient aucune logique de fournisseur réel. À remplacer par un
 * vrai fournisseur dans un ticket ultérieur : aucun autre fichier n'en dépend
 * directement, tous passent par l'interface `AiProvider` et le jeton
 * `AI_PROVIDER`. Respecte `signal` : vérifié avant/pendant chaque fragment.
 *
 * Simulation déterministe du tool calling (AI-04) — aucune IA réelle,
 * aucune interprétation sémantique :
 * - si les derniers messages de l'historique sont des `tool_result` (on est
 *   rappelé après exécution d'un ou plusieurs outils par
 *   ToolCallingOrchestrator), produit un texte final résumant le nombre de
 *   succès/échecs, sans nouvel appel d'outil ;
 * - sinon, si le dernier message utilisateur contient littéralement le nom
 *   exact d'un ou plusieurs outils reçus dans `tools` (ex: "teste
 *   dashboard.getSummary"), émet un `tool_call` par nom trouvé, avec une
 *   entrée vide (`{}`) — suffisant pour les outils sans paramètre (démontre le
 *   chemin de succès), volontairement insuffisant pour les outils avec
 *   paramètres obligatoires (démontre alors le chemin d'erreur de validation,
 *   lui aussi un `ToolResult`, jamais un crash) ;
 * - sinon, comportement inchangé (AI-02/03) : reprend le dernier message
 *   utilisateur dans un texte fixe, sans aucun appel d'outil.
 */
@Injectable()
export class EchoAiProvider implements AiProvider {
  async *streamResponse(
    messages: AiProviderMessage[],
    tools: AiToolSpec[],
    _options: AiProviderOptions,
    signal: AbortSignal,
  ): AsyncIterable<AiProviderStreamChunk> {
    void _options;

    if (signal.aborted) return;

    const trailingToolResults = getTrailingToolResults(messages);
    if (trailingToolResults.length > 0) {
      yield* this.emitText(summarizeToolResults(trailingToolResults), signal);
      if (!signal.aborted) yield { type: 'done' };
      return;
    }

    const lastUserMessage = [...messages]
      .reverse()
      .find(
        (m): m is Extract<AiProviderMessage, { role: 'user' }> =>
          m.role === 'user',
      );
    const matchedTools = lastUserMessage
      ? tools.filter((tool) => lastUserMessage.content.includes(tool.name))
      : [];

    if (matchedTools.length > 0) {
      yield* this.emitText(
        `Assistant en cours de construction (AI-04). J'appelle ${matchedTools.length} outil(s) déterministe(s).`,
        signal,
      );
      if (signal.aborted) return;

      let callIndex = 0;
      for (const tool of matchedTools) {
        callIndex += 1;
        if (signal.aborted) return;
        yield {
          type: 'tool_call',
          id: `echo-call-${callIndex}`,
          name: tool.name,
          input: {},
        };
      }
      if (!signal.aborted) yield { type: 'done' };
      return;
    }

    const text = lastUserMessage
      ? `Assistant en cours de construction (AI-02). Vous avez écrit : "${lastUserMessage.content}".`
      : 'Assistant en cours de construction (AI-02). Aucun message reçu.';
    yield* this.emitText(text, signal);
    if (!signal.aborted) yield { type: 'done' };
  }

  private async *emitText(
    text: string,
    signal: AbortSignal,
  ): AsyncIterable<Extract<AiProviderStreamChunk, { type: 'text' }>> {
    for (const word of text.split(' ')) {
      if (signal.aborted) return;
      await delay(CHUNK_DELAY_MS);
      if (signal.aborted) return;
      yield { type: 'text', delta: `${word} ` };
    }
  }
}

function getTrailingToolResults(
  messages: AiProviderMessage[],
): Extract<AiProviderMessage, { role: 'tool_result' }>[] {
  const trailing: Extract<AiProviderMessage, { role: 'tool_result' }>[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'tool_result') {
      trailing.unshift(message);
    } else {
      break;
    }
  }
  return trailing;
}

function summarizeToolResults(
  results: Extract<AiProviderMessage, { role: 'tool_result' }>[],
): string {
  const successCount = results.filter((r) => r.payload.success).length;
  const failureCount = results.length - successCount;
  return (
    `Résultat(s) d'outil reçu(s) (AI-04) : ${results.length} appel(s), ` +
    `${successCount} succès, ${failureCount} échec(s). Réponse simulée.`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
