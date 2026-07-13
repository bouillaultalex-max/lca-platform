import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ARTICLE_TYPE_LABELS,
  hasFullAccess,
  STOCK_MOVEMENT_TYPE_LABELS,
  type ArticleType,
  type StockItem,
  type StockLot,
  type StockMovement,
} from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';
import { Modal } from '../components/Modal';

const ARTICLE_TYPES: ArticleType[] = ['MATIERE_PREMIERE', 'PACKAGING', 'PRODUIT_FINI'];

function formatCartons(item: StockItem): string {
  if (!item.cartonEquivalent) return '—';
  const { fullCartons, remainderUnits } = item.cartonEquivalent;
  return remainderUnits > 0 ? `${fullCartons} carton(s) + ${remainderUnits} unité(s)` : `${fullCartons} carton(s)`;
}

function StockStatusBadge({ isLowStock }: { isLowStock: boolean | null }) {
  if (isLowStock === null) {
    return (
      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">Non suivi</span>
    );
  }
  return isLowStock ? (
    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">Stock faible</span>
  ) : (
    <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">Stock OK</span>
  );
}

const inputClass =
  'w-full rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

export function StockPage() {
  const { token, user } = useAuth();
  const canWrite = user ? hasFullAccess(user.role) : false;

  const [items, setItems] = useState<StockItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<ArticleType | ''>('');
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const [lots, setLots] = useState<StockLot[]>([]);
  const [isLoadingLots, setIsLoadingLots] = useState(false);

  const [expandedLotId, setExpandedLotId] = useState<string | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoadingMovements, setIsLoadingMovements] = useState(false);

  const [thresholdInput, setThresholdInput] = useState('');
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [adjustLot, setAdjustLot] = useState<StockLot | null>(null);

  const loadItems = useCallback(async () => {
    if (!token) return;
    setIsLoadingItems(true);
    setLoadError(null);
    try {
      setItems(await api.listStockItems(token));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger le stock.');
    } finally {
      setIsLoadingItems(false);
    }
  }, [token]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesType = !filterType || item.article.type === filterType;
      const matchesSearch =
        !searchLower ||
        item.article.name.toLowerCase().includes(searchLower) ||
        item.article.openSiReference.toLowerCase().includes(searchLower);
      return matchesType && matchesSearch;
    });
  }, [items, search, filterType]);

  const selectedItem = items.find((item) => item.articleId === selectedArticleId) ?? null;

  const loadLots = useCallback(
    async (articleId: string) => {
      if (!token) return;
      setIsLoadingLots(true);
      setExpandedLotId(null);
      try {
        setLots(await api.listStockLotsByArticle(token, articleId));
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les lots.');
      } finally {
        setIsLoadingLots(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (selectedArticleId) {
      void loadLots(selectedArticleId);
    } else {
      setLots([]);
    }
  }, [selectedArticleId, loadLots]);

  useEffect(() => {
    setThresholdInput(selectedItem?.minimumThreshold ?? '');
    setThresholdError(null);
  }, [selectedItem?.articleId, selectedItem?.minimumThreshold]);

  async function handleSaveThreshold() {
    if (!token || !selectedItem) return;
    setThresholdError(null);
    try {
      await api.updateMinimumThreshold(token, selectedItem.articleId, { minimumThreshold: Number(thresholdInput) });
      await loadItems();
    } catch (err) {
      setThresholdError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer le seuil.');
    }
  }

  async function toggleHistory(lot: StockLot) {
    if (expandedLotId === lot.id) {
      setExpandedLotId(null);
      return;
    }
    setExpandedLotId(lot.id);
    if (!token) return;
    setIsLoadingMovements(true);
    try {
      setMovements(await api.listStockMovementsByLot(token, lot.id));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger l’historique.');
    } finally {
      setIsLoadingMovements(false);
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Stock</h2>
      <p className="mt-1 text-sm text-gray-500">
        Stock disponible par article, en unités. L’équivalent en cartons est un calcul d’affichage.
      </p>

      {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Colonne gauche : liste des articles */}
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              placeholder="Rechercher (désignation, référence)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} max-w-xs`}
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as ArticleType | '')}
              className={`${inputClass} w-auto`}
            >
              <option value="">Tous types</option>
              {ARTICLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ARTICLE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
            {isLoadingItems ? (
              <p className="p-4 text-sm text-gray-500">Chargement…</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Article</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Stock</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Cartons</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                        Aucun article.
                      </td>
                    </tr>
                  )}
                  {filteredItems.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedArticleId(item.articleId)}
                      className={`cursor-pointer transition-colors odd:bg-white even:bg-gray-50/60 ${
                        item.articleId === selectedArticleId ? 'bg-brand/10' : 'hover:bg-brand-bg'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{item.article.name}</div>
                        <div className="text-xs text-gray-500">
                          {ARTICLE_TYPE_LABELS[item.article.type]} · {item.article.openSiReference}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {item.availableQuantity} {item.article.unitOfMeasure}
                      </td>
                      <td className="px-3 py-2">{formatCartons(item)}</td>
                      <td className="px-3 py-2">
                        <StockStatusBadge isLowStock={item.isLowStock} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Colonne droite : détail de l'article sélectionné */}
        <div>
          {!selectedItem ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-brand-border p-8 text-sm text-gray-500">
              Sélectionnez un article pour voir le détail de son stock.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand-border bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900">{selectedItem.article.name}</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Stock disponible :{' '}
                  <span className="font-medium">
                    {selectedItem.availableQuantity} {selectedItem.article.unitOfMeasure}
                  </span>
                </p>
                <p className="text-sm text-gray-600">Équivalent cartons : {formatCartons(selectedItem)}</p>

                {canWrite ? (
                  <>
                    <div className="mt-3 flex items-end gap-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-gray-500">Seuil minimum</label>
                        <input
                          type="number"
                          min="0"
                          value={thresholdInput}
                          onChange={(e) => setThresholdInput(e.target.value)}
                          className={`${inputClass} w-32`}
                        />
                      </div>
                      <button
                        onClick={() => void handleSaveThreshold()}
                        className="rounded-md border border-brand-border px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
                      >
                        Enregistrer
                      </button>
                    </div>
                    {thresholdError && <p className="mt-2 text-sm text-red-600">{thresholdError}</p>}

                    <button
                      onClick={() => setReceiveModalOpen(true)}
                      className="mt-4 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                    >
                      Réceptionner un lot
                    </button>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">
                    Seuil minimum : {selectedItem.minimumThreshold ?? 'non défini'}
                  </p>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
                <h4 className="border-b border-brand-border px-4 py-2 text-sm font-semibold text-gray-900">
                  Lots (ordre FIFO — le plus ancien en premier)
                </h4>
                {isLoadingLots ? (
                  <p className="p-4 text-sm text-gray-500">Chargement…</p>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">N° lot</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Reçu le</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Reçu</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Restant</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lots.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                            Aucun lot reçu pour cet article.
                          </td>
                        </tr>
                      )}
                      {lots.map((lot) => (
                        <Fragment key={lot.id}>
                          <tr className="transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-brand-bg">
                            <td className="px-3 py-2 font-mono text-xs">{lot.supplierLotNumber}</td>
                            <td className="px-3 py-2">{lot.receivedAt.slice(0, 10)}</td>
                            <td className="px-3 py-2">{lot.receivedQuantity}</td>
                            <td className="px-3 py-2">{lot.remainingQuantity}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-right">
                              {canWrite && (
                                <button
                                  onClick={() => setAdjustLot(lot)}
                                  className="mr-3 text-xs text-brand hover:underline"
                                >
                                  Ajuster
                                </button>
                              )}
                              <button onClick={() => void toggleHistory(lot)} className="text-xs text-gray-600 hover:underline">
                                {expandedLotId === lot.id ? 'Masquer' : 'Historique'}
                              </button>
                            </td>
                          </tr>
                          {expandedLotId === lot.id && (
                            <tr>
                              <td colSpan={5} className="bg-gray-50 px-3 py-2">
                                {isLoadingMovements ? (
                                  <p className="text-xs text-gray-500">Chargement…</p>
                                ) : movements.length === 0 ? (
                                  <p className="text-xs text-gray-500">Aucun mouvement.</p>
                                ) : (
                                  <ul className="space-y-1 text-xs text-gray-700">
                                    {movements.map((movement) => (
                                      <li key={movement.id}>
                                        {movement.movementDate.slice(0, 10)} — {STOCK_MOVEMENT_TYPE_LABELS[movement.type]} :{' '}
                                        <span className="font-medium">{movement.quantity}</span>
                                        {movement.comment ? ` — ${movement.comment}` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {receiveModalOpen && selectedItem && (
        <ReceiveStockLotModal
          articleId={selectedItem.articleId}
          unitOfMeasure={selectedItem.article.unitOfMeasure}
          onClose={() => setReceiveModalOpen(false)}
          onSuccess={async () => {
            setReceiveModalOpen(false);
            await loadItems();
            await loadLots(selectedItem.articleId);
          }}
        />
      )}

      {adjustLot && (
        <AdjustStockLotModal
          lot={adjustLot}
          onClose={() => setAdjustLot(null)}
          onSuccess={async () => {
            setAdjustLot(null);
            await loadItems();
            if (selectedItem) await loadLots(selectedItem.articleId);
          }}
        />
      )}
    </AppLayout>
  );
}

function ReceiveStockLotModal({
  articleId,
  unitOfMeasure,
  onClose,
  onSuccess,
}: {
  articleId: string;
  unitOfMeasure: string;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [supplierLotNumber, setSupplierLotNumber] = useState('');
  const [receivedQuantity, setReceivedQuantity] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.receiveStockLot(token, {
        articleId,
        supplierLotNumber,
        receivedQuantity: Number(receivedQuantity),
        receivedAt,
        expiryDate: expiryDate || undefined,
        comment: comment || undefined,
      });
      await onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de réceptionner ce lot.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Réceptionner un lot" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">N° de lot fournisseur</label>
          <input required value={supplierLotNumber} onChange={(e) => setSupplierLotNumber(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Quantité reçue ({unitOfMeasure})</label>
          <input
            required
            type="number"
            min="0"
            step="0.0001"
            value={receivedQuantity}
            onChange={(e) => setReceivedQuantity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Date de réception</label>
          <input required type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Date de péremption (optionnel)</label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Commentaire (optionnel)</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Réception…' : 'Réceptionner'}
        </button>
      </form>
    </Modal>
  );
}

function AdjustStockLotModal({
  lot,
  onClose,
  onSuccess,
}: {
  lot: StockLot;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [countedQuantity, setCountedQuantity] = useState(lot.remainingQuantity);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const delta = Number(countedQuantity) - Number(lot.remainingQuantity);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.adjustStockLot(token, lot.id, {
        countedQuantity: Number(countedQuantity),
        comment: comment || undefined,
      });
      await onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer cet ajustement.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Ajuster l'inventaire — lot ${lot.supplierLotNumber}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-gray-600">Quantité actuellement enregistrée : {lot.remainingQuantity}</p>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Quantité physiquement constatée</label>
          <input
            required
            type="number"
            min="0"
            step="0.0001"
            value={countedQuantity}
            onChange={(e) => setCountedQuantity(e.target.value)}
            className={inputClass}
          />
        </div>
        {!Number.isNaN(delta) && countedQuantity !== '' && (
          <p className={`text-sm ${delta === 0 ? 'text-gray-500' : delta > 0 ? 'text-green-700' : 'text-amber-700'}`}>
            Écart : {delta > 0 ? '+' : ''}
            {delta}
          </p>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Commentaire (optionnel)</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : "Enregistrer l'ajustement"}
        </button>
      </form>
    </Modal>
  );
}
