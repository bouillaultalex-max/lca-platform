import type { ReactNode } from 'react';

export type SummaryCardTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

const TONE_CLASSES: Record<SummaryCardTone, string> = {
  green: 'bg-green-50 text-green-700 border-green-100',
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  red: 'bg-red-50 text-red-700 border-red-100',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
};

/**
 * Grande carte de tableau de bord : l'objectif est qu'un responsable comprenne le
 * résultat d'un import en moins de 5 secondes, sans lire le moindre tableau (décision
 * validée le 2026-07-07).
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
    <div className={`rounded-lg border p-4 text-center ${TONE_CLASSES[tone]}`}>
      <div className="text-3xl">{icon}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
      <div className="mt-1 text-sm font-medium">{label}</div>
    </div>
  );
}

export function SummaryDashboard({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
