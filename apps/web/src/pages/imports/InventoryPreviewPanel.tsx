import type { InventoryImportPreviewResult } from '@lca-mes/shared';

const cellClass = 'border border-gray-200 px-2 py-1.5 text-sm';

function formatCell(value: string | number | boolean | null): string {
  if (value === null) return '—';
  return String(value);
}

/**
 * Import Inventaire volontairement partiel (voir décision du 2026-07-06) : aperçu
 * uniquement, aucune case à cocher, aucun bouton de confirmation.
 */
export function InventoryPreviewPanel({
  result,
  onFinish,
}: {
  result: InventoryImportPreviewResult;
  onFinish: () => void;
}) {
  const rows = result.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Aperçu uniquement</p>
        <p className="mt-1">
          La confirmation de l'import Inventaire n'est pas encore disponible. Ce fichier n'a été que lu et
          affiché ci-dessous — rien n'a été ni ne sera enregistré.
        </p>
      </div>

      {result.hasSupplierLotNumber !== undefined && (
        <p className="text-sm text-gray-700">
          {result.hasSupplierLotNumber
            ? '📦 Ce fichier précise un numéro de lot fournisseur pour chaque ligne.'
            : '📊 Ce fichier ne fournit qu\'une quantité globale par article, sans numéro de lot.'}
        </p>
      )}

      {rows.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900">Contenu du fichier ({rows.length} lignes)</h3>
          <div className="mt-2 max-h-[400px] overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className={cellClass}>Référence</th>
                  <th className={cellClass}>Quantité comptée</th>
                  <th className={cellClass}>Lot fournisseur</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.line} className="odd:bg-white even:bg-gray-50">
                    <td className={cellClass}>{formatCell(row.articleReference)}</td>
                    <td className={`${cellClass} text-right tabular-nums`}>{formatCell(row.countedQuantity)}</td>
                    <td className={cellClass}>{formatCell(row.supplierLotNumber)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={onFinish}
        className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
      >
        Terminer
      </button>
    </div>
  );
}
