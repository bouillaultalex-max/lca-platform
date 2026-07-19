import { AppLayout } from '../components/AppLayout';

export function TraceabilityPage() {
  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Traçabilité</h2>
      <p className="mt-1 text-sm text-gray-500">
        Consultation de la généalogie des lots (matières et packaging consommés) et de la traçabilité amont des lots
        de réception.
      </p>

      <div className="mt-6 rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Recherche à venir.</p>
      </div>
    </AppLayout>
  );
}
