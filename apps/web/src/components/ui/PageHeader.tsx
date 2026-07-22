import type { ReactNode } from 'react';

/**
 * En-tête de page réutilisable (chantier UI-03) : remplace le motif
 * `<h2>titre</h2><p>description</p>` déjà dupliqué à l'identique dans toutes
 * les pages du projet. `action` est un emplacement optionnel pour un bouton
 * contextuel, non utilisé par le Catalogue dans ce ticket (le formulaire de
 * création reste toujours visible, jamais replié derrière une action).
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
