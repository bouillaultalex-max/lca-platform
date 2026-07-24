import OpenAI from 'openai';
import type { AiProviderMessage } from './ai-provider.interface';
import type {
  AiJsonSchema,
  AiJsonSchemaProperty,
  AiToolSpec,
} from './ai-tool-spec';
import type { OpenAiToolNameCodec } from './openai-tool-name-codec.util';

/**
 * Traduction protocole interne ↔ format natif OpenAI — strictement contenue
 * dans l'adaptateur (voir openai-ai-provider.service.ts). `AiToolSpec`/
 * `AiProviderMessage` ne sont jamais modifiés : ces fonctions ne font que
 * produire une représentation OpenAI distincte, jamais enrichir ou altérer la
 * source (voir tools/ai-tool-catalog.ts, ToolCallingOrchestrator).
 */

export function mapMessagesToOpenAi(
  messages: AiProviderMessage[],
  codec: OpenAiToolNameCodec,
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((message): OpenAI.ChatCompletionMessageParam => {
    switch (message.role) {
      case 'system':
        return { role: 'system', content: message.content };
      case 'user':
        return { role: 'user', content: message.content };
      case 'assistant':
        return { role: 'assistant', content: message.content };
      case 'assistant_tool_call':
        return {
          role: 'assistant',
          content: null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
              name: codec.toOpenAiName(call.name),
              arguments: JSON.stringify(call.input ?? {}),
            },
          })),
        };
      case 'tool_result':
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: JSON.stringify(
            message.payload.success
              ? message.payload.result
              : { error: message.payload.error },
          ),
        };
    }
  });
}

export function mapToolsToOpenAi(
  tools: AiToolSpec[],
  codec: OpenAiToolNameCodec,
): OpenAI.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: codec.toOpenAiName(tool.name),
      description: tool.description,
      parameters: mapJsonSchema(tool.inputSchema),
    },
  }));
}

function mapJsonSchema(schema: AiJsonSchema): Record<string, unknown> {
  return {
    type: schema.type,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, property]) => [
        key,
        mapJsonSchemaProperty(property),
      ]),
    ),
    ...(schema.required ? { required: schema.required } : {}),
    // Choix de traduction propre à OpenAI (bonne pratique recommandée pour un
    // tool calling fiable) — n'enrichit jamais `AiJsonSchema` lui-même, qui
    // reste transmis tel quel par ContextEngine/ToolCallingOrchestrator.
    additionalProperties: false,
  };
}

function mapJsonSchemaProperty(
  property: AiJsonSchemaProperty,
): Record<string, unknown> {
  return {
    type: property.type,
    ...(property.description ? { description: property.description } : {}),
    ...(property.minLength !== undefined
      ? { minLength: property.minLength }
      : {}),
    ...(property.minimum !== undefined ? { minimum: property.minimum } : {}),
    ...(property.maximum !== undefined ? { maximum: property.maximum } : {}),
  };
}
