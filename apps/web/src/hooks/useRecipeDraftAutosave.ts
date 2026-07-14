import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecipeDraft, SaveRecipeDraftRequest } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';

const DEBOUNCE_MS = 2000;
const MAX_WAIT_MS = 15000;

export interface RecipeDraftAutosaveContent {
  format: number | null;
  lines: { articleId: string; quantityPerUnit: string; unit: string }[];
}

interface FlushOptions {
  keepalive?: boolean;
  force?: boolean;
}

export interface UseRecipeDraftAutosaveResult {
  lastSavedAt: Date | null;
  isSaving: boolean;
  saveError: string | null;
  /** Brouillon tel que vu par le serveur au moment d'un conflit détecté (409), ou `null` sinon. */
  conflict: RecipeDraft | null;
  draftId: string | null;
  /** Recharge le brouillon serveur (abandonne les modifications locales non enregistrées). */
  resolveConflictReload: () => Promise<RecipeDraft | undefined>;
  /** Réenregistre le contenu local en ignorant le conflit détecté. */
  resolveConflictForce: () => Promise<void>;
  /**
   * Annule toute sauvegarde en attente et réinitialise le suivi (après validation finale
   * de la recette) : le prochain changement de contenu (ex. remise à zéro du formulaire)
   * est traité comme une nouvelle base de référence, pas comme une modification à
   * autosauvegarder — sans quoi un brouillon vide serait recréé juste après la création.
   */
  stop: () => void;
}

/**
 * Autosave d'un brouillon de recette (voir docs/adr/0004-brouillons-recettes.md) :
 * debounce 2s après chaque modification, sauvegarde forcée toutes les 15s en cas de
 * saisie continue, flush immédiat au changement d'onglet et à la navigation/fermeture.
 * Volontairement PAS de flush sur simple perte de focus (décision explicite).
 */
export function useRecipeDraftAutosave(
  token: string | null,
  finishedProductId: string,
  content: RecipeDraftAutosaveContent,
  enabled: boolean,
): UseRecipeDraftAutosaveResult {
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<RecipeDraft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  const contentRef = useRef(content);
  const expectedUpdatedAtRef = useRef<string | undefined>(undefined);
  const dirtyRef = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstContentRef = useRef(true);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const clearTimers = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
    debounceTimer.current = null;
    maxWaitTimer.current = null;
  }, []);

  const flush = useCallback(
    async (opts?: FlushOptions) => {
      if (!token || !enabled) return;
      if (!dirtyRef.current && !opts?.force) return;
      clearTimers();
      dirtyRef.current = false;
      setIsSaving(true);
      const payload: SaveRecipeDraftRequest = {
        finishedProductId,
        format: contentRef.current.format,
        lines: contentRef.current.lines,
        expectedUpdatedAt: expectedUpdatedAtRef.current,
        force: opts?.force,
      };
      try {
        const saved = await api.saveRecipeDraft(token, payload, { keepalive: opts?.keepalive });
        expectedUpdatedAtRef.current = saved.updatedAt;
        setDraftId(saved.id);
        setLastSavedAt(new Date(saved.updatedAt));
        setSaveError(null);
        setConflict(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // Un autre onglet/poste a modifié le brouillon entre-temps : on ne touche pas à la
          // saisie locale, l'utilisateur choisit explicitement de recharger ou de forcer.
          try {
            const server = await api.getRecipeDraft(token, finishedProductId);
            setConflict(server ?? null);
          } catch {
            setConflict(null);
          }
        } else {
          // Échec réseau ou autre : ne jamais perdre la saisie silencieusement — on le
          // signale et on retente à la prochaine modification/cycle de 15s.
          dirtyRef.current = true;
          setSaveError(
            err instanceof ApiError
              ? err.message
              : 'Échec de l’enregistrement automatique du brouillon.',
          );
        }
      } finally {
        setIsSaving(false);
      }
    },
    [clearTimers, enabled, finishedProductId, token],
  );

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
    if (!maxWaitTimer.current) {
      maxWaitTimer.current = setTimeout(() => void flushRef.current(), MAX_WAIT_MS);
    }
  }, []);

  const resetState = useCallback(() => {
    isFirstContentRef.current = true;
    dirtyRef.current = false;
    expectedUpdatedAtRef.current = undefined;
    setDraftId(null);
    setLastSavedAt(null);
    setSaveError(null);
    setConflict(null);
    clearTimers();
  }, [clearTimers]);

  // Nouvelle session de brouillon (changement de produit) : on repart à zéro.
  useEffect(() => {
    resetState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedProductId]);

  // Planifie une sauvegarde à chaque modification de contenu, sauf la toute première
  // (chargement initial d'un brouillon repris/dupliqué, pas une modification utilisateur).
  useEffect(() => {
    if (!enabled) return;
    if (isFirstContentRef.current) {
      isFirstContentRef.current = false;
      return;
    }
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, enabled]);

  // Flush au changement d'onglet et à la fermeture/navigation hors de l'application.
  // Volontairement pas de flush sur `blur` seul (décision explicite, voir hook doc ci-dessus).
  useEffect(() => {
    if (!enabled) return undefined;

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') void flushRef.current({ keepalive: true });
    }
    function handleBeforeUnload() {
      void flushRef.current({ keepalive: true });
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Démontage du composant (navigation interne React Router) : flush best-effort.
      void flushRef.current({ keepalive: true });
    };
  }, [enabled]);

  const resolveConflictReload = useCallback(async (): Promise<RecipeDraft | undefined> => {
    if (!token) return undefined;
    const server = await api.getRecipeDraft(token, finishedProductId);
    expectedUpdatedAtRef.current = server?.updatedAt;
    dirtyRef.current = false;
    setDraftId(server?.id ?? null);
    setLastSavedAt(server ? new Date(server.updatedAt) : null);
    setConflict(null);
    return server;
  }, [token, finishedProductId]);

  const resolveConflictForce = useCallback(async () => {
    await flush({ force: true });
  }, [flush]);

  const stop = useCallback(() => {
    resetState();
  }, [resetState]);

  return {
    lastSavedAt,
    isSaving,
    saveError,
    conflict,
    draftId,
    resolveConflictReload,
    resolveConflictForce,
    stop,
  };
}
