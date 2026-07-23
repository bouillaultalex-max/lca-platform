import { searchArticlesByQuery } from './article-search.util';

interface Sample {
  article: { name: string; openSiReference: string };
  value: number;
}

function buildItem(
  name: string,
  openSiReference: string,
  value: number,
): Sample {
  return { article: { name, openSiReference }, value };
}

describe('searchArticlesByQuery', () => {
  const items: Sample[] = [
    buildItem('Flacon 100ml ambré', 'FLA-100-AMB', 1),
    buildItem('Flacon 50ml transparent', 'FLA-050-TRA', 2),
    buildItem('Bouchon compte-gouttes', 'BOU-CG-001', 3),
    buildItem('Étiquette premium', 'ETI-PREM-01', 4),
  ];

  it('trouve les articles dont le nom contient la requête, insensible à la casse', () => {
    const result = searchArticlesByQuery(items, 'flacon', 10);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.value)).toEqual([1, 2]);
  });

  it('trouve les articles par référence OpenSi', () => {
    const result = searchArticlesByQuery(items, 'BOU-CG', 10);

    expect(result).toEqual([items[2]]);
  });

  it('ignore les accents (recherche "etiquette" trouve "Étiquette")', () => {
    const result = searchArticlesByQuery(items, 'etiquette', 10);

    expect(result).toEqual([items[3]]);
  });

  it('retourne un tableau vide si la requête est vide ou blanche', () => {
    expect(searchArticlesByQuery(items, '', 10)).toEqual([]);
    expect(searchArticlesByQuery(items, '   ', 10)).toEqual([]);
  });

  it('retourne un tableau vide si aucun article ne correspond', () => {
    expect(searchArticlesByQuery(items, 'inexistant', 10)).toEqual([]);
  });

  it('respecte la limite fournie', () => {
    const result = searchArticlesByQuery(items, 'a', 1);

    expect(result).toHaveLength(1);
  });

  it('ne modifie pas le tableau d’entrée (fonction pure)', () => {
    const copy = [...items];
    searchArticlesByQuery(items, 'flacon', 10);

    expect(items).toEqual(copy);
  });
});
