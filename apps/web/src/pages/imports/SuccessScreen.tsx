/**
 * Véritable écran de réussite (pas un simple bandeau) après une confirmation
 * réussie — décision validée le 2026-07-07.
 */
export function SuccessScreen({
  lines,
  errorSummary,
  onBackToImports,
  onNewImport,
}: {
  lines: string[];
  errorSummary?: string;
  onBackToImports: () => void;
  onNewImport: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-green-200 bg-green-50 p-10 text-center">
      <div className="text-5xl">✅</div>
      <h3 className="mt-3 text-lg font-semibold text-green-900">Import terminé</h3>
      <ul className="mt-3 space-y-1 text-sm text-green-800">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {errorSummary && <p className="mt-2 text-sm font-medium text-red-600">{errorSummary}</p>}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onBackToImports}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
        >
          Retour aux imports
        </button>
        <button
          type="button"
          onClick={onNewImport}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Nouvel import
        </button>
      </div>
    </div>
  );
}
