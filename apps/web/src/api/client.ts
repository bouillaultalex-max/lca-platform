import type {
  LoginRequest,
  LoginResponse,
  AuthenticatedUser,
  Article,
  ArticleType,
  CreateArticleRequest,
  Machine,
  Recipe,
  CreateRecipeRequest,
  StockItem,
  StockLot,
  StockMovement,
  CreateStockLotRequest,
  AdjustStockLotRequest,
  UpdateMinimumThresholdRequest,
  Batch,
  CreateBatchRequest,
  IngredientQuantity,
  BatchStop,
  CreateBatchStopRequest,
  EndBatchStopRequest,
  CloseBatchRequest,
  BatchClosureResult,
} from '@lca-mes/shared';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ErrorBody {
  message?: string | string[];
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });

  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as ErrorBody;
      if (body.message) {
        message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
      }
    } catch {
      // Corps de réponse non-JSON : on garde le message générique.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  login: (payload: LoginRequest): Promise<LoginResponse> =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  me: (token: string): Promise<AuthenticatedUser> => request<AuthenticatedUser>('/auth/me', {}, token),

  listArticles: (token: string, type?: ArticleType): Promise<Article[]> =>
    request<Article[]>(`/catalog/articles${type ? `?type=${type}` : ''}`, {}, token),

  createArticle: (token: string, payload: CreateArticleRequest): Promise<Article> =>
    request<Article>('/catalog/articles', { method: 'POST', body: JSON.stringify(payload) }, token),

  deactivateArticle: (token: string, id: string): Promise<Article> =>
    request<Article>(`/catalog/articles/${id}`, { method: 'DELETE' }, token),

  listRecipesByProduct: (token: string, finishedProductId: string): Promise<Recipe[]> =>
    request<Recipe[]>(`/catalog/recipes?finishedProductId=${finishedProductId}`, {}, token),

  getRecipe: (token: string, id: string): Promise<Recipe> => request<Recipe>(`/catalog/recipes/${id}`, {}, token),

  createRecipe: (token: string, payload: CreateRecipeRequest): Promise<Recipe> =>
    request<Recipe>('/catalog/recipes', { method: 'POST', body: JSON.stringify(payload) }, token),

  archiveRecipe: (token: string, id: string): Promise<Recipe> =>
    request<Recipe>(`/catalog/recipes/${id}`, { method: 'DELETE' }, token),

  listStockItems: (token: string, type?: ArticleType): Promise<StockItem[]> =>
    request<StockItem[]>(`/stock/items${type ? `?type=${type}` : ''}`, {}, token),

  updateMinimumThreshold: (
    token: string,
    articleId: string,
    payload: UpdateMinimumThresholdRequest,
  ): Promise<StockItem> =>
    request<StockItem>(`/stock/items/${articleId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  listStockLotsByArticle: (token: string, articleId: string): Promise<StockLot[]> =>
    request<StockLot[]>(`/stock/lots?articleId=${articleId}`, {}, token),

  receiveStockLot: (token: string, payload: CreateStockLotRequest): Promise<StockLot> =>
    request<StockLot>('/stock/lots', { method: 'POST', body: JSON.stringify(payload) }, token),

  adjustStockLot: (token: string, stockLotId: string, payload: AdjustStockLotRequest): Promise<StockLot> =>
    request<StockLot>(`/stock/lots/${stockLotId}/adjustments`, { method: 'POST', body: JSON.stringify(payload) }, token),

  listStockMovementsByLot: (token: string, stockLotId: string): Promise<StockMovement[]> =>
    request<StockMovement[]>(`/stock/movements?stockLotId=${stockLotId}`, {}, token),

  listMachines: (token: string): Promise<Machine[]> => request<Machine[]>('/catalog/machines', {}, token),

  listBatches: (token: string): Promise<Batch[]> => request<Batch[]>('/batching/batches', {}, token),

  getBatchPreparation: (token: string, recipeId: string, quantity: number): Promise<IngredientQuantity[]> =>
    request<IngredientQuantity[]>(
      `/batching/batches/preparation?recipeId=${recipeId}&quantity=${quantity}`,
      {},
      token,
    ),

  createBatch: (token: string, payload: CreateBatchRequest): Promise<Batch> =>
    request<Batch>('/batching/batches', { method: 'POST', body: JSON.stringify(payload) }, token),

  advanceBatchStep: (token: string, batchId: string): Promise<Batch> =>
    request<Batch>(`/production/batches/${batchId}/advance-step`, { method: 'POST' }, token),

  listBatchStops: (token: string, batchId: string): Promise<BatchStop[]> =>
    request<BatchStop[]>(`/production/batches/${batchId}/stops`, {}, token),

  startBatchStop: (token: string, batchId: string, payload: CreateBatchStopRequest): Promise<BatchStop> =>
    request<BatchStop>(`/production/batches/${batchId}/stops`, { method: 'POST', body: JSON.stringify(payload) }, token),

  endBatchStop: (token: string, stopId: string, payload: EndBatchStopRequest): Promise<BatchStop> =>
    request<BatchStop>(`/production/stops/${stopId}/end`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  closeBatch: (token: string, batchId: string, payload: CloseBatchRequest): Promise<BatchClosureResult> =>
    request<BatchClosureResult>(`/production/batches/${batchId}/close`, { method: 'POST', body: JSON.stringify(payload) }, token),
};
