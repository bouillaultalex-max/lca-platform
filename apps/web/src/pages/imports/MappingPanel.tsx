import { useMemo } from 'react';
import type { ColumnMappingSuggestion, MappingCorrection } from '@lca-mes/shared';
import { describeRecognizedField } from './importFormatting';

const selectClass =
  'w-full rounded-md border border-divider px-2 py-1.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy';

interface MappingPanelProps {
  mapping: ColumnMappingSuggestion;
  pendingCorrections: MappingCorrection[];
  onApplyCorrection: (fieldKey: string, columnName: string) => void;
}

/**
 * Affiche ce que le logiciel a compris du fichier, en langage naturel : jamais les
 * mots "mapping", "correspondance", "confiance" ou "score" (décision validée le
 * 2026-07-07) — uniquement "colonnes reconnues / à vérifier / non utilisées".
 */
export function MappingPanel({ mapping, pendingCorrections, onApplyCorrection }: MappingPanelProps) {
  const allColumns = useMemo(() => {
    const fromFields = mapping.fields
      .map((field) => field.columnName)
      .filter((name): name is string => name !== null);
    return Array.from(new Set([...fromFields, ...mapping.ignoredColumns])).sort((a, b) =>
      a.localeCompare(b, 'fr'),
    );
  }, [mapping]);

  const recognizedFields = mapping.fields.filter((field) => field.columnName !== null);
  const fieldsToCheck = mapping.fields.filter((field) => field.columnName === null);

  function currentSelection(fieldKey: string, fallback: string | null): string {
    return pendingCorrections.find((correction) => correction.fieldKey === fieldKey)?.columnName ?? fallback ?? '';
  }

  return (
    <div className="space-y-6">
      {recognizedFields.length > 0 && (
        <section className="rounded-xl border border-divider bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Colonnes reconnues</h3>
          <p className="mt-1 text-xs text-gray-500">
            Voici comment le logiciel a compris votre fichier. Corrigez uniquement si besoin.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Champ</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Colonne de votre fichier</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Comment il l'a reconnue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recognizedFields.map((field) => (
                  <tr key={field.fieldKey}>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {field.label}
                      {field.required && <span className="ml-1 text-red-500">*</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={selectClass}
                        value={currentSelection(field.fieldKey, field.columnName)}
                        onChange={(event) => onApplyCorrection(field.fieldKey, event.target.value)}
                      >
                        {allColumns.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{describeRecognizedField(field)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {fieldsToCheck.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">Colonnes à vérifier</h3>
          <p className="mt-1 text-xs text-amber-800">
            Le logiciel n'a pas trouvé automatiquement de colonne pour ces champs. Choisissez-la vous-même si
            elle existe dans le fichier.
          </p>
          <ul className="mt-3 space-y-3">
            {fieldsToCheck.map((field) => {
              const hint = mapping.hints.find((h) => h.fieldKey === field.fieldKey);
              return (
                <li key={field.fieldKey} className="rounded-md border border-amber-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      {field.label}
                      {field.required && <span className="ml-1 text-red-500">*</span>}
                    </span>
                    <select
                      className={`${selectClass} max-w-xs`}
                      value={currentSelection(field.fieldKey, null)}
                      onChange={(event) => onApplyCorrection(field.fieldKey, event.target.value)}
                    >
                      <option value="" disabled>
                        Choisir une colonne…
                      </option>
                      {allColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>
                  {hint && (
                    <p className="mt-2 text-xs text-amber-800">
                      💡 La colonne « {hint.suggestedColumnName} » pourrait convenir.{' '}
                      <button
                        type="button"
                        className="font-medium text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                        onClick={() => onApplyCorrection(field.fieldKey, hint.suggestedColumnName)}
                      >
                        Utiliser cette colonne
                      </button>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {mapping.ignoredColumns.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700">Colonnes non utilisées</h3>
          <p className="mt-1 text-xs text-gray-500">
            Ces colonnes de votre fichier ne seront pas utilisées pour cet import.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {mapping.ignoredColumns.map((column) => (
              <span key={column} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {column}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
