import { Fragment } from 'react';
import type { AromaSampleDetailResponse, AromaSampleListItem, AromaSampleSortBy, AromaSampleSortOrder } from '@lca-mes/shared';

const cellClass = 'px-3 py-2';

/** Colonnes triables — exactement les 4 champs supportés par `GET /rnd/aroma-samples` (voir AromaSampleSortBy côté API). Ne jamais en ajouter une non supportée : le tri serait silencieusement ignoré par le backend. */
const SORTABLE_COLUMNS: { key: AromaSampleSortBy; label: string }[] = [
  { key: 'productName', label: 'Produit' },
  { key: 'supplierNameRaw', label: 'Fournisseur' },
  { key: 'addedAt', label: "Date d'ajout" },
  { key: 'createdAt', label: 'Créé le' },
];

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
}

function formatNumber(value: number | null, unit: string): string {
  return value === null ? '—' : `${value} ${unit}`;
}

export function AromaSamplesTable({
  items,
  sortBy,
  sortOrder,
  onSortChange,
  expandedId,
  onToggleExpand,
  detail,
  isLoadingDetail,
  detailError,
}: {
  items: AromaSampleListItem[];
  sortBy: AromaSampleSortBy;
  sortOrder: AromaSampleSortOrder;
  onSortChange: (column: AromaSampleSortBy) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  detail: AromaSampleDetailResponse | null;
  isLoadingDetail: boolean;
  detailError: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-divider">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className={cellClass} aria-hidden="true" />
            {SORTABLE_COLUMNS.map((column) => {
              const isActive = sortBy === column.key;
              const ariaSort = isActive ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none';
              return (
                <th key={column.key} className={`${cellClass} text-left font-medium text-gray-500`} aria-sort={ariaSort}>
                  <button
                    type="button"
                    onClick={() => onSortChange(column.key)}
                    className="inline-flex items-center gap-1 hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    {column.label}
                    {isActive && <span aria-hidden="true">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
              );
            })}
            <th className={`${cellClass} text-left font-medium text-gray-500`}>Référence fournisseur</th>
            <th className={`${cellClass} text-left font-medium text-gray-500`}>Catégorie</th>
            <th className={`${cellClass} text-right font-medium text-gray-500`}>Stock</th>
            <th className={`${cellClass} text-right font-medium text-gray-500`}>Prix/kg</th>
            <th className={`${cellClass} text-left font-medium text-gray-500`}>Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                Aucun échantillon ne correspond à ces critères.
              </td>
            </tr>
          )}
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            const panelId = `aroma-sample-detail-${item.id}`;
            return (
              <Fragment key={item.id}>
                <tr className="transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-surface-muted">
                  <td className={cellClass}>
                    <button
                      type="button"
                      onClick={() => onToggleExpand(item.id)}
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      className="text-xs text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      {isExpanded ? 'Masquer' : 'Détail'}
                    </button>
                  </td>
                  <td className={cellClass}>
                    <div className="font-medium text-gray-900">{item.productName}</div>
                    <div className="font-mono text-xs text-gray-500">{item.legacyId}</div>
                  </td>
                  <td className={cellClass}>{item.supplierNameRaw}</td>
                  <td className={cellClass}>{formatDate(item.addedAt)}</td>
                  <td className={cellClass}>{formatDate(item.createdAt)}</td>
                  <td className={cellClass}>{item.supplierReference ?? '—'}</td>
                  <td className={cellClass}>{item.category}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{formatNumber(item.stockGrams, 'g')}</td>
                  <td className={`${cellClass} text-right tabular-nums`}>
                    {item.pricePerKgEur === null ? '—' : `${item.pricePerKgEur.toFixed(2)} €`}
                  </td>
                  <td className={cellClass}>
                    <span
                      className={
                        item.active
                          ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                          : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                      }
                    >
                      {item.active ? 'Actif' : 'Désactivé'}
                    </span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr id={panelId}>
                    <td colSpan={9} className="bg-gray-50 px-3 py-3">
                      {isLoadingDetail ? (
                        <p className="text-xs text-gray-500">Chargement…</p>
                      ) : detailError ? (
                        <p className="text-xs text-red-600">{detailError}</p>
                      ) : !detail ? null : (
                        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                          <div>
                            <dt className="font-medium text-gray-500">Commentaire</dt>
                            <dd className="mt-0.5 text-gray-900">{detail.comment ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="font-medium text-gray-500">Note</dt>
                            <dd className="mt-0.5 text-gray-900">{detail.rating ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="font-medium text-gray-500">Dernière mise à jour</dt>
                            <dd className="mt-0.5 text-gray-900">{formatDate(detail.updatedAt)}</dd>
                          </div>
                          <div className="sm:col-span-3">
                            <dt className="font-medium text-gray-500">Origine</dt>
                            <dd className="mt-0.5 text-gray-900">
                              {detail.importLog
                                ? `Import du ${formatDate(detail.importLog.createdAt)} — ${
                                    detail.importLog.status === 'VALIDE'
                                      ? 'réussi'
                                      : detail.importLog.status === 'ERREUR'
                                        ? 'en échec'
                                        : 'prévisualisé'
                                  } (${detail.importLog.processedLines} ligne(s), ${detail.importLog.errorCount} erreur(s))`
                                : 'Aucun import associé.'}
                            </dd>
                          </div>
                        </dl>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
