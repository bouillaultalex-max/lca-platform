import type { BatchPrintData, IngredientQuantity } from '@lca-mes/shared';
import { buildPrintLabels, type PrintLabelViewModel } from '../utils/productionLabels';

/**
 * Deux étiquettes physiques Brady BBP12 par allocation (voir ADR 0010 §
 * Décisions 16/17) : PRODUIT (poste de conditionnement) et BATCHING/RECETTE
 * (poste de préparation). Composant dédié à l'impression uniquement — reste
 * invisible à l'écran (`.print-only`, voir index.css) et n'apparaît que dans le
 * flux imprimé par `window.print()` (voir ProductionPage.tsx). Ne recalcule
 * jamais un numéro, une DDM ou une quantité : la forme des étiquettes vient
 * intégralement de `buildPrintLabels` (fonction pure testée, voir
 * utils/productionLabels.spec.ts), elle-même dérivée de
 * `GET /production/batches/:id/print-data` (backend, source unique de vérité).
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR');
}

function formatIngredientLine(ingredient: IngredientQuantity): string {
  if (ingredient.kind === 'MATIERE_PREMIERE') {
    const mass = ingredient.massKg === null ? '' : ` (${ingredient.massKg.toFixed(2)} kg)`;
    return `${ingredient.articleName} — ${ingredient.volumeL.toFixed(2)} L${mass}`;
  }
  return `${ingredient.articleName} — ${ingredient.quantity} ${ingredient.unit}`;
}

function ProductLabel({ label }: { label: PrintLabelViewModel }) {
  return (
    <section className="print-label-page">
      <p className="text-xs uppercase tracking-wide text-gray-500">Étiquette produit</p>
      <h2 className="mt-2 text-2xl font-semibold text-gray-900">{label.productName}</h2>
      <p className="mt-4 text-3xl font-bold text-gray-900">{label.quantityToBatch} unités</p>
      <div className="mt-auto space-y-1 text-sm text-gray-800">
        <p>
          <span className="font-medium">Lot :</span> {label.lotNumber}
        </p>
        <p>
          <span className="font-medium">DDM :</span> {formatDate(label.expiryDate)}
        </p>
      </div>
    </section>
  );
}

function BatchingLabel({ label }: { label: PrintLabelViewModel }) {
  return (
    <section className="print-label-page">
      <p className="text-xs uppercase tracking-wide text-gray-500">Étiquette batching</p>
      <h2 className="mt-1 text-lg font-semibold text-gray-900">{label.productName}</h2>
      <p className="text-sm text-gray-800">
        <span className="font-medium">Lot :</span> {label.lotNumber} · <span className="font-medium">DDM :</span>{' '}
        {formatDate(label.expiryDate)} · <span className="font-medium">Quantité :</span> {label.quantityToBatch}{' '}
        unités
      </p>
      <ul className="mt-2 flex-1 space-y-0.5 overflow-hidden text-xs text-gray-800">
        {label.ingredients.map((ingredient) => (
          <li key={ingredient.articleId}>{formatIngredientLine(ingredient)}</li>
        ))}
      </ul>
    </section>
  );
}

export function ProductionBatchPrint({ data }: { data: BatchPrintData }) {
  const labels = buildPrintLabels(data);

  return (
    <div className="print-only">
      {labels.map((label) =>
        label.kind === 'PRODUIT' ? (
          <ProductLabel key={label.id} label={label} />
        ) : (
          <BatchingLabel key={label.id} label={label} />
        ),
      )}
    </div>
  );
}
