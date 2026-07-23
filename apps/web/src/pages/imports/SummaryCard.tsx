import type { ReactNode } from 'react';

export type SummaryCardTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

const ICON_BADGE_CLASSES: Record<SummaryCardTone, string> = {
  green: 'bg-green-50 text-green-600',
  blue: 'bg-navy/10 text-navy',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  gray: 'bg-gray-100 text-gray-500',
};

/**
 * Grande carte de tableau de bord : l'objectif est qu'un responsable comprenne le
 * résultat d'un import (ou l'indicateur du dashboard) en moins de 5 secondes.
 * Hiérarchie visuelle : icône dans un badge teinté, valeur mise en avant,
 * libellé discret (mini-jalon "Identité Maison Fuel").
 */
export function SummaryCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: string;
  value: number;
  label: string;
  tone: SummaryCardTone;
}) {
  return (
    <div className="rounded-xl border border-divider bg-white p-4 shadow-sm">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-xl ${ICON_BADGE_CLASSES[tone]}`}>
        {icon}
      </div>
      <div className="mt-3 text-3xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-xs font-medium text-gray-500">{label}</div>
    </div>
  );
}

export function SummaryDashboard({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
