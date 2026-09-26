import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type {
  Article,
  AuthenticatedUser,
  LotTraceability,
  LotTraceabilityAllocation,
  Market,
  Recipe,
  StockLot,
  StockLotTraceability,
} from '@lca-mes/shared';
import { TraceabilityPage } from './TraceabilityPage';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getLotTraceability: vi.fn(),
      getLotTraceabilityByNumber: vi.fn(),
      getStockLotTraceability: vi.fn(),
    },
  };
});

vi.mock('../auth/useAuth', () => ({
  useAuth: vi.fn(),
}));

import { api } from '../api/client';
import { useAuth } from '../auth/useAuth';

const currentUser: AuthenticatedUser = {
  id: 'user-1',
  siteId: 'site-1',
  fullName: 'Kevin Prian',
  email: 'kevin.prian@lca-mes.local',
  role: 'DIRECTION',
  jobTitle: null,
  isSystemAdmin: false,
  mustChangePassword: false,
  lastLoginAt: null,
};

function buildArticle(id: string, name: string): Article {
  return {
    id,
    type: 'PRODUIT_FINI',
    openSiReference: id.toUpperCase(),
    name,
    unitOfMeasure: 'unité',
    currentUnitCost: '0',
    unitsPerCarton: null,
    densityKgPerL: null,
    supplierId: null,
    productFamilyId: null,
    marketId: null,
    active: true,
  };
}

function buildRecipe(id: string, finishedProductId: string, version: number): Recipe {
  return { id, finishedProductId, format: 100, version, status: 'ACTIVE', lines: [] };
}

const productFr = buildArticle('pf-fr', 'Recharge Lavande FR');
const productCh = buildArticle('pf-ch', 'Recharge Lavande CH');
const recipeFr = buildRecipe('recipe-fr', productFr.id, 1);
const recipeCh = buildRecipe('recipe-ch', productCh.id, 2);
const marketFr: Market = { id: 'market-fr', code: 'FR', label: 'France', active: true };
const marketCh: Market = { id: 'market-ch', code: 'CH', label: 'Suisse', active: true };

const labelChStockLot: StockLot = {
  id: 'stock-lot-eti-ch',
  articleId: 'eti-ch',
  supplierLotNumber: 'FOURNISSEUR-ETI-CH',
  receivedQuantity: '500',
  remainingQuantity: '450',
  receivedAt: '2026-09-01T08:00:00.000Z',
  expiryDate: null,
};

/** Batch multi-marchés : la recette de référence du batch est toujours la recette FR. */
const referenceBatch = {
  id: 'batch-1',
  recipeId: recipeFr.id,
  machineId: 'machine-1',
  format: 100,
  plannedQuantity: 150,
  producedQuantity: 150,
  rejectedQuantity: 0,
  startedAt: '2026-09-26T08:00:00.000Z',
  endedAt: '2026-09-26T16:00:00.000Z',
  formatChanged: false,
  formatChangeDetail: null,
  status: 'TERMINE' as const,
  currentStep: 'CONDITIONNEMENT' as const,
  reservedLotNumber: '456149',
  reservedExpiryDate: '2029-09-26T08:00:00.000Z',
  createdAt: '2026-09-26T07:00:00.000Z',
  recipe: { ...recipeFr, finishedProduct: productFr },
};

function buildAllocation(
  id: string,
  product: Article,
  market: Market | null,
  recipe: Recipe,
): LotTraceabilityAllocation {
  return {
    id,
    batchId: referenceBatch.id,
    productId: product.id,
    recipeId: recipe.id,
    marketId: market?.id ?? null,
    plannedQuantity: 50,
    producedQuantity: 50,
    rejectedQuantity: 0,
    createdAt: '2026-09-26T07:00:00.000Z',
    product,
    market,
    recipe,
  };
}

function buildLot(
  id: string,
  allocation: LotTraceabilityAllocation | null,
  overrides: Partial<LotTraceability> = {},
): LotTraceability {
  return {
    id,
    batchId: referenceBatch.id,
    allocationId: allocation?.id ?? null,
    lotNumber: '456149',
    quantity: 50,
    manufacturedAt: '2026-09-26T16:00:00.000Z',
    expiryDate: '2029-09-26T08:00:00.000Z',
    qualityStatus: 'EN_ATTENTE',
    batch: referenceBatch,
    allocation,
    genealogyLines: [],
    ...overrides,
  };
}

const lotFr = buildLot('lot-fr', buildAllocation('alloc-fr', productFr, marketFr, recipeFr));
const lotCh = buildLot('lot-ch', buildAllocation('alloc-ch', productCh, marketCh, recipeCh), {
  genealogyLines: [
    {
      id: 'genealogy-ch',
      consumedQuantity: '50',
      consumedArticle: { ...buildArticle('eti-ch', 'Étiquette CH'), type: 'PACKAGING' },
      consumedStockLot: labelChStockLot,
    },
  ],
});

function renderPage(lotNumber = '456149') {
  return render(
    <MemoryRouter initialEntries={[`/traceability?lotNumber=${lotNumber}`]}>
      <Routes>
        <Route path="/traceability" element={<TraceabilityPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Carte `SectionCard` contenant un titre donné (titre → en-tête → carte). */
function cardOf(heading: HTMLElement): HTMLElement {
  return heading.parentElement!.parentElement!;
}

function infoValue(section: HTMLElement, label: string): string | null {
  const term = within(section).getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? null;
}

describe('TraceabilityPage — produit/marché/recette de l’allocation (bug D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: currentUser,
      token: 'fake-token',
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  it('batch multi-marchés : chaque lot affiche le produit, le marché et la recette de SON allocation', async () => {
    vi.mocked(api.getLotTraceabilityByNumber).mockResolvedValue([lotFr, lotCh]);

    renderPage();

    const sections = await screen.findAllByRole('heading', { name: 'Informations du lot' });
    expect(sections).toHaveLength(2);
    const [frSection, chSection] = sections.map(cardOf);

    expect(infoValue(frSection, 'Produit fini')).toBe('Recharge Lavande FR');
    expect(infoValue(frSection, 'Marché')).toBe('France');
    expect(infoValue(frSection, 'Recette')).toBe('Version 1 — Format 100 ml');

    // Situation précise du bug D2 : batch.recipe désigne le produit FR pour les
    // deux lots — le lot CH doit pourtant afficher le produit/la recette CH.
    expect(infoValue(chSection, 'Produit fini')).toBe('Recharge Lavande CH');
    expect(infoValue(chSection, 'Marché')).toBe('Suisse');
    expect(infoValue(chSection, 'Recette')).toBe('Version 2 — Format 100 ml');
  });

  it('lot historique sans allocation : conserve batch.recipe (produit, recette) et n’affiche aucun marché', async () => {
    vi.mocked(api.getLotTraceabilityByNumber).mockResolvedValue([buildLot('lot-historique', null)]);

    renderPage();

    const [heading] = await screen.findAllByRole('heading', { name: 'Informations du lot' });
    const section = cardOf(heading);
    expect(infoValue(section, 'Produit fini')).toBe('Recharge Lavande FR');
    expect(infoValue(section, 'Marché')).toBe('—');
    expect(infoValue(section, 'Recette')).toBe('Version 1 — Format 100 ml');
  });

  it('traçabilité inverse (lot fournisseur d’étiquettes CH) : le lot consommateur affiche le produit et le marché CH', async () => {
    vi.mocked(api.getLotTraceabilityByNumber).mockResolvedValue([lotCh]);
    const inverse: StockLotTraceability = {
      ...labelChStockLot,
      genealogyLines: [
        {
          id: 'genealogy-ch',
          lot: {
            id: lotCh.id,
            batchId: lotCh.batchId,
            allocationId: lotCh.allocationId,
            lotNumber: lotCh.lotNumber,
            quantity: lotCh.quantity,
            manufacturedAt: lotCh.manufacturedAt,
            expiryDate: lotCh.expiryDate,
            qualityStatus: lotCh.qualityStatus,
            batch: referenceBatch,
            allocation: lotCh.allocation,
          },
        },
      ],
    };
    vi.mocked(api.getStockLotTraceability).mockResolvedValue(inverse);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Lots consommateurs' }));

    const consumerTable = await screen.findByRole('columnheader', { name: 'Quantité produite' });
    const table = consumerTable.closest('table')!;
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    const [row] = within(table).getAllByRole('row').slice(1);
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent);

    expect(cells[headers.indexOf('Produit fini')]).toBe('Recharge Lavande CH');
    expect(cells[headers.indexOf('Marché')]).toBe('Suisse');
    expect(cells[headers.indexOf('Recette')]).toBe('Version 2 — Format 100 ml');
  });
});
