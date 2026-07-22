import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'lca-mes.sidebarCollapsed';

/**
 * État réduit/développé de la Sidebar (desktop/tablette), persisté en
 * localStorage — seul mécanisme de persistance frontend déjà utilisé par le
 * projet (token JWT, voir AuthContext). Ne concerne jamais le tiroir mobile
 * (toujours refermé au chargement, état par nature éphémère à ce gabarit,
 * géré séparément dans AppShell).
 */
export function useSidebarState() {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(isCollapsed));
    } catch {
      // Stockage indisponible (navigation privée stricte, quota atteint) : le
      // repli/dépli reste fonctionnel pour la session, simplement non persisté.
    }
  }, [isCollapsed]);

  const toggle = useCallback(() => setIsCollapsed((prev) => !prev), []);

  return { isCollapsed, toggle };
}
