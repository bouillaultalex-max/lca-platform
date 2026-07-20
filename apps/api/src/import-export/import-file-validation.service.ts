import { BadRequestException, Injectable } from '@nestjs/common';
import { loadEsm } from 'load-esm';
import type { FileTypeResult } from 'file-type';
import { resolveImportFileFormat } from './import-file-upload.options';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Nombre d'octets initiaux inspectés pour distinguer texte et binaire — même
// convention que git/libmagic : un texte légitime ne contient jamais d'octet NUL
// dans ses premiers kilooctets, un binaire (exécutable, image, archive...) en
// contient presque toujours très tôt.
const TEXT_SNIFF_SAMPLE_SIZE = 8_000;

const GENERIC_XLSX_ERROR =
  'Le contenu du fichier ne correspond pas à un fichier Excel (.xlsx) valide.';
const GENERIC_CSV_ERROR =
  'Le contenu du fichier ne correspond pas à un fichier CSV valide.';

export function looksLikePlainText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, TEXT_SNIFF_SAMPLE_SIZE);
  if (sample.includes(0)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valide le contenu réel (magic bytes) d'un fichier d'import OpenSi, indépendamment de
 * son extension déclarée ou du Content-Type annoncé par le client — voir SEC-07. Ni
 * l'un ni l'autre n'est fiable : les deux sont fournis par le client et peuvent être
 * falsifiés sans effort.
 *
 * XLSX : signature fiable (format ZIP / Office Open XML). `file-type` (bibliothèque de
 * référence pour la détection de type par contenu — c'est celle que le validateur
 * intégré de NestJS utilise lui-même en interne) inspecte les octets et distingue un
 * vrai .xlsx d'un simple ZIP, d'une autre archive Office (.docx, .pptx) ou de tout
 * autre format binaire.
 *
 * CSV : aucun format texte brut ne possède de signature binaire — la présence ou
 * l'absence d'un nombre magique ne peut donc jamais, à elle seule, prouver qu'un
 * fichier "est" un CSV. Stratégie retenue, en deux temps :
 *   1. Si `file-type` reconnaît malgré tout un format binaire connu (exécutable,
 *      archive, PDF, image...), le fichier est rejeté sans ambiguïté : ce n'est jamais
 *      un CSV légitime, quelle que soit l'extension déclarée.
 *   2. Sinon, on vérifie qu'il s'agit bien de texte exploitable (aucun octet NUL dans
 *      l'échantillon initial, décodable en UTF-8) — heuristique standard texte/binaire,
 *      pas une preuve absolue de contenu "sûr". Un script texte (.sh, .py...) renommé
 *      en .csv passe cette étape : rien ne le distingue structurellement d'un CSV au
 *      niveau des octets. Cela reste sans risque pour ce pipeline, qui ne l'exécute
 *      jamais : le fichier n'est que parsé comme tableau (ImportParserService/SheetJS)
 *      puis revalidé ligne par ligne contre le schéma métier attendu (colonnes
 *      obligatoires, types de valeurs...), qui rejette en pratique tout contenu ne
 *      respectant pas ce format — voir ArticlesImportService.parseRow et équivalents.
 */
@Injectable()
export class ImportFileValidationService {
  async validate(file: Express.Multer.File): Promise<void> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Le fichier envoyé est vide.');
    }

    const format = resolveImportFileFormat(file.originalname);
    if (!format) {
      // Filet de sécurité : ne devrait jamais se produire en conditions normales,
      // IMPORT_FILE_UPLOAD_OPTIONS ayant déjà rejeté toute extension non supportée
      // avant que le contenu ne soit reçu.
      throw new BadRequestException('Format de fichier non supporté.');
    }

    const { fileTypeFromBuffer } =
      await loadEsm<typeof import('file-type')>('file-type');
    const detected: FileTypeResult | undefined = await fileTypeFromBuffer(
      file.buffer,
    );

    if (format === 'xlsx') {
      if (detected?.mime !== XLSX_MIME) {
        throw new BadRequestException(GENERIC_XLSX_ERROR);
      }
      return;
    }

    if (detected) {
      throw new BadRequestException(GENERIC_CSV_ERROR);
    }
    if (!looksLikePlainText(file.buffer)) {
      throw new BadRequestException(GENERIC_CSV_ERROR);
    }
  }
}
