import type { StocksImportPreviewResult } from '@lca-mes/shared';
import { SummaryCard, SummaryDashboard } from './SummaryCard';
import { ReassuranceBox } from './ReassuranceBox';

const cellClass = 'border border-gray-200 px-2 py-1.5 text-sm';

export function StocksPreviewPanel({
  result,
  selectedLines,
  onToggleLine,
  onToggleAll,
  onConfirm,
  isConfirming,
  confirmError,
}: {
  result: StocksImportPreviewResult;
  selectedLines: Set<number>;
  onToggleLine: (line: number) => void;
  onToggleAll: (checked: boolean, lines: number[]) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  confirmError: string | null;
}) {
  const toReceive = result.toReceive ?? [];
  const warnings = result.warnings ?? [];
  const errors = result.errors ?? [];
  const warningByLine = new Map(warnings.map((warning) => [warning.line, warning.message]));
  const selectableLines = toReceive.map((r) => r.line);
  const allSelected = selectableLines.length > 0 && selectableLines.every((line) => selectedLines.has(line));
  const selectedCount = selectableLines.filter((line) => selectedLines.has(line)).length;

  return (
    <div className="space-y-6">
      <SummaryDashboard>
        <SummaryCard icon="📦" value={toReceive.length} label="Réceptions" tone="blue" />
        {warnings.length > 0 && <SummaryCard icon="⚠" value={warnings.length} label="Avertissements" tone="amber" />}
        {errors.length > 0 && <SummaryCard icon="❌" value={errors.length} label="Erreurs" tone="red" />}
      </SummaryDashboard>

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

      {toReceive.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900">Réceptions à enregistrer</h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-divider">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className={cellClass}></th>
                  <th className={cellClass}>Référence</th>
                  <th className={cellClass}>Lot fournisseur</th>
                  <th className={cellClass}>Quantité</th>
                  <th className={cellClass}>Date de réception</th>
                  <th className={cellClass}>Péremption</th>
                </tr>
              </thead>
              <tbody>
                {toReceive.map((row) => {
                  const warning = warningByLine.get(row.line);
                  return (
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
                      <td className={cellClass}>
                        {row.articleReference}
                        {warning && <p className="mt-0.5 text-xs text-amber-700">⚠ {warning}</p>}
                      </td>
                      <td className={cellClass}>{row.supplierLotNumber}</td>
                      <td className={`${cellClass} text-right tabular-nums`}>{row.receivedQuantity}</td>
                      <td className={cellClass}>{row.receivedAt}</td>
                      <td className={cellClass}>{row.expiryDate ?? '—'}</td>
                    </tr>
                  );
                })}
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
          <ReassuranceBox lines={[`${selectedCount} réceptions de stock`, '0 suppression']} />
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
