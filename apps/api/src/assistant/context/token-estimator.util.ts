/**
 * Estimation grossière du nombre de jetons d'un texte (AI-05) — aucune
 * dépendance à un tokenizer réel ni à un SDK de fournisseur : une
 * approximation volontairement simple (~4 caractères par jeton, arrondie au
 * jeton supérieur, avec un minimum d'un jeton par message non vide), isolée
 * dans cette seule fonction pour rester remplaçable (ex: un vrai tokenizer
 * par fournisseur) sans toucher au reste du Context Engine.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MIN_TOKENS_PER_NON_EMPTY_MESSAGE = 1;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(
    MIN_TOKENS_PER_NON_EMPTY_MESSAGE,
    Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE),
  );
}
