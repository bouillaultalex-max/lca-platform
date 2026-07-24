import type { AiMessage } from '../../../generated/prisma/client';

/**
 * Résumé déterministe de la portion d'historique écartée (AI-05) — jamais
 * d'appel IA, jamais de reformulation ni d'interprétation du contenu des
 * messages : uniquement des métadonnées structurelles (compteurs de rôles,
 * noms d'outils appelés). Les noms d'outils proviennent exclusivement des
 * lignes `TOOL_CALL` persistées (voir AI-04 : nom seul, jamais de paramètre ni
 * de résultat) — dédupliqués et triés pour rester déterministes.
 */
export function buildDeterministicSummary(discarded: AiMessage[]): string {
  const userCount = discarded.filter((m) => m.role === 'USER').length;
  const assistantCount = discarded.filter((m) => m.role === 'ASSISTANT').length;
  const toolNames = Array.from(
    new Set(
      discarded
        .filter(
          (m): m is AiMessage & { toolName: string } =>
            m.role === 'TOOL_CALL' && m.toolName !== null,
        )
        .map((m) => m.toolName),
    ),
  ).sort();

  const lines = [
    'Conversation précédente :',
    `- ${userCount} message(s) utilisateur`,
    `- ${assistantCount} réponse(s) assistant`,
  ];
  if (toolNames.length > 0) {
    lines.push('- outils utilisés :');
    for (const name of toolNames) {
      lines.push(`  - ${name}`);
    }
  }
  return lines.join('\n');
}
