import type { AssistantSseEvent, SendAssistantMessageRequest } from '@lca-mes/shared';

export interface AssistantStreamHandlers {
  onEvent: (event: AssistantSseEvent) => void;
  onError: (message: string) => void;
  onComplete: () => void;
}

/**
 * Client SSE de l'assistant (AI-02). Utilise `fetch` + lecture manuelle du flux
 * plutôt que l'API navigateur `EventSource` : `EventSource` ne permet ni
 * d'envoyer un en-tête `Authorization` (JWT, voir api/client.ts), ni de faire un
 * POST — deux contraintes incompatibles avec l'authentification déjà en place
 * dans ce dépôt (voir AI-01 §16). Chaque trame SSE ne porte qu'une seule ligne
 * `data:` en JSON ; le type d'événement est dans le JSON lui-même (`type`),
 * jamais dans le champ `event:` de la trame.
 */
export function streamAssistantMessage(
  token: string,
  payload: SendAssistantMessageRequest,
  handlers: AssistantStreamHandlers,
  signal: AbortSignal,
): void {
  void (async () => {
    let response: Response;
    try {
      response = await fetch('/assistant/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) return;
      handlers.onError("Impossible de contacter l'assistant.");
      return;
    }

    if (!response.ok) {
      handlers.onError(`Erreur ${response.status} lors de l'appel à l'assistant.`);
      return;
    }
    if (!response.body) {
      handlers.onError("Réponse de l'assistant sans contenu.");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const event = parseSseFrame(frame);
          if (event) handlers.onEvent(event);
        }
      }
      handlers.onComplete();
    } catch (err) {
      if (isAbortError(err)) return;
      handlers.onError("La connexion avec l'assistant a été interrompue.");
    }
  })();
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function parseSseFrame(frame: string): AssistantSseEvent | null {
  const dataLine = frame
    .split('\n')
    .find((line) => line.startsWith('data:'));
  if (!dataLine) return null; // ligne de commentaire (ex: heartbeat) ou trame vide

  try {
    return JSON.parse(dataLine.slice('data:'.length).trim()) as AssistantSseEvent;
  } catch {
    return null;
  }
}
