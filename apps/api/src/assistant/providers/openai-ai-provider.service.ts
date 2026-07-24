import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  AiProvider,
  AiProviderMessage,
  AiProviderOptions,
  AiProviderStreamChunk,
} from './ai-provider.interface';
import type { AiToolSpec } from './ai-tool-spec';
import { buildOpenAiToolNameCodec } from './openai-tool-name-codec.util';
import {
  mapMessagesToOpenAi,
  mapToolsToOpenAi,
} from './openai-message-mapper.util';
import {
  OpenAiToolCallAccumulator,
  type AccumulatedToolCall,
} from './openai-tool-call-accumulator';
import { categorizeOpenAiError } from './openai-error-mapper.util';
import { genericMessageFor } from './ai-provider-error-category';

/**
 * Premier adaptateur `AiProvider` réel (AI-06) — traduit uniquement notre
 * protocole interne vers l'API OpenAI (Chat Completions, streaming) et
 * inversement. N'accède jamais à Prisma, à ToolRegistryService ni à
 * ToolExecutorService, n'exécute jamais un outil, n'applique aucune
 * permission, ne modifie jamais le contexte ni les messages reçus — il ne
 * fait que traduire (voir AssistantModule pour la construction du client
 * `OpenAI` injecté, via une factory unique, jamais `new OpenAI()` ailleurs).
 *
 * Ne journalise rien lui-même : seuls les chunks du protocole existant
 * (`text`/`tool_call`/`done`/`error`) sortent d'ici, à charge des couches
 * supérieures (déjà en place depuis AI-02/04) de journaliser ce qu'elles
 * jugent utile.
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  constructor(private readonly client: OpenAI) {}

  async *streamResponse(
    messages: AiProviderMessage[],
    tools: AiToolSpec[],
    options: AiProviderOptions,
    signal: AbortSignal,
  ): AsyncIterable<AiProviderStreamChunk> {
    if (signal.aborted) return;

    const codec = buildOpenAiToolNameCodec(tools);
    const openAiMessages = mapMessagesToOpenAi(messages, codec);
    const openAiTools = mapToolsToOpenAi(tools, codec);

    let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: options.model,
          messages: openAiMessages,
          ...(openAiTools.length > 0 ? { tools: openAiTools } : {}),
          max_completion_tokens: options.maxOutputTokens,
          stream: true,
        },
        { signal },
      );
    } catch (err) {
      if (signal.aborted) return;
      yield { type: 'error', message: categorizeOpenAiError(err).message };
      return;
    }

    const accumulator = new OpenAiToolCallAccumulator();
    let finishReason: string | null = null;

    try {
      for await (const chunk of stream) {
        if (signal.aborted) return;

        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.delta.content) {
          yield { type: 'text', delta: choice.delta.content };
        }
        if (choice.delta.tool_calls) {
          for (const toolCallDelta of choice.delta.tool_calls) {
            accumulator.addDelta(toolCallDelta);
          }
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      yield { type: 'error', message: categorizeOpenAiError(err).message };
      return;
    }

    if (signal.aborted) return;

    // Jamais considérés comme une fin normale (voir AI-06 §Finish reasons) :
    // le texte/les appels déjà émis ne sont pas la réponse complète attendue.
    if (finishReason === 'length') {
      yield {
        type: 'error',
        message: genericMessageFor('incomplete_response'),
      };
      return;
    }
    if (finishReason === 'content_filter') {
      yield { type: 'error', message: genericMessageFor('content_filtered') };
      return;
    }

    if (finishReason === 'tool_calls') {
      let toolCalls: AccumulatedToolCall[];
      try {
        toolCalls = accumulator.finalize();
      } catch {
        yield {
          type: 'error',
          message: genericMessageFor('malformed_provider_response'),
        };
        return;
      }

      for (const call of toolCalls) {
        if (signal.aborted) return;
        yield {
          type: 'tool_call',
          id: call.id,
          name: codec.toInternalName(call.name),
          input: call.input,
        };
      }
      if (!signal.aborted) yield { type: 'done' };
      return;
    }

    // 'stop' (cas normal) — ou un finish_reason non géré explicitement :
    // traité comme une fin normale, le texte déjà émis reste la réponse.
    if (!signal.aborted) yield { type: 'done' };
  }
}
