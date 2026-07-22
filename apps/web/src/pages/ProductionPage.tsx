import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  BATCH_STATUS_LABELS,
  BATCH_STEP_LABELS,
  BATCH_STEP_ORDER,
  type AddBatchProductAllocationRequest,
  type Article,
  type Batch,
  type BatchClosureResult,
  type BatchFeasibilityReport,
  type BatchProductAllocation,
  type BatchStatus,
  type BatchStop,
  type IngredientQuantity,
  type Machine,
  type MaterialQuantity,
  type Market,
  type PackagingQuantity,
  type Recipe,
} from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';
import { Modal } from '../components/Modal';
import {
  getEligibleMarketDeclinations,
  getEligibleStandaloneProducts,
  resolveAllocationMode,
} from '../utils/allocationEligibility';
import { validateAllocationClosureLines } from '../utils/allocationClosureValidation';
import { enrichClosureLots, resolveClosureLots, type EnrichedClosureLot } from '../utils/closureLots';

const inputClass =
  'w-full rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

const STATUS_FILTERS: Array<{ value: BatchStatus | ''; label: string }> = [
  { value: '', label: 'Tous statuts' },
  { value: 'PLANIFIE', label: BATCH_STATUS_LABELS.PLANIFIE },
  { value: 'EN_COURS', label: BATCH_STATUS_LABELS.EN_COURS },
  { value: 'TERMINE', label: BATCH_STATUS_LABELS.TERMINE },
  { value: 'ANNULE', label: BATCH_STATUS_LABELS.ANNULE },
];

function formatIngredient(ingredient: IngredientQuantity): string {
  if (ingredient.kind === 'MATIERE_PREMIERE') {
    const mass = ingredient.massKg === null ? '⚠ densité manquante' : `${ingredient.massKg.toFixed(2)} kg`;
    return `${ingredient.articleName} : ${ingredient.volumeL.toFixed(2)} L · ${mass}`;
  }
  return `${ingredient.articleName} : ${ingredient.quantity} ${ingredient.unit}`;
}

/**
 * Agrège les besoins packaging de plusieurs allocations par article (voir
 * BatchClosureService, même principe de sommation avant affichage/comparaison
 * qu'un article de packaging partagé entre allocations) — ordre déterministe
 * (ordre d'apparition, lui-même dérivé de l'ordre `createdAt` renvoyé par l'API).
 */
function aggregatePackagingByArticle(perAllocation: PackagingQuantity[][]): PackagingQuantity[] {
  const byArticle = new Map<string, PackagingQuantity>();
  for (const lines of perAllocation) {
    for (const line of lines) {
      const existing = byArticle.get(line.articleId);
      byArticle.set(
        line.articleId,
        existing ? { ...existing, quantity: existing.quantity + line.quantity } : line,
      );
    }
  }
  return Array.from(byArticle.values());
}

/**
 * Aperçu de préparation d'un batch (voir PRD-11, ADR 0006 §4.4bis) : la matière
 * première est calculée une seule fois sur la recette/quantité du batch (mélange
 * commun), jamais par allocation ; le packaging est calculé par allocation (sa
 * propre recette/quantité) puis agrégé par article. Pour un batch sans allocation
 * (historique) ou à une seule allocation (recette/quantité toujours identiques à
 * celles du batch, voir BatchProductAllocationsService.createInitialAllocation et
 * BatchesService.updatePlannedQuantity), un seul appel suffit et reproduit
 * exactement le comportement antérieur à PRD-11 — évite un appel réseau dupliqué.
 */
async function computeBatchPreparation(
  token: string,
  batch: Batch,
  allocations: BatchProductAllocation[],
): Promise<IngredientQuantity[]> {
  if (allocations.length <= 1) {
    return api.getBatchPreparation(token, batch.recipeId, batch.plannedQuantity);
  }

  const [materialLines, packagingLinesByAllocation] = await Promise.all([
    api
      .getBatchPreparation(token, batch.recipeId, batch.plannedQuantity)
      .then((lines) => lines.filter((line): line is MaterialQuantity => line.kind === 'MATIERE_PREMIERE')),
    Promise.all(
      allocations.map((allocation) =>
        api
          .getBatchPreparation(token, allocation.recipeId, allocation.plannedQuantity)
          .then((lines) => lines.filter((line): line is PackagingQuantity => line.kind === 'PACKAGING')),
      ),
    ),
  ]);

  return [...materialLines, ...aggregatePackagingByArticle(packagingLinesByAllocation)];
}

function PreparationPreview({
  ingredients,
  isLoading,
}: {
  ingredients: IngredientQuantity[];
  isLoading?: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-gray-500">Calcul en cours…</p>;
  }
  if (ingredients.length === 0) {
    return <p className="text-sm text-gray-500">Aucun ingrédient à afficher.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {ingredients.map((ingredient) => (
        <li
          key={ingredient.articleId}
          className={
            ingredient.kind === 'MATIERE_PREMIERE' && ingredient.massKg === null
              ? 'font-medium text-amber-700'
              : 'text-gray-700'
          }
        >
          {formatIngredient(ingredient)}
        </li>
      ))}
    </ul>
  );
}

function StepTracker({ status, currentStep }: { status: BatchStatus; currentStep: string | null }) {
  const currentIndex = currentStep ? BATCH_STEP_ORDER.indexOf(currentStep as (typeof BATCH_STEP_ORDER)[number]) : -1;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {BATCH_STEP_ORDER.map((step, index) => {
        const isDone = status === 'TERMINE' || currentIndex > index;
        const isCurrent = status !== 'TERMINE' && index === currentIndex;
        return (
          <Fragment key={step}>
            {index > 0 && <span className="text-gray-300">→</span>}
            <span
              className={
                isDone
                  ? 'rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700'
                  : isCurrent
                    ? 'rounded-full bg-brand/10 px-2.5 py-1 font-medium text-brand'
                    : 'rounded-full bg-gray-100 px-2.5 py-1 text-gray-500'
              }
            >
              {isDone ? '✓ ' : isCurrent ? '● ' : ''}
              {BATCH_STEP_LABELS[step]}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: BatchStatus }) {
  const classes: Record<BatchStatus, string> = {
    PLANIFIE: 'bg-gray-100 text-gray-600',
    EN_COURS: 'bg-brand/10 text-brand',
    TERMINE: 'bg-green-50 text-green-700',
    ANNULE: 'bg-red-50 text-red-700',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${classes[status]}`}>
      {BATCH_STATUS_LABELS[status]}
    </span>
  );
}

export function ProductionPage() {
  const { token } = useAuth();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BatchStatus | ''>('');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const [articles, setArticles] = useState<Article[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [recipesById, setRecipesById] = useState<Map<string, Recipe>>(new Map());

  const [preparation, setPreparation] = useState<IngredientQuantity[]>([]);
  const [isLoadingPreparation, setIsLoadingPreparation] = useState(false);

  const [stops, setStops] = useState<BatchStop[]>([]);
  const [isLoadingStops, setIsLoadingStops] = useState(false);

  // État centralisé des allocations (voir Ticket Frontend 3) : réutilisé par la
  // future clôture par allocation et le futur affichage multi-lots, jamais chargé
  // indépendamment par un sous-composant.
  const [allocations, setAllocations] = useState<BatchProductAllocation[]>([]);
  const [isLoadingAllocations, setIsLoadingAllocations] = useState(false);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [startStopModalOpen, setStartStopModalOpen] = useState(false);
  const [endStopTarget, setEndStopTarget] = useState<BatchStop | null>(null);
  const [addAllocationModalOpen, setAddAllocationModalOpen] = useState(false);

  const [closureBanner, setClosureBanner] = useState<{ batchId: string; lots: EnrichedClosureLot[] } | null>(null);
  const [launchBanner, setLaunchBanner] = useState<{ batchId: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Analyse de faisabilité (retour métier de Kevin) : non null tant que le modal de
  // détail (stocks insuffisants) doit rester affiché — voir handleAdvanceStep.
  const [feasibilityReport, setFeasibilityReport] = useState<BatchFeasibilityReport | null>(null);
  const [isCheckingFeasibility, setIsCheckingFeasibility] = useState(false);

  const articlesById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const machinesById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const marketsById = useMemo(() => new Map(markets.map((m) => [m.id, m])), [markets]);

  const loadBatches = useCallback(async () => {
    if (!token) return;
    setIsLoadingBatches(true);
    setLoadError(null);
    try {
      setBatches(await api.listBatches(token));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les batches.');
    } finally {
      setIsLoadingBatches(false);
    }
  }, [token]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    if (!token) return;
    api
      .listArticles(token)
      .then(setArticles)
      .catch(() => undefined);
    api
      .listMachines(token)
      .then(setMachines)
      .catch(() => undefined);
    api
      .listMarkets(token)
      .then(setMarkets)
      .catch(() => undefined);
  }, [token]);

  // Résout paresseusement le nom du produit/format pour chaque recette référencée par les batches.
  useEffect(() => {
    if (!token || batches.length === 0) return;
    const missing = Array.from(new Set(batches.map((b) => b.recipeId))).filter((id) => !recipesById.has(id));
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => api.getRecipe(token, id)))
      .then((fetched) => {
        setRecipesById((prev) => {
          const next = new Map(prev);
          fetched.forEach((recipe) => next.set(recipe.id, recipe));
          return next;
        });
      })
      .catch(() => undefined);
  }, [token, batches, recipesById]);

  const batchLabel = useCallback(
    (batch: Batch): string => {
      const recipe = recipesById.get(batch.recipeId);
      if (!recipe) return 'Chargement…';
      const product = articlesById.get(recipe.finishedProductId);
      return `${product?.name ?? 'Produit inconnu'} (${recipe.format} ml)`;
    },
    [recipesById, articlesById],
  );

  const filteredBatches = useMemo(
    () => (statusFilter ? batches.filter((b) => b.status === statusFilter) : batches),
    [batches, statusFilter],
  );

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;

  // Produit fini de la recette de référence du batch — détermine si le formulaire
  // d'ajout d'allocation propose un marché (famille commerciale) ou un produit direct.
  const referenceProduct = useMemo(() => {
    if (!selectedBatch) return null;
    const recipe = recipesById.get(selectedBatch.recipeId);
    if (!recipe) return null;
    return articlesById.get(recipe.finishedProductId) ?? null;
  }, [selectedBatch, recipesById, articlesById]);

  const loadAllocations = useCallback(
    async (batch: Batch) => {
      if (!token) return;
      setIsLoadingAllocations(true);
      setAllocationsError(null);
      try {
        const fetched = await api.listBatchAllocations(token, batch.id);
        setAllocations(fetched);
        setIsLoadingPreparation(true);
        try {
          setPreparation(await computeBatchPreparation(token, batch, fetched));
        } catch (err) {
          setActionError(err instanceof ApiError ? err.message : 'Impossible de calculer la préparation.');
        } finally {
          setIsLoadingPreparation(false);
        }
      } catch (err) {
        setAllocationsError(err instanceof ApiError ? err.message : 'Impossible de charger les allocations.');
      } finally {
        setIsLoadingAllocations(false);
      }
    },
    [token],
  );

  const loadStops = useCallback(
    async (batchId: string) => {
      if (!token) return;
      setIsLoadingStops(true);
      try {
        setStops(await api.listBatchStops(token, batchId));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Impossible de charger les arrêts.');
      } finally {
        setIsLoadingStops(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!selectedBatch || !token) {
      setPreparation([]);
      setStops([]);
      setAllocations([]);
      setAllocationsError(null);
      return;
    }
    setActionError(null);
    void loadStops(selectedBatch.id);
    void loadAllocations(selectedBatch);
    // Redéclenché aussi par plannedQuantity : l'ajout d'une allocation (ou l'ajustement
    // automatique de quantité en cas de faisabilité insuffisante) l'incrémente sans
    // changer l'id du batch, et doit pourtant recalculer la préparation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatch?.id, selectedBatch?.plannedQuantity, token]);

  /**
   * Le tout premier passage (statut PLANIFIE, "Démarrer la production") déclenche
   * d'abord une analyse de faisabilité (retour métier de Kevin) : recalcule les besoins
   * réels de la recette pour la quantité planifiée et les compare aux stocks
   * disponibles. Si les stocks sont insuffisants, le lancement est bloqué et un modal de
   * détail s'affiche (voir BatchFeasibilityModal) ; sinon le lancement se poursuit
   * immédiatement, sans étape de confirmation supplémentaire. Les étapes suivantes
   * (déjà EN_COURS) ne repassent jamais par ce contrôle : elles ne consomment aucun
   * stock supplémentaire dans ce modèle. Le serveur revérifie de toute façon la
   * faisabilité de manière indépendante au moment du lancement réel (voir
   * BatchStepsService.advance côté backend) — ce contrôle frontend n'est qu'un aperçu.
   */
  async function handleAdvanceStep() {
    if (!token || !selectedBatch) return;
    setActionError(null);

    const isLaunch = selectedBatch.status === 'PLANIFIE';
    if (isLaunch) {
      setIsCheckingFeasibility(true);
      try {
        const report = await api.getBatchFeasibility(token, selectedBatch.id);
        if (!report.isFeasible) {
          setFeasibilityReport(report);
          return;
        }
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Impossible de vérifier la faisabilité du lancement.');
        return;
      } finally {
        setIsCheckingFeasibility(false);
      }
    }

    try {
      await api.advanceBatchStep(token, selectedBatch.id);
      await loadBatches();
      if (isLaunch) {
        setLaunchBanner({
          batchId: selectedBatch.id,
          message: 'Tous les composants nécessaires sont disponibles — le batch peut être lancé.',
        });
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Impossible de faire progresser le batch.');
    }
  }

  const openStop = stops.find((s) => s.endedAt === null) ?? null;

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Production</h2>
      <p className="mt-1 text-sm text-gray-500">
        Création de batch, suivi des étapes de production, gestion des arrêts et clôture.
      </p>

      {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Colonne gauche : liste des batches */}
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as BatchStatus | '')}
              className={`${inputClass} w-auto`}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              + Créer un batch
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
            {isLoadingBatches ? (
              <p className="p-4 text-sm text-gray-500">Chargement…</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Recette</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Statut</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Étape</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBatches.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                        Aucun batch.
                      </td>
                    </tr>
                  )}
                  {filteredBatches.map((batch) => (
                    <tr
                      key={batch.id}
                      onClick={() => {
                        setSelectedBatchId(batch.id);
                        setClosureBanner(null);
                        setLaunchBanner(null);
                        setFeasibilityReport(null);
                      }}
                      className={`cursor-pointer transition-colors odd:bg-white even:bg-gray-50/60 ${batch.id === selectedBatchId ? 'bg-brand/10' : 'hover:bg-brand-bg'}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{batchLabel(batch)}</div>
                        <div className="text-xs text-gray-500">Quantité prévue : {batch.plannedQuantity}</div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={batch.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {batch.status === 'EN_COURS' && batch.currentStep ? BATCH_STEP_LABELS[batch.currentStep] : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Colonne droite : détail du batch sélectionné */}
        <div>
          {!selectedBatch ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-brand-border p-8 text-sm text-gray-500">
              Sélectionnez un batch pour voir son détail.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand-border bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">{batchLabel(selectedBatch)}</h3>
                  <StatusBadge status={selectedBatch.status} />
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  Machine : {machinesById.get(selectedBatch.machineId)?.name ?? selectedBatch.machineId} · Quantité
                  prévue : {selectedBatch.plannedQuantity}
                </p>
                {selectedBatch.status === 'TERMINE' && (
                  <p className="mt-1 text-sm text-gray-600">
                    Conforme : {selectedBatch.producedQuantity} · Rebuts : {selectedBatch.rejectedQuantity}
                  </p>
                )}

                {closureBanner && closureBanner.batchId === selectedBatch.id && (
                  <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                    {closureBanner.lots.length === 1 ? (
                      <p>
                        Lot créé : {closureBanner.lots[0].lotNumber}{' '}
                        <Link
                          to={`/traceability?lotNumber=${encodeURIComponent(closureBanner.lots[0].lotNumber)}`}
                          className="underline hover:text-green-900"
                        >
                          Voir sa traçabilité
                        </Link>
                      </p>
                    ) : (
                      <>
                        <p>{closureBanner.lots.length} lots créés</p>
                        <ul className="mt-1.5 space-y-1 font-normal">
                          {closureBanner.lots.map((lot) => (
                            <li key={lot.lotNumber}>
                              {lot.lotNumber}
                              {lot.productName && ` — ${lot.productName}`}
                              {lot.marketLabel && ` (${lot.marketLabel})`}
                              {' · Quantité : '}
                              {lot.quantity}{' '}
                              <Link
                                to={`/traceability?lotNumber=${encodeURIComponent(lot.lotNumber)}`}
                                className="underline hover:text-green-900"
                              >
                                Voir sa traçabilité
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
                {launchBanner && launchBanner.batchId === selectedBatch.id && (
                  <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                    {launchBanner.message}
                  </p>
                )}
              </div>

              {/*
                Un batch avec allocations.length === 0 est traité côté frontend comme un
                batch historique mono-marché (antérieur à PRD-11) : le backend ne pose
                aucune garde explicite empêchant d'ajouter une allocation à un tel batch,
                alors que tout batch créé depuis PRD-11 possède déjà au moins une
                allocation par construction (voir BatchesService.create). Cette condition
                n'est donc pas un simple choix d'affichage : elle est ce qui empêche de
                faire glisser un batch historique dans le nouveau modèle multi-allocation.
                Affichée aussi pendant le chargement ou en cas d'erreur, pour ne jamais
                masquer silencieusement un échec de chargement derrière la même condition.
              */}
              {(allocations.length > 0 || isLoadingAllocations || allocationsError) && (
                <AllocationsSection
                  allocations={allocations}
                  isLoading={isLoadingAllocations}
                  error={allocationsError}
                  articlesById={articlesById}
                  marketsById={marketsById}
                  canAddAllocation={
                    allocations.length > 0 &&
                    (selectedBatch.status === 'PLANIFIE' ||
                      (selectedBatch.status === 'EN_COURS' && selectedBatch.currentStep !== 'CONDITIONNEMENT'))
                  }
                  onAddClick={() => setAddAllocationModalOpen(true)}
                />
              )}

              <div className="rounded-xl border border-brand-border bg-white p-4 shadow-sm">
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Préparation (aperçu)</h4>
                <PreparationPreview ingredients={preparation} isLoading={isLoadingPreparation} />
              </div>

              <div className="rounded-xl border border-brand-border bg-white p-4 shadow-sm">
                <h4 className="mb-3 text-sm font-semibold text-gray-900">Étapes de production</h4>
                <StepTracker status={selectedBatch.status} currentStep={selectedBatch.currentStep} />

                {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}

                {(selectedBatch.status === 'PLANIFIE' ||
                  (selectedBatch.status === 'EN_COURS' && selectedBatch.currentStep !== 'CONDITIONNEMENT')) && (
                  <button
                    onClick={() => void handleAdvanceStep()}
                    disabled={isCheckingFeasibility}
                    className="mt-3 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCheckingFeasibility
                      ? 'Vérification des stocks…'
                      : selectedBatch.status === 'PLANIFIE'
                        ? 'Démarrer la production'
                        : 'Passer à l’étape suivante'}
                  </button>
                )}
              </div>

              {selectedBatch.status === 'EN_COURS' && (
                <div className="rounded-xl border border-brand-border bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-900">Arrêts</h4>
                    {!openStop && (
                      <button
                        onClick={() => setStartStopModalOpen(true)}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        Signaler un arrêt
                      </button>
                    )}
                  </div>
                  {isLoadingStops ? (
                    <p className="text-sm text-gray-500">Chargement…</p>
                  ) : stops.length === 0 ? (
                    <p className="text-sm text-gray-500">Aucun arrêt.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {stops.map((stop) => (
                        <li
                          key={stop.id}
                          className={`flex items-center justify-between ${stop.endedAt === null ? 'font-medium text-amber-700' : 'text-gray-700'}`}
                        >
                          <span>
                            {stop.reason} — {new Date(stop.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            {stop.endedAt
                              ? ` – ${new Date(stop.endedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (${stop.durationMinutes} min)`
                              : ' – en cours'}
                          </span>
                          {stop.endedAt === null && (
                            <button
                              onClick={() => setEndStopTarget(stop)}
                              className="text-xs text-brand hover:underline"
                            >
                              Clôturer l’arrêt
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selectedBatch.status === 'EN_COURS' && selectedBatch.currentStep === 'CONDITIONNEMENT' && (
                <CloseBatchSection
                  key={selectedBatch.id}
                  batch={selectedBatch}
                  blocked={openStop !== null}
                  allocations={allocations}
                  articlesById={articlesById}
                  marketsById={marketsById}
                  onSuccess={async (result) => {
                    const lots = resolveClosureLots(result);
                    setClosureBanner({
                      batchId: selectedBatch.id,
                      lots: enrichClosureLots(lots, allocations, articlesById, marketsById),
                    });
                    await loadBatches();
                    await loadAllocations(selectedBatch);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {createModalOpen && (
        <CreateBatchModal
          articles={articles}
          machines={machines}
          onClose={() => setCreateModalOpen(false)}
          onSuccess={async (batch) => {
            setCreateModalOpen(false);
            await loadBatches();
            setSelectedBatchId(batch.id);
          }}
        />
      )}

      {startStopModalOpen && selectedBatch && (
        <StartStopModal
          batchId={selectedBatch.id}
          onClose={() => setStartStopModalOpen(false)}
          onSuccess={async () => {
            setStartStopModalOpen(false);
            await loadStops(selectedBatch.id);
          }}
        />
      )}

      {endStopTarget && selectedBatch && (
        <EndStopModal
          stop={endStopTarget}
          onClose={() => setEndStopTarget(null)}
          onSuccess={async () => {
            setEndStopTarget(null);
            await loadStops(selectedBatch.id);
          }}
        />
      )}

      {feasibilityReport && selectedBatch && (
        <BatchFeasibilityModal
          batch={selectedBatch}
          report={feasibilityReport}
          onClose={() => setFeasibilityReport(null)}
          onQuantityAdjusted={async (message) => {
            setFeasibilityReport(null);
            await loadBatches();
            setLaunchBanner({ batchId: selectedBatch.id, message });
          }}
          onReturnToPlanning={() => {
            setFeasibilityReport(null);
            setSelectedBatchId(null);
          }}
        />
      )}

      {addAllocationModalOpen && selectedBatch && (
        <AddAllocationModal
          batch={selectedBatch}
          referenceProduct={referenceProduct}
          articles={articles}
          allocations={allocations}
          onClose={() => setAddAllocationModalOpen(false)}
          onSuccess={async () => {
            setAddAllocationModalOpen(false);
            await loadBatches();
          }}
        />
      )}
    </AppLayout>
  );
}

function CreateBatchModal({
  articles,
  machines,
  onClose,
  onSuccess,
}: {
  articles: Article[];
  machines: Machine[];
  onClose: () => void;
  onSuccess: (batch: Batch) => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [productId, setProductId] = useState('');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [plannedQuantity, setPlannedQuantity] = useState('');
  const [preview, setPreview] = useState<IngredientQuantity[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const products = useMemo(() => articles.filter((a) => a.type === 'PRODUIT_FINI' && a.active), [articles]);
  const activeRecipes = useMemo(() => recipes.filter((r) => r.status === 'ACTIVE'), [recipes]);
  const selectedRecipe = activeRecipes.find((r) => r.id === recipeId) ?? null;
  const compatibleMachines = useMemo(
    () => machines.filter((m) => m.active && (!selectedRecipe || m.supportedFormats.includes(selectedRecipe.format))),
    [machines, selectedRecipe],
  );

  useEffect(() => {
    if (!token || !productId) {
      setRecipes([]);
      return;
    }
    api
      .listRecipesByProduct(token, productId)
      .then(setRecipes)
      .catch(() => undefined);
  }, [token, productId]);

  useEffect(() => {
    const quantity = Number(plannedQuantity);
    if (!token || !recipeId || !quantity || quantity <= 0) {
      setPreview([]);
      return;
    }
    setIsLoadingPreview(true);
    api
      .getBatchPreparation(token, recipeId, quantity)
      .then(setPreview)
      .catch(() => setPreview([]))
      .finally(() => setIsLoadingPreview(false));
  }, [token, recipeId, plannedQuantity]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const batch = await api.createBatch(token, {
        recipeId,
        machineId,
        plannedQuantity: Number(plannedQuantity),
      });
      await onSuccess(batch);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de créer ce batch.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Créer un batch" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Produit fini</label>
          <select
            required
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setRecipeId('');
              setMachineId('');
            }}
            className={inputClass}
          >
            <option value="">— Sélectionner —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {productId && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Recette (version active)</label>
            <select
              required
              value={recipeId}
              onChange={(e) => {
                setRecipeId(e.target.value);
                setMachineId('');
              }}
              className={inputClass}
            >
              <option value="">— Sélectionner —</option>
              {activeRecipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.format} ml (v{r.version})
                </option>
              ))}
            </select>
            {activeRecipes.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">Aucune recette active pour ce produit.</p>
            )}
          </div>
        )}

        {recipeId && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Machine (compatible avec le format)</label>
            <select required value={machineId} onChange={(e) => setMachineId(e.target.value)} className={inputClass}>
              <option value="">— Sélectionner —</option>
              {compatibleMachines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {compatibleMachines.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">Aucune machine compatible avec ce format.</p>
            )}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Quantité à produire</label>
          <input
            required
            type="number"
            min="1"
            value={plannedQuantity}
            onChange={(e) => setPlannedQuantity(e.target.value)}
            className={inputClass}
          />
        </div>

        {recipeId && plannedQuantity && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="mb-1 text-xs font-medium text-gray-500">Aperçu de la préparation</p>
            <PreparationPreview ingredients={preview} isLoading={isLoadingPreview} />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Création…' : 'Créer le batch'}
        </button>
      </form>
    </Modal>
  );
}

function BatchFeasibilityModal({
  batch,
  report,
  onClose,
  onQuantityAdjusted,
  onReturnToPlanning,
}: {
  batch: Batch;
  report: BatchFeasibilityReport;
  onClose: () => void;
  onQuantityAdjusted: (message: string) => void | Promise<void>;
  onReturnToPlanning: () => void;
}) {
  const { token } = useAuth();
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdjustQuantity() {
    if (!token || report.maxFeasibleQuantity === null || report.maxFeasibleQuantity <= 0) return;
    setError(null);
    setIsAdjusting(true);
    try {
      await api.updateBatchPlannedQuantity(token, batch.id, report.maxFeasibleQuantity);
      await onQuantityAdjusted(`Quantité ajustée à ${report.maxFeasibleQuantity} flacons.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de modifier la quantité.');
    } finally {
      setIsAdjusting(false);
    }
  }

  return (
    <Modal title="Lancement impossible" onClose={onClose} widthClassName="max-w-2xl">
      <p className="text-sm font-medium text-red-600">
        Ce batch ne peut pas être lancé car les stocks sont insuffisants.
      </p>

      <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Article</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Référence</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500">Nécessaire</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500">Disponible</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500">Manquant</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Unité</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {report.shortages.map((shortage) => (
              <tr key={shortage.articleId}>
                <td className="px-3 py-2 font-medium text-gray-900">{shortage.articleName}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{shortage.articleReference}</td>
                <td className="px-3 py-2 text-right text-gray-700">{shortage.quantityNeeded.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-gray-700">{shortage.quantityAvailable.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-medium text-red-600">{shortage.quantityMissing.toFixed(2)}</td>
                <td className="px-3 py-2 text-gray-600">{shortage.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm font-medium text-gray-900">
        {report.maxFeasibleQuantity === 0
          ? 'Avec les stocks actuels, aucun flacon ne peut être produit.'
          : `Avec les stocks actuels, la quantité maximale produisible est de ${report.maxFeasibleQuantity} flacons.`}
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-bg"
        >
          Annuler le lancement
        </button>
        {report.maxFeasibleQuantity !== null && report.maxFeasibleQuantity > 0 && (
          <button
            type="button"
            disabled={isAdjusting}
            onClick={() => void handleAdjustQuantity()}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAdjusting ? 'Modification…' : `Modifier automatiquement la quantité à ${report.maxFeasibleQuantity}`}
          </button>
        )}
        <button
          type="button"
          onClick={onReturnToPlanning}
          className="rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-bg"
        >
          Retourner au planning
        </button>
      </div>
    </Modal>
  );
}

function StartStopModal({
  batchId,
  onClose,
  onSuccess,
}: {
  batchId: string;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [reason, setReason] = useState('');
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.startBatchStop(token, batchId, { reason, startedAt: new Date(startedAt).toISOString() });
      await onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer cet arrêt.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Signaler un arrêt" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Motif</label>
          <input required value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Début</label>
          <input
            required
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : 'Ouvrir l’arrêt'}
        </button>
      </form>
    </Modal>
  );
}

function EndStopModal({
  stop,
  onClose,
  onSuccess,
}: {
  stop: BatchStop;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [endedAt, setEndedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.endBatchStop(token, stop.id, { endedAt: new Date(endedAt).toISOString() });
      await onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de clôturer cet arrêt.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Clôturer l’arrêt — ${stop.reason}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Fin</label>
          <input
            required
            type="datetime-local"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : 'Clôturer l’arrêt'}
        </button>
      </form>
    </Modal>
  );
}

function CloseBatchSection({
  batch,
  blocked,
  allocations,
  articlesById,
  marketsById,
  onSuccess,
}: {
  batch: Batch;
  blocked: boolean;
  allocations: BatchProductAllocation[];
  articlesById: Map<string, Article>;
  marketsById: Map<string, Market>;
  onSuccess: (result: BatchClosureResult) => void | Promise<void>;
}) {
  const { token } = useAuth();

  // Batch historique (antérieur à PRD-11, sans allocation) : le backend n'accepte
  // que l'ancien format racine pour ce cas (voir BatchClosureService.buildClosureLines) —
  // formulaire et payload conservés à l'identique.
  const isHistorical = allocations.length === 0;
  const [producedQuantity, setProducedQuantity] = useState(String(batch.plannedQuantity));
  const [rejectedQuantity, setRejectedQuantity] = useState('0');

  // Un couple conforme/rebuts par allocation. Initialisé une seule fois : aucune
  // allocation ne peut plus être ajoutée une fois le conditionnement atteint (voir
  // BatchProductAllocationsService.assertBatchAcceptsNewAllocation), la liste est
  // donc stable pendant toute la durée de vie de ce composant.
  const [lines, setLines] = useState<Record<string, { produced: string; rejected: string }>>(() =>
    Object.fromEntries(
      allocations.map((allocation) => [
        allocation.id,
        { produced: String(allocation.plannedQuantity), rejected: '0' },
      ]),
    ),
  );

  const [endedAt, setEndedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [formatChanged, setFormatChanged] = useState(false);
  const [formatChangeDetail, setFormatChangeDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Map<string, string>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateLine(allocationId: string, field: 'produced' | 'rejected', value: string) {
    setLines((prev) => ({ ...prev, [allocationId]: { ...prev[allocationId], [field]: value } }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setLineErrors(new Map());

    const commonPayload = {
      endedAt: new Date(endedAt).toISOString(),
      formatChanged,
      formatChangeDetail: formatChanged ? formatChangeDetail : undefined,
    };

    if (isHistorical) {
      setIsSubmitting(true);
      try {
        const result = await api.closeBatch(token, batch.id, {
          ...commonPayload,
          producedQuantity: Number(producedQuantity),
          rejectedQuantity: Number(rejectedQuantity),
        });
        await onSuccess(result);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Impossible de clôturer ce batch.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const allocationInputs = allocations.map((allocation) => ({
      allocationId: allocation.id,
      plannedQuantity: allocation.plannedQuantity,
      producedQuantity: Number(lines[allocation.id]?.produced ?? ''),
      rejectedQuantity: Number(lines[allocation.id]?.rejected ?? ''),
    }));

    const validationErrors = validateAllocationClosureLines(allocationInputs);
    if (validationErrors.length > 0) {
      setLineErrors(new Map(validationErrors.map((e) => [e.allocationId, e.message])));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.closeBatch(token, batch.id, {
        ...commonPayload,
        allocations: allocationInputs.map(({ allocationId, producedQuantity, rejectedQuantity }) => ({
          allocationId,
          producedQuantity,
          rejectedQuantity,
        })),
      });
      await onSuccess(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de clôturer ce batch.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-brand-border bg-white p-4 shadow-sm">
      <h4 className="mb-3 text-sm font-semibold text-gray-900">Clôture du batch</h4>

      {blocked ? (
        <p className="text-sm text-amber-700">Clôturez l’arrêt en cours avant de clôturer le batch.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {isHistorical ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">Quantité conforme</label>
                <input
                  required
                  type="number"
                  min="0"
                  value={producedQuantity}
                  onChange={(e) => setProducedQuantity(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">Rebuts</label>
                <input
                  required
                  type="number"
                  min="0"
                  value={rejectedQuantity}
                  onChange={(e) => setRejectedQuantity(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {allocations.map((allocation) => {
                const line = lines[allocation.id] ?? { produced: '0', rejected: '0' };
                const lineError = lineErrors.get(allocation.id);
                const total = (Number(line.produced) || 0) + (Number(line.rejected) || 0);
                return (
                  <div
                    key={allocation.id}
                    className={`rounded-md border p-3 ${lineError ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                  >
                    {allocations.length > 1 && (
                      <p className="mb-2 text-sm font-medium text-gray-900">
                        {articlesById.get(allocation.productId)?.name ?? 'Produit inconnu'}
                        {allocation.marketId &&
                          ` · ${marketsById.get(allocation.marketId)?.label ?? 'Marché inconnu'}`}
                        {' · Quantité prévue : '}
                        {allocation.plannedQuantity}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-gray-500">Quantité conforme</label>
                        <input
                          required
                          type="number"
                          min="0"
                          value={line.produced}
                          onChange={(e) => updateLine(allocation.id, 'produced', e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-gray-500">Rebuts</label>
                        <input
                          required
                          type="number"
                          min="0"
                          value={line.rejected}
                          onChange={(e) => updateLine(allocation.id, 'rejected', e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">
                      Total conforme + rebuts : {total} (prévu : {allocation.plannedQuantity})
                    </p>
                    {lineError && <p className="mt-1 text-xs font-medium text-red-600">{lineError}</p>}
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Heure de fin</label>
            <input
              required
              type="datetime-local"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={formatChanged} onChange={(e) => setFormatChanged(e.target.checked)} />
              Changement de format effectué pendant ce batch
            </label>
            {formatChanged && (
              <input
                placeholder="Détail du changement de format"
                value={formatChangeDetail}
                onChange={(e) => setFormatChangeDetail(e.target.value)}
                className={`${inputClass} mt-2`}
              />
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Clôture…' : 'Clôturer le batch'}
          </button>
        </form>
      )}
    </div>
  );
}

function AllocationsSection({
  allocations,
  isLoading,
  error,
  articlesById,
  marketsById,
  canAddAllocation,
  onAddClick,
}: {
  allocations: BatchProductAllocation[];
  isLoading: boolean;
  error: string | null;
  articlesById: Map<string, Article>;
  marketsById: Map<string, Market>;
  canAddAllocation: boolean;
  onAddClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Allocations</h4>
        {canAddAllocation && (
          <button onClick={onAddClick} className="text-xs font-medium text-brand hover:underline">
            + Ajouter une allocation
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : allocations.length === 0 ? (
        !error && <p className="text-sm text-gray-500">Aucune allocation.</p>
      ) : (
        <ul className="space-y-1 text-sm text-gray-700">
          {allocations.map((allocation) => (
            <li key={allocation.id}>
              {articlesById.get(allocation.productId)?.name ?? 'Produit inconnu'}
              {allocation.marketId && ` · ${marketsById.get(allocation.marketId)?.label ?? 'Marché inconnu'}`}
              {' · Quantité prévue : '}
              {allocation.plannedQuantity}
            </li>
          ))}
        </ul>
      )}

      {allocations.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          Une allocation ne peut être ni modifiée ni supprimée depuis cette interface.
        </p>
      )}
    </div>
  );
}

function AddAllocationModal({
  batch,
  referenceProduct,
  articles,
  allocations,
  onClose,
  onSuccess,
}: {
  batch: Batch;
  referenceProduct: Article | null;
  articles: Article[];
  allocations: BatchProductAllocation[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const mode = resolveAllocationMode(referenceProduct);

  const allocatedMarketIds = useMemo(
    () => allocations.map((a) => a.marketId).filter((id): id is string => id !== null),
    [allocations],
  );
  const allocatedProductIds = useMemo(() => allocations.map((a) => a.productId), [allocations]);

  const options = useMemo(() => {
    if (mode === 'market') {
      if (!referenceProduct?.productFamilyId) return [];
      return getEligibleMarketDeclinations(articles, referenceProduct.productFamilyId, allocatedMarketIds).map(
        (article) => ({ value: article.marketId as string, label: article.name }),
      );
    }
    return getEligibleStandaloneProducts(articles, allocatedProductIds).map((article) => ({
      value: article.id,
      label: article.name,
    }));
  }, [mode, referenceProduct, articles, allocatedMarketIds, allocatedProductIds]);

  const [selectedValue, setSelectedValue] = useState('');
  const [plannedQuantity, setPlannedQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const quantityValue = Number(plannedQuantity);
  const isQuantityValid = plannedQuantity !== '' && Number.isInteger(quantityValue) && quantityValue > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedValue || !isQuantityValid) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const payload: AddBatchProductAllocationRequest =
        mode === 'market'
          ? { marketId: selectedValue, plannedQuantity: quantityValue }
          : { productId: selectedValue, plannedQuantity: quantityValue };
      await api.addBatchAllocation(token, batch.id, payload);
      await onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’ajouter cette allocation.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Ajouter une allocation" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!referenceProduct ? (
          <p className="text-sm text-gray-500">Chargement du produit de référence…</p>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">
              {mode === 'market' ? 'Marché' : 'Produit fini'}
            </label>
            <select
              required
              value={selectedValue}
              onChange={(e) => setSelectedValue(e.target.value)}
              className={inputClass}
            >
              <option value="">— Sélectionner —</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {options.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                {mode === 'market'
                  ? 'Aucun marché disponible : toutes les déclinaisons de cette famille commerciale sont déjà allouées à ce batch, ou aucune n’a été créée au catalogue.'
                  : 'Aucun produit fini disponible pour une nouvelle allocation.'}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Quantité planifiée</label>
          <input
            required
            type="number"
            min="1"
            step="1"
            value={plannedQuantity}
            onChange={(e) => setPlannedQuantity(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting || !selectedValue || !isQuantityValid}
          className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Ajout…' : 'Ajouter l’allocation'}
        </button>
      </form>
    </Modal>
  );
}
