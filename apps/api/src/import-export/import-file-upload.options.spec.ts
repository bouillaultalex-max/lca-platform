import { resolveImportFileFormat } from './import-file-upload.options';

describe('import-file-upload.options — resolveImportFileFormat', () => {
  it('reconnaît .xlsx', () => {
    expect(resolveImportFileFormat('articles.xlsx')).toBe('xlsx');
  });

  it('reconnaît .csv', () => {
    expect(resolveImportFileFormat('stocks.csv')).toBe('csv');
  });

  it('est insensible à la casse de l’extension', () => {
    expect(resolveImportFileFormat('ARTICLES.XLSX')).toBe('xlsx');
  });

  it('rejette une extension non supportée', () => {
    expect(resolveImportFileFormat('malware.exe')).toBeNull();
    expect(resolveImportFileFormat('archive.zip')).toBeNull();
    expect(resolveImportFileFormat('script.sh')).toBeNull();
  });

  it('rejette un nom de fichier sans extension', () => {
    expect(resolveImportFileFormat('articles')).toBeNull();
  });
});
