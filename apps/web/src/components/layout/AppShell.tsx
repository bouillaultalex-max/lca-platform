import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSidebarState } from '../../hooks/useSidebarState';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PageContainer } from './PageContainer';

/**
 * Structure globale de l'application : Sidebar + Header + zone de contenu.
 * Aucun accès direct aux données métier — reçoit uniquement `children` (le
 * contenu de page, inchangé) et compose la mise en page autour. L'état réduit
 * de la Sidebar (desktop/tablette) et l'état ouvert du tiroir mobile sont
 * deux préoccupations distinctes : le premier est persisté (voir
 * useSidebarState), le second est toujours éphémère et se referme à chaque
 * changement de route.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { isCollapsed, toggle } = useSidebarState();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-surface-muted">
      <Sidebar
        isCollapsed={isCollapsed}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div
        className={`flex min-h-screen flex-col transition-[padding-left] duration-200 motion-reduce:transition-none ${
          isCollapsed ? 'lg:pl-[var(--sidebar-width-collapsed)]' : 'lg:pl-[var(--sidebar-width)]'
        }`}
      >
        <Header
          isSidebarCollapsed={isCollapsed}
          onToggleSidebar={toggle}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
        />
        <main className="flex-1">
          <PageContainer>{children}</PageContainer>
        </main>
      </div>
    </div>
  );
}
