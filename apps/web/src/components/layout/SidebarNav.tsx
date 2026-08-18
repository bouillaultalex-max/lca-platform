import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
}

/**
 * Reprise à l'identique de la logique déjà en place dans AppLayout (routes,
 * ordre, conditions de permission) — voir docs/regles-metier.md §1. Aucune
 * route ajoutée, aucune retirée : uniquement un changement de présentation
 * (verticale au lieu d'horizontale). `end` conservé systématiquement (voir le
 * correctif du 2026-07-14 : sans lui, "/catalog" resterait actif sur
 * "/catalog/recipes" etc., dont il est un préfixe).
 */
function buildNavItems(fullAccess: boolean, isSystemAdmin: boolean): NavItem[] {
  const items: NavItem[] = [{ to: '/dashboard', label: 'Tableau de bord' }];
  if (fullAccess) {
    items.push(
      { to: '/catalog', label: 'Catalogue' },
      { to: '/catalog/recipes', label: 'Recettes' },
      { to: '/catalog/machines', label: 'Machines' },
      { to: '/catalog/suppliers', label: 'Fournisseurs' },
      { to: '/catalog/markets', label: 'Marchés' },
      { to: '/catalog/product-families', label: 'Familles de produits' },
      { to: '/production', label: 'Production' },
      { to: '/imports', label: 'Imports' },
      { to: '/rnd/aroma-samples', label: 'Aromathèque' },
    );
  }
  items.push({ to: '/stock', label: 'Stock' }, { to: '/traceability', label: 'Traçabilité' });
  if (isSystemAdmin) {
    items.push(
      { to: '/admin/users', label: 'Administration' },
      { to: '/admin/feedback', label: 'Retours' },
    );
  }
  return items;
}

export function SidebarNav({
  fullAccess,
  isSystemAdmin,
  isCollapsed,
  onNavigate,
}: {
  fullAccess: boolean;
  isSystemAdmin: boolean;
  /** Icônes seules + infobulle native (`title`) ; jamais appliqué au tiroir mobile (voir Sidebar). */
  isCollapsed: boolean;
  /** Referme le tiroir mobile après un clic sur un lien ; no-op côté desktop. */
  onNavigate: () => void;
}) {
  const items = buildNavItems(fullAccess, isSystemAdmin);

  return (
    <nav aria-label="Navigation principale" className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          onClick={onNavigate}
          title={isCollapsed ? item.label : undefined}
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
              isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
            } ${isCollapsed ? 'justify-center' : ''}`
          }
        >
          {isCollapsed ? (
            <>
              <span aria-hidden="true" className="text-xs font-semibold uppercase">
                {item.label.slice(0, 2)}
              </span>
              <span className="sr-only">{item.label}</span>
            </>
          ) : (
            <span className="truncate">{item.label}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
