import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ARTICLE_TYPE_LABELS, type Article, type Supplier } from '@lca-mes/shared';
import { matchesIngredientSearch } from '../utils/matchesIngredientSearch';

const MAX_VISIBLE_RESULTS = 50;

interface ArticleSearchSelectProps {
  /** Identifiant unique, requis pour des attributs ARIA valides quand plusieurs instances coexistent (une par ligne de recette). */
  id: string;
  articles: Article[];
  supplierById: Map<string, Supplier>;
  value: string;
  onChange: (articleId: string) => void;
}

function supplierNameFor(article: Article, supplierById: Map<string, Supplier>): string | null {
  if (!article.supplierId) return null;
  return supplierById.get(article.supplierId)?.name ?? null;
}

/**
 * Sélecteur d'ingrédient recherchable (retour Kevin — remplace le <select> natif des lignes de
 * recette, devenu peu utilisable avec plusieurs centaines d'articles). Recherche instantanée sur
 * désignation/référence/fournisseur, entièrement utilisable au clavier. Ne porte aucune logique
 * métier de filtrage : l'appelant transmet déjà la liste des articles éligibles (voir RecipesPage).
 */
export function ArticleSearchSelect({ id, articles, supplierById, value, onChange }: ArticleSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `${id}-listbox`;

  const selectedArticle = useMemo(() => articles.find((article) => article.id === value), [articles, value]);

  const closedDisplayText = useMemo(() => {
    if (!value) return '';
    if (selectedArticle) return `${selectedArticle.name} (${selectedArticle.openSiReference})`;
    return 'Article introuvable ou désactivé';
  }, [value, selectedArticle]);

  // Resynchronise le texte affiché sur la sélection dès que le champ n'est pas en cours
  // d'édition : couvre le montage initial, la reprise d'un brouillon (value change de
  // l'extérieur) et l'abandon d'une saisie (Échap ou perte de focus sans sélection).
  useEffect(() => {
    if (!isOpen) setInputValue(closedDisplayText);
  }, [closedDisplayText, isOpen]);

  const filtered = useMemo(
    () =>
      articles.filter((article) => matchesIngredientSearch(article, supplierNameFor(article, supplierById), inputValue)),
    [articles, inputValue, supplierById],
  );
  const visibleResults = filtered.slice(0, MAX_VISIBLE_RESULTS);
  const hiddenCount = filtered.length - visibleResults.length;

  function openWithEmptyQuery() {
    setIsOpen(true);
    setInputValue('');
    setHighlightedIndex(0);
  }

  function selectArticle(article: Article) {
    onChange(article.id);
    setIsOpen(false);
  }

  function clearSelection() {
    onChange('');
    openWithEmptyQuery();
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        event.preventDefault();
        openWithEmptyQuery();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, Math.max(visibleResults.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const article = visibleResults[highlightedIndex];
      if (article) selectArticle(article);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
    }
  }

  const activeOptionId =
    isOpen && visibleResults[highlightedIndex] ? `${listboxId}-option-${highlightedIndex}` : undefined;

  const inputClassName = [
    'w-full rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-1',
    value && !selectedArticle
      ? 'border-red-300 text-red-600 focus:border-red-400 focus:ring-red-400'
      : 'border-brand-border focus:border-brand focus:ring-brand',
    value ? 'pr-8' : '',
  ].join(' ');

  return (
    <div className="relative flex-1">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-label="Article"
          autoComplete="off"
          value={inputValue}
          placeholder="Rechercher un ingrédient…"
          onFocus={() => {
            if (!isOpen) openWithEmptyQuery();
          }}
          onClick={() => {
            if (!isOpen) openWithEmptyQuery();
          }}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => setIsOpen(false)}
          className={inputClassName}
        />
        {value && (
          <button
            type="button"
            aria-label="Effacer la sélection"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearSelection}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand"
          >
            ×
          </button>
        )}
      </div>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-brand-border bg-white shadow-lg"
        >
          {visibleResults.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500">Aucun ingrédient ne correspond à votre recherche.</li>
          )}
          {visibleResults.map((article, index) => {
            const supplierName = supplierNameFor(article, supplierById);
            return (
              <li
                key={article.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectArticle(article)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`cursor-pointer px-3 py-2 text-sm ${index === highlightedIndex ? 'bg-brand/10' : ''}`}
              >
                <div className="font-medium text-gray-900">{article.name}</div>
                <div className="text-xs text-gray-500">
                  {article.openSiReference} · {ARTICLE_TYPE_LABELS[article.type]}
                  {supplierName ? ` · ${supplierName}` : ''}
                </div>
              </li>
            );
          })}
          {hiddenCount > 0 && (
            <li className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400">
              et {hiddenCount} de plus — affinez votre recherche
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
