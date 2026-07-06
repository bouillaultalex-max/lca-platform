import * as XLSX from 'xlsx';
import { BadRequestException } from '@nestjs/common';
import { ImportParserService } from './import-parser.service';

function buildXlsxBuffer(
  rows: Record<string, string | number | null>[],
): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Feuille1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('ImportParserService', () => {
  const service = new ImportParserService();

  it('parse un fichier xlsx avec en-têtes et lignes de données', () => {
    const buffer = buildXlsxBuffer([
      { reference: 'ART-1', libelle: 'Article un' },
      { reference: 'ART-2', libelle: 'Article deux' },
    ]);

    const rows = service.parse(buffer, 'articles.xlsx');

    expect(rows).toEqual([
      { line: 2, data: { reference: 'ART-1', libelle: 'Article un' } },
      { line: 3, data: { reference: 'ART-2', libelle: 'Article deux' } },
    ]);
  });

  it('parse un fichier csv avec en-têtes et lignes de données', () => {
    const buffer = Buffer.from(
      'reference,libelle\nART-1,Article un\nART-2,Article deux\n',
      'utf8',
    );

    const rows = service.parse(buffer, 'articles.csv');

    expect(rows).toEqual([
      { line: 2, data: { reference: 'ART-1', libelle: 'Article un' } },
      { line: 3, data: { reference: 'ART-2', libelle: 'Article deux' } },
    ]);
  });

  it('ignore les lignes entièrement vides', () => {
    const buffer = Buffer.from(
      'reference,libelle\nART-1,Article un\n,\nART-2,Article deux\n',
      'utf8',
    );

    const rows = service.parse(buffer, 'articles.csv');

    expect(rows.map((row) => row.data.reference)).toEqual(['ART-1', 'ART-2']);
  });

  it('rejette un fichier vide', () => {
    expect(() => service.parse(Buffer.alloc(0), 'vide.xlsx')).toThrow(
      BadRequestException,
    );
  });

  it('rejette un fichier sans en-têtes ni lignes de données', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Feuille1');
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    expect(() => service.parse(buffer, 'sans-entetes.xlsx')).toThrow(
      BadRequestException,
    );
  });

  it('rejette un fichier corrompu', () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]);

    expect(() => service.parse(buffer, 'corrompu.xlsx')).toThrow(
      BadRequestException,
    );
  });
});
