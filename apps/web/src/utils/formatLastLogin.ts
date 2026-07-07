/**
 * Formate une date de dernière connexion en langage naturel ("Aujourd'hui à 08:13",
 * "Hier à 17:42", sinon "JJ/MM/AAAA à HH:mm") — jamais une date brute.
 */
export function formatLastLogin(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  if (isSameDay(date, now)) {
    return `Aujourd'hui à ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `Hier à ${time}`;
  }

  const day = date.toLocaleDateString('fr-FR');
  return `${day} à ${time}`;
}
