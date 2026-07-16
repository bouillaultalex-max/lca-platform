import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArticleImportRow,
  ArticlesImportConfirmResult,
  ArticlesImportPreviewResult,
  ExpectedRequirementImportRow,
  ExpectedRequirementsImportConfirmResult,
  ExpectedRequirementsImportPreviewResult,
  ImportLog,
  ImportType,
  InventoryImportPreviewResult,
  MappingCorrection,
  StockImportRow,
  StocksImportConfirmResult,
  StocksImportPreviewResult,
} from '@lca-mes/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { AppLayout } from '../../components/AppLayout';
import { MappingPanel } from './MappingPanel';
import { ArticlesPreviewPanel } from './ArticlesPreviewPanel';
import { StocksPreviewPanel } from './StocksPreviewPanel';
import { ExpectedRequirementsPreviewPanel } from './ExpectedRequirementsPreviewPanel';
import { InventoryPreviewPanel } from './InventoryPreviewPanel';
import { SuccessScreen } from './SuccessScreen';
import { ImportHistoryPanel } from './ImportHistoryPanel';
import { formatImportDate } from './importFormatting';
import { toArticlesConfirmRow } from './articlesConfirmRow';

type AnyPreviewResult =
  | ArticlesImportPreviewResult
  | StocksImportPreviewResult
  | ExpectedRequirementsImportPreviewResult
  | InventoryImportPreviewResult;

type AnyConfirmResult =
  | ArticlesImportConfirmResult
  | StocksImportConfirmResult
  | ExpectedRequirementsImportConfirmResult;

type WizardStepId = 'type' | 'file' | 'mapping' | 'preview' | 'success';

const WIZARD_STEPS: { id: WizardStepId; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'file', label: 'Fichier' },
  { id: 'mapping', label: 'Colonnes' },
  { id: 'preview', label: 'Aperçu' },
  { id: 'success', label: 'Confirmation' },
];

const IMPORT_TYPE_OPTIONS: {
  type: ImportType;
  emoji: string;
  title: string;
  description: string;
  note?: string;
}[] = [
  {
    type: 'ARTICLES',
    emoji: '📄',
    title: 'Articles',
    description: 'Créer ou mettre à jour des articles depuis un fichier OpenSi.',
  },
  {
    type: 'STOCKS',
    emoji: '📦',
    title: 'Stocks',
    description: 'Enregistrer des réceptions de stock depuis un fichier OpenSi.',
  },
  {
    type: 'BESOINS_ATTENDUS',
    emoji: '📈',
    title: 'Besoins attendus',
    description: 'Ajouter les besoins attendus transmis par OpenSi.',
  },
  {
    type: 'INVENTAIRE',
    emoji: '🔍',
    title: 'Inventaire',
    description: "Lire et vérifier le contenu d'un fichier d'inventaire.",
    note: 'Aperçu uniquement pour le moment',
  },
];

function defaultSelection(type: ImportType, result: AnyPreviewResult): Set<number> {
  if (!result.mappingComplete) return new Set();
  if (type === 'ARTICLES') {
    const r = result as ArticlesImportPreviewResult;
    return new Set([...(r.toCreate ?? []), ...(r.toUpdate ?? [])].map((row) => row.line));
  }
  if (type === 'STOCKS') {
    const r = result as StocksImportPreviewResult;
    return new Set((r.toReceive ?? []).map((row) => row.line));
  }
  if (type === 'BESOINS_ATTENDUS') {
    const r = result as ExpectedRequirementsImportPreviewResult;
    return new Set((r.toImport ?? []).map((row) => row.line));
  }
  return new Set();
}

function WizardStepper({ currentStep }: { currentStep: WizardStepId }) {
  const currentIndex = WIZARD_STEPS.findIndex((step) => step.id === currentStep);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {WIZARD_STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <Fragment key={step.id}>
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
              {index + 1}. {step.label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function FileDropZone({
  onFileSelected,
  isLoading,
}: {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    const selected = files?.[0];
    if (selected) onFileSelected(selected);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition ${
        isDragging ? 'border-brand bg-brand/5' : 'border-brand-border bg-white hover:bg-gray-50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
      {isLoading ? (
        <p className="text-sm text-gray-500">Lecture du fichier en cours…</p>
      ) : (
        <>
          <p className="text-4xl">📂</p>
          <p className="mt-3 text-sm font-medium text-gray-700">
            Déposez votre fichier ici, ou cliquez pour le choisir
          </p>
          <p className="mt-1 text-xs text-gray-500">Formats acceptés : .xlsx, .csv</p>
        </>
      )}
    </div>
  );
}

export function ImportsPage() {
  const { token } = useAuth();

  const [activeTab, setActiveTab] = useState<'wizard' | 'history'>('wizard');

  const [step, setStep] = useState<WizardStepId>('type');
  const [selectedType, setSelectedType] = useState<ImportType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewResult, setPreviewResult] = useState<AnyPreviewResult | null>(null);
  const [mappingCorrections, setMappingCorrections] = useState<MappingCorrection[]>([]);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [confirmResult, setConfirmResult] = useState<AnyConfirmResult | null>(null);

  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<ImportType | ''>('');
  const [lastLog, setLastLog] = useState<ImportLog | null>(null);

  const refreshHistory = useCallback(
    async (type: ImportType | '') => {
      if (!token) return;
      setIsLoadingLogs(true);
      try {
        const result = await api.listImportLogs(token, type || undefined);
        setLogs(result);
      } catch {
        // L'historique n'est pas critique pour l'assistant : on n'affiche pas d'erreur bloquante.
      } finally {
        setIsLoadingLogs(false);
      }
    },
    [token],
  );

  const refreshLastLog = useCallback(async () => {
    if (!token) return;
    try {
      const all = await api.listImportLogs(token);
      setLastLog(all[0] ?? null);
    } catch {
      // Bandeau informatif uniquement : on l'ignore simplement s'il échoue.
    }
  }, [token]);

  useEffect(() => {
    void refreshHistory(historyTypeFilter);
  }, [refreshHistory, historyTypeFilter]);

  useEffect(() => {
    void refreshLastLog();
  }, [refreshLastLog]);

  function callPreview(
    type: ImportType,
    selectedFile: File,
    corrections: MappingCorrection[],
  ): Promise<AnyPreviewResult> {
    if (!token) throw new ApiError(401, 'Session expirée, reconnectez-vous.');
    if (type === 'ARTICLES') return api.previewArticlesImport(token, selectedFile, corrections);
    if (type === 'STOCKS') return api.previewStocksImport(token, selectedFile, corrections);
    if (type === 'BESOINS_ATTENDUS')
      return api.previewExpectedRequirementsImport(token, selectedFile, corrections);
    return api.previewInventoryImport(token, selectedFile, corrections);
  }

  function resetWizard() {
    setSelectedType(null);
    setFile(null);
    setPreviewResult(null);
    setMappingCorrections([]);
    setSelectedLines(new Set());
    setConfirmResult(null);
    setWizardError(null);
    setConfirmError(null);
    setStep('type');
  }

  function handleSelectType(type: ImportType) {
    resetWizard();
    setSelectedType(type);
    setStep('file');
  }

  async function handleFileSelected(selectedFile: File) {
    if (!selectedType) return;
    setFile(selectedFile);
    setIsLoadingPreview(true);
    setWizardError(null);
    try {
      const result = await callPreview(selectedType, selectedFile, []);
      setPreviewResult(result);
      setMappingCorrections([]);
      setSelectedLines(defaultSelection(selectedType, result));
      setStep('mapping');
    } catch (err) {
      setWizardError(err instanceof ApiError ? err.message : 'Impossible de lire ce fichier.');
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleRevalidateMapping() {
    if (!selectedType || !file) return;
    setIsLoadingPreview(true);
    setWizardError(null);
    try {
      const result = await callPreview(selectedType, file, mappingCorrections);
      setPreviewResult(result);
      setSelectedLines(defaultSelection(selectedType, result));
    } catch (err) {
      setWizardError(err instanceof ApiError ? err.message : 'Impossible de revalider ces colonnes.');
    } finally {
      setIsLoadingPreview(false);
    }
  }

  function handleApplyCorrection(fieldKey: string, columnName: string) {
    setMappingCorrections((prev) => {
      const next = prev.filter((correction) => correction.fieldKey !== fieldKey);
      if (columnName) next.push({ fieldKey, columnName });
      return next;
    });
  }

  function handleToggleLine(line: number) {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  function handleToggleAll(checked: boolean, lines: number[]) {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      for (const line of lines) {
        if (checked) next.add(line);
        else next.delete(line);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (!token || !selectedType || !previewResult) return;
    setIsConfirming(true);
    setConfirmError(null);
    const corrections = mappingCorrections.length > 0 ? mappingCorrections : undefined;
    try {
      if (selectedType === 'ARTICLES') {
        const result = previewResult as ArticlesImportPreviewResult;
        const rows: ArticleImportRow[] = [...(result.toCreate ?? []), ...(result.toUpdate ?? [])]
          .filter((row) => selectedLines.has(row.line))
          .map(toArticlesConfirmRow);
        const confirmed = await api.confirmArticlesImport(token, {
          importLogId: result.importLogId,
          rows,
          mappingCorrections: corrections,
        });
        setConfirmResult(confirmed);
      } else if (selectedType === 'STOCKS') {
        const result = previewResult as StocksImportPreviewResult;
        const rows: StockImportRow[] = (result.toReceive ?? []).filter((row) => selectedLines.has(row.line));
        const confirmed = await api.confirmStocksImport(token, {
          importLogId: result.importLogId,
          rows,
          mappingCorrections: corrections,
        });
        setConfirmResult(confirmed);
      } else if (selectedType === 'BESOINS_ATTENDUS') {
        const result = previewResult as ExpectedRequirementsImportPreviewResult;
        const rows: ExpectedRequirementImportRow[] = (result.toImport ?? []).filter((row) =>
          selectedLines.has(row.line),
        );
        const confirmed = await api.confirmExpectedRequirementsImport(token, {
          importLogId: result.importLogId,
          rows,
          mappingCorrections: corrections,
        });
        setConfirmResult(confirmed);
      }
      setStep('success');
      void refreshHistory(historyTypeFilter);
      void refreshLastLog();
    } catch (err) {
      setConfirmError(
        err instanceof ApiError ? err.message : 'Une erreur est survenue lors de la confirmation.',
      );
    } finally {
      setIsConfirming(false);
    }
  }

  function handleBackToImports() {
    resetWizard();
    setActiveTab('history');
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Imports</h2>
      <p className="text-sm text-gray-500">Importer des fichiers OpenSi (articles, stocks, besoins attendus, inventaire).</p>

      {lastLog && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
          <span className="font-medium text-gray-500">Dernier import : </span>
          {lastLog.fileName} — {formatImportDate(lastLog.importedAt)} —{' '}
          {lastLog.status === 'VALIDE' ? '✅ Réussi' : lastLog.status === 'ERREUR' ? '❌ Échec' : '⏳ Prévisualisé'}
        </div>
      )}

      <div className="mt-6 flex gap-1 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab('wizard')}
          className={`rounded-t-md px-4 py-2 text-sm font-medium transition ${
            activeTab === 'wizard' ? 'border-b-2 border-accent text-brand' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Nouvel import
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`rounded-t-md px-4 py-2 text-sm font-medium transition ${
            activeTab === 'history' ? 'border-b-2 border-accent text-brand' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Historique
        </button>
      </div>

      {activeTab === 'history' ? (
        <div className="mt-6">
          <ImportHistoryPanel
            logs={logs}
            isLoading={isLoadingLogs}
            typeFilter={historyTypeFilter}
            onTypeFilterChange={setHistoryTypeFilter}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <WizardStepper currentStep={step} />

          {wizardError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{wizardError}</p>}

          {step === 'type' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {IMPORT_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => handleSelectType(option.type)}
                  className="flex flex-col items-start rounded-xl border border-brand-border bg-white p-4 text-left shadow-sm transition-colors hover:border-brand hover:shadow-md"
                >
                  <span className="text-3xl">{option.emoji}</span>
                  <span className="mt-2 font-semibold text-gray-900">{option.title}</span>
                  <span className="mt-1 text-xs text-gray-500">{option.description}</span>
                  {option.note && (
                    <span className="mt-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {option.note}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {step === 'file' && <FileDropZone onFileSelected={handleFileSelected} isLoading={isLoadingPreview} />}

          {step === 'mapping' && previewResult && (
            <div className="space-y-4">
              <MappingPanel
                mapping={previewResult.mapping}
                pendingCorrections={mappingCorrections}
                onApplyCorrection={handleApplyCorrection}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRevalidateMapping}
                  disabled={isLoadingPreview || mappingCorrections.length === 0}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingPreview ? 'Revalidation…' : 'Revalider les colonnes'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('preview')}
                  disabled={!previewResult.mappingComplete}
                  className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continuer vers l'aperçu →
                </button>
              </div>
              {!previewResult.mappingComplete && (
                <p className="text-xs text-gray-500">
                  Complétez les colonnes à vérifier ci-dessus pour continuer.
                </p>
              )}
            </div>
          )}

          {step === 'preview' && previewResult && selectedType === 'ARTICLES' && (
            <ArticlesPreviewPanel
              result={previewResult as ArticlesImportPreviewResult}
              selectedLines={selectedLines}
              onToggleLine={handleToggleLine}
              onToggleAll={handleToggleAll}
              onConfirm={handleConfirm}
              isConfirming={isConfirming}
              confirmError={confirmError}
            />
          )}
          {step === 'preview' && previewResult && selectedType === 'STOCKS' && (
            <StocksPreviewPanel
              result={previewResult as StocksImportPreviewResult}
              selectedLines={selectedLines}
              onToggleLine={handleToggleLine}
              onToggleAll={handleToggleAll}
              onConfirm={handleConfirm}
              isConfirming={isConfirming}
              confirmError={confirmError}
            />
          )}
          {step === 'preview' && previewResult && selectedType === 'BESOINS_ATTENDUS' && (
            <ExpectedRequirementsPreviewPanel
              result={previewResult as ExpectedRequirementsImportPreviewResult}
              selectedLines={selectedLines}
              onToggleLine={handleToggleLine}
              onToggleAll={handleToggleAll}
              onConfirm={handleConfirm}
              isConfirming={isConfirming}
              confirmError={confirmError}
            />
          )}
          {step === 'preview' && previewResult && selectedType === 'INVENTAIRE' && (
            <InventoryPreviewPanel
              result={previewResult as InventoryImportPreviewResult}
              onFinish={resetWizard}
            />
          )}

          {step === 'success' && confirmResult && selectedType === 'ARTICLES' && (
            <SuccessScreen
              lines={[
                `${(confirmResult as ArticlesImportConfirmResult).created} articles créés`,
                `${(confirmResult as ArticlesImportConfirmResult).updated} articles mis à jour`,
                ...((confirmResult as ArticlesImportConfirmResult).errors.length === 0 ? ['Aucune erreur'] : []),
              ]}
              errorSummary={
                (confirmResult as ArticlesImportConfirmResult).errors.length > 0
                  ? `${(confirmResult as ArticlesImportConfirmResult).errors.length} ligne(s) en erreur`
                  : undefined
              }
              onBackToImports={handleBackToImports}
              onNewImport={resetWizard}
            />
          )}
          {step === 'success' && confirmResult && selectedType === 'STOCKS' && (
            <SuccessScreen
              lines={[
                `${(confirmResult as StocksImportConfirmResult).received} réceptions enregistrées`,
                ...((confirmResult as StocksImportConfirmResult).errors.length === 0 ? ['Aucune erreur'] : []),
              ]}
              errorSummary={
                (confirmResult as StocksImportConfirmResult).errors.length > 0
                  ? `${(confirmResult as StocksImportConfirmResult).errors.length} ligne(s) en erreur`
                  : undefined
              }
              onBackToImports={handleBackToImports}
              onNewImport={resetWizard}
            />
          )}
          {step === 'success' && confirmResult && selectedType === 'BESOINS_ATTENDUS' && (
            <SuccessScreen
              lines={[
                `${(confirmResult as ExpectedRequirementsImportConfirmResult).imported} besoins ajoutés`,
                ...((confirmResult as ExpectedRequirementsImportConfirmResult).errors.length === 0
                  ? ['Aucune erreur']
                  : []),
              ]}
              errorSummary={
                (confirmResult as ExpectedRequirementsImportConfirmResult).errors.length > 0
                  ? `${(confirmResult as ExpectedRequirementsImportConfirmResult).errors.length} ligne(s) en erreur`
                  : undefined
              }
              onBackToImports={handleBackToImports}
              onNewImport={resetWizard}
            />
          )}
        </div>
      )}
    </AppLayout>
  );
}
