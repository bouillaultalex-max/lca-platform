import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo — largement suffisant pour un fichier d'import OpenSi

export type ImportFileFormat = 'xlsx' | 'csv';

const FORMAT_BY_EXTENSION: Record<string, ImportFileFormat> = {
  xlsx: 'xlsx',
  csv: 'csv',
};

/**
 * Déduit le format déclaré d'un fichier d'import à partir de son extension, ou `null`
 * si elle n'est pas supportée. Utilisé à la fois par le filtre Multer ci-dessous (rejet
 * précoce, avant réception du contenu) et par `ImportFileValidationService` (validation
 * du contenu réel une fois le fichier reçu — voir SEC-07). Ne préjuge en rien du contenu
 * réel du fichier : une extension correcte n'est qu'une déclaration, pas une preuve.
 */
export function resolveImportFileFormat(
  originalName: string,
): ImportFileFormat | null {
  const match = /\.([a-z0-9]+)$/i.exec(originalName);
  const extension = match?.[1]?.toLowerCase();
  return extension ? (FORMAT_BY_EXTENSION[extension] ?? null) : null;
}

/**
 * Options `FileInterceptor` partagées par tous les imports OpenSi (whitelist
 * d'extension + limite de taille) — un seul endroit à ajuster si ces contraintes
 * évoluent, plutôt qu'une copie par type d'import. Ce filtre ne porte que sur
 * l'extension déclarée (rejet précoce, bon marché, avant même que le contenu ne soit
 * reçu) : la validation du contenu réel (magic bytes) a lieu séparément, une fois le
 * fichier entièrement reçu — voir ImportFileValidationService (SEC-07).
 */
export const IMPORT_FILE_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!resolveImportFileFormat(file.originalname)) {
      callback(
        new BadRequestException(
          'Seuls les fichiers .xlsx et .csv sont acceptés.',
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
};
