import type { ExpectedRequirementsImportPreviewResult } from '@lca-mes/shared';
import { SummaryCard, SummaryDashboard } from './SummaryCard';
import { ReassuranceBox } from './ReassuranceBox';

const cellClass = 'border border-gray-200 px-2 py-1.5 text-sm';

export function ExpectedRequirementsPreviewPanel({
  result,
  selectedLines,
  onToggleLine,
  onToggleAll,
  onConfirm,
  isConfirming,
  confirmError,
}: {
  result: ExpectedRequirementsImportPreviewResult;
  selectedLines: Set<number>;
  onToggleLine: (line: number) => void;
  onToggleAll: (checked: boolean, lines: number[]) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  confirmError: string | null;
}) {
  const toImport = result.toImport ?? [];
  const errors = result.errors ?? [];
  const selectableLines = toImport.map((r) => r.line);
  const allSelected = selectableLines.length > 0 && selectableLines.every((line) => selectedLines.has(line));
  const selectedCount = selectableLines.filter((line) => selectedLines.has(line)).length;

  return (
    <div className="space-y-6">
      <SummaryDashboard>
        <SummaryCard icon="📈" value={toImport.length} label="Besoins importés" tone="blue" />
        {errors.length > 0 && <SummaryCard icon="❌" value={errors.length} label="Erreurs" tone="red" />}
      </SummaryDashboard>

      <p className="text-xs text-gray-500">
        Chaque ligne ajoute un nouveau besoin à l'historique — aucune donnée existante n'est modifiée ou remplacée.
      </p>

      {selectableLines.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onToggleAll(event.target.checked, selectableLines)}
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          />
          Tout sélectionner ({selectedCount} / {selectableLines.length} lignes retenues)
        </label>
      )}

      {toImport.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900">Besoins attendus à ajouter</h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-divider">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className={cellClass}></th>
                  <th className={cellClass}>Référence</th>
                  <th className={cellClass}>Besoin attendu</th>
                  <th className={cellClass}>Quantité réservée</th>
                  <th className={cellClass}>Date</th>
                </tr>
              </thead>
              <tbody>
                {toImport.map((row) => (
                  <tr key={row.line} className="odd:bg-white even:bg-gray-50">
                    <td className={cellClass}>
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner la ligne ${row.line}`}
                        checked={selectedLines.has(row.line)}
                        onChange={() => onToggleLine(row.line)}
                        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                      />
                    </td>
                    <td className={cellClass}>{row.articleReference}</td>
                    <td className={`${cellClass} text-right tabular-nums`}>{row.importedRequirement}</td>
                    <td className={`${cellClass} text-right tabular-nums`}>{row.reservedQuantity ?? '—'}</td>
                    <td className={cellClass}>{row.importedAt ?? 'À la confirmation'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {errors.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-red-700">Lignes en erreur (non importées)</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-red-200">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-red-50">
                <tr>
                  <th className={cellClass}>Ligne</th>
                  <th className={cellClass}>Référence</th>
                  <th className={cellClass}>Problème</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error) => (
                  <tr key={error.line} className="odd:bg-white even:bg-red-50/40">
                    <td className={cellClass}>{error.line}</td>
                    <td className={cellClass}>{error.articleReference ?? '—'}</td>
                    <td className={cellClass}>{error.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedCount > 0 && (
        <>
          <ReassuranceBox lines={[`${selectedCount} nouveaux besoins attendus`, '0 mise à jour', '0 suppression']} />
          {confirmError && (
            <p role="alert" className="text-sm text-red-600">
              {confirmError}
            </p>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConfirming ? 'Confirmation en cours…' : "Confirmer l'import"}
          </button>
        </>
      )}
    </div>
  );
}
