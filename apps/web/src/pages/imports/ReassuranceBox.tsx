/**
 * Encart de réassurance affiché juste avant le bouton de confirmation (décision
 * validée le 2026-07-07) : dit clairement ce qui va se passer, en particulier que
 * rien n'est jamais supprimé.
 */
export function ReassuranceBox({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-xl border border-divider bg-navy/5 p-4 text-sm text-navy">
      <p className="font-medium">Vous êtes sur le point d'enregistrer :</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-navy">Cette opération sera enregistrée dans l'historique des imports.</p>
    </div>
  );
}
