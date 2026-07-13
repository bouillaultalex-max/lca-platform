import { Fragment, useState } from 'react';
import { IMPORT_TYPE_LABELS, IMPORT_STATUS_LABELS, type ImportLog, type ImportStatus, type ImportType } from '@lca-mes/shared';
import { formatImportDate } from './importFormatting';

const STATUS_BADGE_CLASSES: Record<ImportStatus, string> = {
  PREVISUALISE: 'bg-gray-100 text-gray-600',
  VALIDE: 'bg-green-50 text-green-700',
  ERREUR: 'bg-red-50 text-red-700',
};

function StatusBadge({ status }: { status: ImportStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
      {IMPORT_STATUS_LABELS[status]}
    </span>
  );
}

export function ImportHistoryPanel({
  logs,
  isLoading,
  typeFilter,
  onTypeFilterChange,
}: {
  logs: ImportLog[];
  isLoading: boolean;
  typeFilter: ImportType | '';
  onTypeFilterChange: (value: ImportType | '') => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <select
        value={typeFilter}
        onChange={(event) => onTypeFilterChange(event.target.value as ImportType | '')}
        className="rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      >
        <option value="">Tous les types</option>
        {(Object.entries(IMPORT_TYPE_LABELS) as [ImportType, string][]).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Fichier</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Statut</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Lignes traitées</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Erreurs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                  Chargement…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                  Aucun import pour l'instant.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <Fragment key={log.id}>
                  <tr
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => log.errorCount > 0 && setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td className="px-3 py-2">{IMPORT_TYPE_LABELS[log.type]}</td>
                    <td className="px-3 py-2">{log.fileName}</td>
                    <td className="px-3 py-2">{formatImportDate(log.importedAt)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-3 py-2">{log.processedLines}</td>
                    <td className="px-3 py-2">
                      {log.errorCount > 0 ? (
                        <span className="text-red-600">
                          {log.errorCount} {expandedId === log.id ? '▲' : '▼'}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                  </tr>
                  {expandedId === log.id && log.errorDetails && (
                    <tr>
                      <td colSpan={6} className="bg-red-50/50 px-4 py-3">
                        <ul className="space-y-1 text-xs text-red-800">
                          {log.errorDetails.map((detail, index) => (
                            <li key={index}>
                              Ligne {detail.line} : {detail.message}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
