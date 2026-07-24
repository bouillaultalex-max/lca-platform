/**
 * Taxonomie minimale, provider-agnostic, des erreurs de fournisseur IA (AI-06).
 * Reste strictement interne : jamais transmise au frontend (qui ne reçoit que
 * le message générique existant `AiProviderStreamChunk.error.message`, voir
 * ai-provider.interface.ts, inchangé), utile uniquement pour la journalisation
 * serveur et pour choisir un message adapté côté adaptateur.
 */
export type AiProviderErrorCategory =
  | 'authentication_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'model_unavailable'
  | 'timeout'
  | 'aborted'
  | 'network_error'
  | 'malformed_provider_response'
  | 'unknown_provider_error'
  | 'incomplete_response'
  | 'content_filtered';

export interface CategorizedProviderError {
  category: AiProviderErrorCategory;
  /** Message générique, sûr à journaliser et à transmettre tel quel dans un
   * chunk `{type:'error'}` — jamais de détail technique brut du fournisseur. */
  message: string;
}

const GENERIC_MESSAGES: Record<AiProviderErrorCategory, string> = {
  authentication_error: "Échec d'authentification auprès du fournisseur IA.",
  rate_limit: 'Le fournisseur IA a limité le débit de requêtes.',
  invalid_request: 'Requête invalide envoyée au fournisseur IA.',
  model_unavailable: 'Le modèle demandé est indisponible.',
  timeout: "Le fournisseur IA n'a pas répondu à temps.",
  aborted: 'Génération annulée.',
  network_error:
    'Erreur réseau lors de la communication avec le fournisseur IA.',
  malformed_provider_response: 'Réponse du fournisseur IA malformée.',
  unknown_provider_error:
    'Une erreur inconnue est survenue côté fournisseur IA.',
  incomplete_response:
    'Le fournisseur IA a interrompu sa réponse avant la fin (limite de longueur atteinte).',
  content_filtered: 'La réponse a été filtrée par le fournisseur IA.',
};

export function genericMessageFor(category: AiProviderErrorCategory): string {
  return GENERIC_MESSAGES[category];
}
