/**
 * Encart de réassurance affiché juste avant le bouton de confirmation (décision
 * validée le 2026-07-07) : dit clairement ce qui va se passer, en particulier que
 * rien n'est jamais supprimé.
 */
export function ReassuranceBox({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
      <p className="font-medium">Vous êtes sur le point d'enregistrer :</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-blue-700">Cette opération sera enregistrée dans l'historique des imports.</p>
    </div>
  );
}
