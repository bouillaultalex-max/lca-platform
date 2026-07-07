import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo — largement suffisant pour un fichier d'import OpenSi
const ALLOWED_FILE_EXTENSIONS = /\.(xlsx|csv)$/i;

/**
 * Options `FileInterceptor` partagées par tous les imports OpenSi (whitelist
 * d'extension + limite de taille) — un seul endroit à ajuster si ces contraintes
 * évoluent, plutôt qu'une copie par type d'import.
 */
export const IMPORT_FILE_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_FILE_EXTENSIONS.test(file.originalname)) {
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
