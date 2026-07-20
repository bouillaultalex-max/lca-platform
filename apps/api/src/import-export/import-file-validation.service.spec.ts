import * as XLSX from 'xlsx';
import { BadRequestException } from '@nestjs/common';
import {
  ImportFileValidationService,
  looksLikePlainText,
} from './import-file-validation.service';

function buildValidXlsxBuffer(): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Reference', 'Designation'],
    ['ART-001', 'Article de test'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const VALID_CSV_BUFFER = Buffer.from(
  'Reference,Designation\nART-001,Article de test\n',
  'utf-8',
);

// Deux octets suffisent à identifier un exécutable Windows PE ("MZ") pour file-type ;
// le reste n'a pas besoin d'être un exécutable réellement fonctionnel pour ce test.
const EXECUTABLE_BUFFER = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
]);

// Binaire non identifiable (ni signature connue, ni texte décodable) : octet NUL +
// octets hors UTF-8 valide.
const UNKNOWN_BINARY_BUFFER = Buffer.from([
  0x00, 0xff, 0xfe, 0x13, 0x37, 0x00, 0xde, 0xad, 0xbe, 0xef,
]);

function file(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    buffer: Buffer.from(''),
    originalname: 'file.csv',
    mimetype: 'text/csv',
    ...overrides,
  } as Express.Multer.File;
}

describe('ImportFileValidationService', () => {
  const service = new ImportFileValidationService();

  it('accepte un fichier .xlsx valide (contenu réellement au format Office Open XML)', async () => {
    await expect(
      service.validate(
        file({ originalname: 'articles.xlsx', buffer: buildValidXlsxBuffer() }),
      ),
    ).resolves.toBeUndefined();
  });

  it('accepte un fichier .csv valide (texte brut)', async () => {
    await expect(
      service.validate(
        file({ originalname: 'stocks.csv', buffer: VALID_CSV_BUFFER }),
      ),
    ).resolves.toBeUndefined();
  });

  it('accepte un contenu valide même avec un Content-Type erroné (mimetype non fiable)', async () => {
    await expect(
      service.validate(
        file({
          originalname: 'articles.xlsx',
          buffer: buildValidXlsxBuffer(),
          mimetype: 'application/octet-stream',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('rejette un contenu invalide malgré un Content-Type correct (mimetype non fiable)', async () => {
    await expect(
      service.validate(
        file({
          originalname: 'articles.xlsx',
          buffer: EXECUTABLE_BUFFER,
          mimetype:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette une extension .xlsx valide dont le contenu réel est du texte brut', async () => {
    await expect(
      service.validate(
        file({ originalname: 'articles.xlsx', buffer: VALID_CSV_BUFFER }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette une extension .csv valide dont le contenu réel est un vrai .xlsx', async () => {
    await expect(
      service.validate(
        file({ originalname: 'stocks.csv', buffer: buildValidXlsxBuffer() }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette une extension non supportée', async () => {
    await expect(
      service.validate(
        file({ originalname: 'malware.exe', buffer: EXECUTABLE_BUFFER }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un exécutable renommé en .csv', async () => {
    await expect(
      service.validate(
        file({ originalname: 'stocks.csv', buffer: EXECUTABLE_BUFFER }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un exécutable renommé en .xlsx', async () => {
    await expect(
      service.validate(
        file({ originalname: 'articles.xlsx', buffer: EXECUTABLE_BUFFER }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un binaire non identifiable renommé en .csv', async () => {
    await expect(
      service.validate(
        file({ originalname: 'stocks.csv', buffer: UNKNOWN_BINARY_BUFFER }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un fichier vide', async () => {
    await expect(
      service.validate(file({ buffer: Buffer.alloc(0) })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ne divulgue pas le type réel détecté dans le message d'erreur", async () => {
    try {
      await service.validate(
        file({ originalname: 'stocks.csv', buffer: EXECUTABLE_BUFFER }),
      );
      throw new Error('devait rejeter');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const message = (error as BadRequestException).message;
      expect(message.toLowerCase()).not.toContain('exe');
      expect(message.toLowerCase()).not.toContain('file-type');
    }
  });
});

describe('looksLikePlainText', () => {
  it('accepte du texte UTF-8 imprimable', () => {
    expect(looksLikePlainText(VALID_CSV_BUFFER)).toBe(true);
  });

  it('rejette un contenu avec un octet NUL', () => {
    expect(looksLikePlainText(Buffer.from([0x61, 0x00, 0x62]))).toBe(false);
  });

  it('rejette un contenu non décodable en UTF-8', () => {
    expect(looksLikePlainText(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false);
  });
});
