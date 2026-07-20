import { useState, type FormEvent } from 'react';
import {
  ARTICLE_TYPE_LABELS,
  BATCH_STATUS_LABELS,
  LOT_QUALITY_STATUS_LABELS,
  type LotTraceability,
} from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

const inputClass =
  'w-full rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
}

export function TraceabilityPage() {
  const { token } = useAuth();

  const [lotId, setLotId] = useState('');
  const [lot, setLot] = useState<LotTraceability | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !lotId.trim()) return;
    setIsLoading(true);
    setSearchError(null);
    setLot(null);
    try {
      setLot(await api.getLotTraceability(token, lotId.trim()));
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'Impossible de charger ce lot.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Traçabilité</h2>
      <p className="mt-1 text-sm text-gray-500">
        Consultation de la généalogie des lots (matières et packaging consommés) et de la traçabilité amont des lots
        de réception.
      </p>

      <div className="mt-6 rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Rechercher un lot de production</h3>
        <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <label className="mb-1.5 block text-xs font-medium text-gray-500">
              Identifiant technique du lot (UUID)
            </label>
            <input
              required
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              placeholder="Ex : 7fa2383e-a12c-42e5-a42c-6d36a3bd941c"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400">
              Identifiant technique (UUID), pas le numéro de lot 455XXX. La recherche par numéro de lot fera l'objet
              d'une évolution séparée.
            </p>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'Recherche…' : 'Rechercher'}
          </button>
        </form>
        {searchError && <p className="mt-3 text-sm text-red-600">{searchError}</p>}
      </div>

      {lot && (
        <div className="mt-6 rounded-xl border border-brand-border bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">Lot {lot.lotNumber}</h3>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-gray-500">Statut qualité</dt>
              <dd className="mt-1 text-sm text-gray-900">{LOT_QUALITY_STATUS_LABELS[lot.qualityStatus]}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Date de fabrication</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDate(lot.manufacturedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Produit fini</dt>
              <dd className="mt-1 text-sm text-gray-900">{lot.batch.recipe.finishedProduct.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Recette</dt>
              <dd className="mt-1 text-sm text-gray-900">
                Version {lot.batch.recipe.version} — Format {lot.batch.recipe.format} ml
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Batch</dt>
              <dd className="mt-1 text-sm text-gray-900">{BATCH_STATUS_LABELS[lot.batch.status]}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Date de péremption</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDate(lot.expiryDate)}</dd>
            </div>
          </dl>
        </div>
      )}

      {lot && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
          <h4 className="border-b border-brand-border px-4 py-2 text-sm font-semibold text-gray-900">
            Matières et composants consommés
          </h4>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Article</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Quantité consommée</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Lot fournisseur</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Péremption fournisseur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lot.genealogyLines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                    Aucune matière première ni composant de packaging enregistré pour ce lot.
                  </td>
                </tr>
              )}
              {lot.genealogyLines.map((line) => (
                <tr key={line.id} className="transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-brand-bg">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-gray-500">{line.consumedArticle.openSiReference}</div>
                    <div className="text-gray-900">{line.consumedArticle.name}</div>
                  </td>
                  <td className="px-3 py-2">{ARTICLE_TYPE_LABELS[line.consumedArticle.type]}</td>
                  <td className="px-3 py-2">
                    {line.consumedQuantity} {line.consumedArticle.unitOfMeasure}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{line.consumedStockLot.supplierLotNumber}</td>
                  <td className="px-3 py-2">{formatDate(line.consumedStockLot.expiryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  );
}
