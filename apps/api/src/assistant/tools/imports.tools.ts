import type { ImportLogsService } from '../../import-export/import-logs/import-logs.service';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import { GetImportHistoryInputDto } from './dto/get-import-history-input.dto';
import type { ToolDefinition } from './tool.types';

const DEFAULT_RESULTS_LIMIT = 10;

export interface ImportHistoryEntryToolResult {
  type: string;
  importedAt: Date;
  status: string;
  processedLines: number;
  errorCount: number;
}

export function createImportsTools(
  importLogsService: ImportLogsService,
): ToolDefinition[] {
  const getImportHistory: ToolDefinition<
    GetImportHistoryInputDto,
    ImportHistoryEntryToolResult[]
  > = {
    name: 'imports.getImportHistory',
    description:
      "Historique des imports OpenSi (type, date, statut, lignes traitées, nombre d'erreurs). Ne renvoie jamais le contenu des fichiers importés ni le détail technique des erreurs.",
    inputSchema: GetImportHistoryInputDto,
    // Écran fermé à DIRECTION/DAF, comme le reste des écrans d'import — voir
    // import-logs.controller.ts (@Roles(...FULL_ACCESS_ROLES)).
    permission: { kind: 'roles', roles: FULL_ACCESS_ROLES },
    category: 'read',
    handler: async (user, input) => {
      const logs = await importLogsService.findAll(user.siteId);
      const limit = input.limit ?? DEFAULT_RESULTS_LIMIT;

      return logs.slice(0, limit).map((log) => ({
        type: log.type,
        importedAt: log.importedAt,
        status: log.status,
        processedLines: log.processedLines,
        errorCount: log.errorCount,
      }));
    },
  };

  return [getImportHistory];
}
