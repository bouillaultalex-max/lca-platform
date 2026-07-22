import type { ReactNode } from 'react';

/**
 * Conteneur "carte titrée" réutilisable (chantier UI-02) : remplace le motif
 * `rounded-xl border ... bg-white p-4 shadow-sm` + `<h4>` déjà dupliqué partout
 * dans l'application, pour les sections qui n'existent pas encore ailleurs
 * (Actions rapides, Activité récente). `action` est un emplacement optionnel
 * pour un lien contextuel (ex. "Voir tout →"), affiché à côté du titre.
 */
export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-divider bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
