/**
 * Paramètres de limitation de débit sur POST /auth/login (voir audit sécurité SEC-02).
 * Volontairement isolés dans leur propre fichier : seule cette route est concernée,
 * aucun autre endpoint de l'API n'est limité.
 *
 * 10 tentatives / 60 secondes / IP : réduit fortement le débit d'une attaque par force
 * brute (à comparer à un débit auparavant illimité) tout en restant large pour un usage
 * légitime (plusieurs utilisateurs derrière la même IP de laboratoire, quelques fautes
 * de frappe). Ne remplace pas un verrouillage de compte (hors périmètre, voir ticket
 * séparé) : c'est un simple frein réseau par IP.
 */
export const LOGIN_THROTTLE_TTL_MS = 60_000;
export const LOGIN_THROTTLE_LIMIT = 10;
