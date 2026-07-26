/**
 * Paramètres de limitation de débit sur POST /assistant/messages (voir ticket AI-08).
 * Volontairement isolés dans leur propre fichier, comme `login-throttle.constants.ts`
 * (SEC-02) : seule cette route est concernée, aucun autre endpoint de l'API n'est limité.
 *
 * 5 messages / 60 secondes / utilisateur authentifié : borne le débit d'appels réels au
 * fournisseur IA (coût direct dès que `AI_PROVIDER=openai`) pour un usage conversationnel
 * humain normal, sans bloquer un échange légitime avec plusieurs relances rapprochées.
 */
export const ASSISTANT_THROTTLE_TTL_MS = 60_000;
export const ASSISTANT_THROTTLE_LIMIT = 5;
