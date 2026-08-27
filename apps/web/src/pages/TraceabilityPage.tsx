import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ARTICLE_TYPE_LABELS,
  BATCH_STATUS_LABELS,
  LOT_QUALITY_STATUS_LABELS,
  type LotTraceability,
  type StockLotTraceability,
} from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';

const inputClass =
  'w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
}

type SearchMode = 'number' | 'uuid';

export function TraceabilityPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // La recherche par numéro de lot est le mode normal d'utilisation (voir TRAC-03A) ;
  // le mode par identifiant technique (UUID) reste disponible mais n'est plus mis en
  // avant — utile en transition, ou si le numéro de lot n'est pas connu.
  const [searchMode, setSearchMode] = useState<SearchMode>('number');
  const [searchValue, setSearchValue] = useState('');
  // Toujours une liste, y compris pour la recherche par identifiant technique
  // (un seul résultat, enveloppé) — ADR 0010 § Décision 15 : une recherche par
  // numéro de lot peut désormais retourner plusieurs Lots (allocations distinctes
  // d'un même batch partageant le même numéro). `null` tant qu'aucune recherche
  // n'a encore abouti ; `[]` est un résultat valide ("aucun lot trouvé").
  const [lots, setLots] = useState<LotTraceability[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Traçabilité inverse d'un lot fournisseur (StockLot) — voir TRAC-02. Un seul
  // développé à la fois, même principe que l'historique par lot de /stock.
  const [expandedStockLotId, setExpandedStockLotId] = useState<string | null>(null);
  const [stockLotTraceability, setStockLotTraceability] = useState<StockLotTraceability | null>(null);
  const [isLoadingStockLotTraceability, setIsLoadingStockLotTraceability] = useState(false);
  const [stockLotTraceabilityError, setStockLotTraceabilityError] = useState<string | null>(null);

  // Une recherche automatique (arrivée via ?lotNumber=, TRAC-03B) et une recherche
  // manuelle peuvent se chevaucher (l'utilisateur relance une recherche avant que la
  // première ait répondu). On ne garde que le résultat de la dernière recherche
  // lancée, quel que soit l'ordre de réponse du réseau.
  const latestRequestIdRef = useRef(0);

  async function runSearch(mode: SearchMode, value: string) {
    if (!token || !value.trim()) return;
    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setSearchError(null);
    setLots(null);
    setExpandedStockLotId(null);
    try {
      // Recherche par numéro : le backend renvoie déjà une liste (ADR 0010 §
      // Décision 15). Recherche par identifiant technique (UUID) : contrat
      // inchangé, un seul Lot — enveloppé ici pour un affichage unifié.
      const result =
        mode === 'number'
          ? await api.getLotTraceabilityByNumber(token, value.trim())
          : [await api.getLotTraceability(token, value.trim())];
      if (requestId !== latestRequestIdRef.current) return;
      setLots(result);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return;
      setSearchError(err instanceof ApiError ? err.message : 'Impossible de charger ce lot.');
    } finally {
      if (requestId === latestRequestIdRef.current) setIsLoading(false);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch(searchMode, searchValue);
  }

  function switchSearchMode(mode: SearchMode) {
    setSearchMode(mode);
    setSearchValue('');
    setSearchError(null);
  }

  // Arrivée depuis un autre écran avec un numéro de lot déjà connu (voir TRAC-03B,
  // ProductionPage) : recherche déclenchée immédiatement, sans ressaisie. Le paramètre
  // n'est utilisé qu'une fois — une recherche suivante ne doit pas re-déclencher celle-ci.
  useEffect(() => {
    const lotNumberFromLink = searchParams.get('lotNumber');
    if (!lotNumberFromLink || !token) return;
    setSearchMode('number');
    setSearchValue(lotNumberFromLink);
    void runSearch('number', lotNumberFromLink);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('lotNumber');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleStockLotTraceability(stockLotId: string) {
    if (expandedStockLotId === stockLotId) {
      setExpandedStockLotId(null);
      return;
    }
    setExpandedStockLotId(stockLotId);
    setStockLotTraceability(null);
    setStockLotTraceabilityError(null);
    if (!token) return;
    setIsLoadingStockLotTraceability(true);
    try {
      setStockLotTraceability(await api.getStockLotTraceability(token, stockLotId));
    } catch (err) {
      setStockLotTraceabilityError(
        err instanceof ApiError ? err.message : 'Impossible de charger les lots consommateurs.',
      );
    } finally {
      setIsLoadingStockLotTraceability(false);
    }
  }

  return (
    <AppLayout>
      <PageHeader
        title="Traçabilité"
        description="Consultation de la généalogie des lots (matières et packaging consommés) et de la traçabilité amont des lots de réception."
      />

      <div className="mt-6">
        <SectionCard title="Rechercher un lot de production">
          <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[240px]">
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                {searchMode === 'number' ? 'Numéro de lot' : 'Identifiant technique (UUID)'}
              </label>
              <input
                required
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={searchMode === 'number' ? 'Ex : 455123' : 'Ex : 7fa2383e-a12c-42e5-a42c-6d36a3bd941c'}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Recherche…' : 'Rechercher'}
            </button>
          </form>
          {searchError && <p className="mt-3 text-sm text-red-600">{searchError}</p>}
          <p className="mt-3 text-xs text-gray-400">
            {searchMode === 'number' ? (
              <>
                Seulement l'identifiant technique du lot ?{' '}
                <button
                  type="button"
                  onClick={() => switchSearchMode('uuid')}
                  className="text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                >
                  Rechercher par identifiant technique (UUID)
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => switchSearchMode('number')}
                className="text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              >
                ← Revenir à la recherche par numéro de lot
              </button>
            )}
          </p>
        </SectionCard>
      </div>

      {lots && lots.length === 0 && (
        <div className="mt-6">
          <SectionCard title="Résultat de la recherche">
            <p className="text-sm text-gray-500">Aucun lot trouvé pour ce numéro.</p>
          </SectionCard>
        </div>
      )}

      {lots && lots.length > 0 && (
        <div className="mt-6 space-y-6">
          {lots.length > 1 && (
            <p className="text-sm text-gray-600">
              {lots.length} lots partagent ce numéro (allocations distinctes d'un même batch).
            </p>
          )}
          {lots.map((lot) => (
            <div key={lot.id} className="space-y-6">
              <SectionCard title="Informations du lot">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Numéro de lot</dt>
                    <dd className="mt-1 text-sm text-gray-900">{lot.lotNumber}</dd>
                  </div>
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
              </SectionCard>

              <SectionCard title="Matières et composants consommés">
                <div className="overflow-x-auto rounded-xl border border-divider">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Article</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Quantité consommée</th>
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
                      {lot.genealogyLines.map((line) => {
                        const isExpanded = expandedStockLotId === line.consumedStockLot.id;
                        const panelId = `stock-lot-traceability-${line.consumedStockLot.id}`;
                        return (
                          <Fragment key={line.id}>
                            <tr className="transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-surface-muted">
                              <td className="px-3 py-2">
                                <div className="font-mono text-xs text-gray-500">{line.consumedArticle.openSiReference}</div>
                                <div className="text-gray-900">{line.consumedArticle.name}</div>
                              </td>
                              <td className="px-3 py-2">{ARTICLE_TYPE_LABELS[line.consumedArticle.type]}</td>
                              <td className="px-3 py-2 text-right">
                                {line.consumedQuantity} {line.consumedArticle.unitOfMeasure}
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-mono text-xs">{line.consumedStockLot.supplierLotNumber}</div>
                                <button
                                  type="button"
                                  onClick={() => void toggleStockLotTraceability(line.consumedStockLot.id)}
                                  aria-expanded={isExpanded}
                                  aria-controls={panelId}
                                  className="mt-0.5 text-xs text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                                >
                                  {isExpanded ? 'Masquer' : 'Lots consommateurs'}
                                </button>
                              </td>
                              <td className="px-3 py-2">{formatDate(line.consumedStockLot.expiryDate)}</td>
                            </tr>
                            {isExpanded && (
                              <tr id={panelId}>
                                <td colSpan={5} className="bg-gray-50 px-3 py-3">
                                  <p className="mb-2 text-xs font-semibold text-gray-700">
                                    Lots de production ayant consommé le lot fournisseur{' '}
                                    <span className="font-mono">{line.consumedStockLot.supplierLotNumber}</span>
                                  </p>
                                  {isLoadingStockLotTraceability ? (
                                    <p className="text-xs text-gray-500">Chargement…</p>
                                  ) : stockLotTraceabilityError ? (
                                    <p className="text-xs text-red-600">{stockLotTraceabilityError}</p>
                                  ) : !stockLotTraceability || stockLotTraceability.genealogyLines.length === 0 ? (
                                    <p className="text-xs text-gray-500">
                                      Aucun lot de production n'a consommé ce lot fournisseur.
                                    </p>
                                  ) : (
                                    <div className="overflow-x-auto rounded-lg border border-divider bg-white">
                                      <table className="min-w-full divide-y divide-gray-200 text-xs">
                                        <thead className="bg-gray-100">
                                          <tr>
                                            <th className="px-3 py-1.5 text-left font-medium text-gray-500">Numéro de lot</th>
                                            <th className="px-3 py-1.5 text-left font-medium text-gray-500">Produit fini</th>
                                            <th className="px-3 py-1.5 text-left font-medium text-gray-500">Recette</th>
                                            <th className="px-3 py-1.5 text-right font-medium text-gray-500">
                                              Quantité produite
                                            </th>
                                            <th className="px-3 py-1.5 text-left font-medium text-gray-500">
                                              Date de fabrication
                                            </th>
                                            <th className="px-3 py-1.5 text-left font-medium text-gray-500">Statut qualité</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {stockLotTraceability.genealogyLines.map((consumerLine) => (
                                            <tr key={consumerLine.id}>
                                              <td className="px-3 py-1.5 font-mono">{consumerLine.lot.lotNumber}</td>
                                              <td className="px-3 py-1.5">
                                                {consumerLine.lot.batch.recipe.finishedProduct.name}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                Version {consumerLine.lot.batch.recipe.version} — Format{' '}
                                                {consumerLine.lot.batch.recipe.format} ml
                                              </td>
                                              <td className="px-3 py-1.5 text-right">{consumerLine.lot.quantity}</td>
                                              <td className="px-3 py-1.5">{formatDate(consumerLine.lot.manufacturedAt)}</td>
                                              <td className="px-3 py-1.5">
                                                {LOT_QUALITY_STATUS_LABELS[consumerLine.lot.qualityStatus]}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
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
              </SectionCard>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
