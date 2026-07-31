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

function buildMultiSheetXlsxBuffer(
  sheets: { name: string; rows: Record<string, string | number | null>[] }[],
): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
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

  it('sans nom de feuille demandé, utilise la première feuille du classeur (comportement historique inchangé)', () => {
    const buffer = buildMultiSheetXlsxBuffer([
      { name: 'Première feuille', rows: [{ reference: 'PREMIERE-1' }] },
      { name: 'Seconde feuille', rows: [{ reference: 'SECONDE-1' }] },
    ]);

    const rows = service.parse(buffer, 'classeur.xlsx');

    expect(rows).toEqual([{ line: 2, data: { reference: 'PREMIERE-1' } }]);
  });

  it('avec un nom de feuille demandé correspondant exactement, utilise uniquement cette feuille', () => {
    const buffer = buildMultiSheetXlsxBuffer([
      { name: 'Première feuille', rows: [{ reference: 'PREMIERE-1' }] },
      {
        name: '🗂 Aromatèque Complète',
        rows: [{ reference: 'AROMA-1' }, { reference: 'AROMA-2' }],
      },
    ]);

    const rows = service.parse(
      buffer,
      'classeur.xlsx',
      '🗂 Aromatèque Complète',
    );

    expect(rows).toEqual([
      { line: 2, data: { reference: 'AROMA-1' } },
      { line: 3, data: { reference: 'AROMA-2' } },
    ]);
  });

  it('rejette un nom de feuille demandé inexistant, sans jamais basculer sur la première feuille', () => {
    const buffer = buildMultiSheetXlsxBuffer([
      { name: 'Première feuille', rows: [{ reference: 'PREMIERE-1' }] },
      { name: 'Seconde feuille', rows: [{ reference: 'SECONDE-1' }] },
    ]);

    expect(() =>
      service.parse(buffer, 'classeur.xlsx', 'Feuille inexistante'),
    ).toThrow(BadRequestException);
    expect(() =>
      service.parse(buffer, 'classeur.xlsx', 'Feuille inexistante'),
    ).toThrow(/Feuille inexistante/);
  });

  it('non-régression CSV : sans nom de feuille demandé, comportement inchangé', () => {
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

  it('CSV : un nom de feuille demandé qui ne correspond pas à la feuille unique générée ("Sheet1") est refusé, jamais ignoré silencieusement', () => {
    const buffer = Buffer.from('reference,libelle\nART-1,Article un\n', 'utf8');

    expect(() =>
      service.parse(buffer, 'articles.csv', '🗂 Aromatèque Complète'),
    ).toThrow(BadRequestException);
  });

  it('CSV : un nom de feuille demandé qui correspond à la feuille unique générée ("Sheet1") est accepté', () => {
    const buffer = Buffer.from('reference,libelle\nART-1,Article un\n', 'utf8');

    const rows = service.parse(buffer, 'articles.csv', 'Sheet1');

    expect(rows).toEqual([
      { line: 2, data: { reference: 'ART-1', libelle: 'Article un' } },
    ]);
  });
});
