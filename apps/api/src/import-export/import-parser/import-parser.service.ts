import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

/**
 * Une ligne de données issue d'un fichier importé (Excel ou CSV).
 * `line` correspond au numéro de ligne dans le tableur (en-têtes = ligne 1),
 * pour que les erreurs de validation métier (E5+) restent repérables par
 * l'utilisateur dans son fichier d'origine.
 */
export interface ParsedRow {
  line: number;
  data: Record<string, string | number | boolean | null>;
}

/**
 * Seul point d'accès à la bibliothèque `xlsx` (SheetJS) dans tout le projet
 * (voir docs/architecture.md — encapsulation demandée pour pouvoir remplacer
 * la bibliothèque plus tard sans impacter les modules métier). Ne contient
 * aucune logique métier : uniquement la conversion fichier → lignes brutes.
 */
@Injectable()
export class ImportParserService {
  parse(buffer: Buffer, fileName: string): ParsedRow[] {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException(
        `Le fichier "${fileName}" est vide ou illisible.`,
      );
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
    } catch {
      throw new BadRequestException(
        `Le fichier "${fileName}" est illisible ou corrompu.`,
      );
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException(
        `Le fichier "${fileName}" ne contient aucune feuille exploitable.`,
      );
    }

    const rows = XLSX.utils.sheet_to_json<
      Record<string, string | number | boolean | null>
    >(workbook.Sheets[sheetName], { defval: null, raw: true });

    if (rows.length === 0) {
      throw new BadRequestException(
        `Le fichier "${fileName}" ne contient aucune ligne de données (en-têtes manquants ou fichier vide).`,
      );
    }

    return rows
      .map((data, index) => ({
        // Ligne 1 = en-têtes, les données commencent en ligne 2 dans le tableur d'origine.
        line: index + 2,
        data,
      }))
      .filter((row) =>
        Object.values(row.data).some((value) => value !== null && value !== ''),
      );
  }
}
