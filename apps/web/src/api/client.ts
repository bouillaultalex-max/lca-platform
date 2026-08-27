import type {
  LoginRequest,
  LoginResponse,
  AuthenticatedUser,
  Article,
  ArticleType,
  CreateArticleRequest,
  UpdateArticleRequest,
  Machine,
  CreateMachineRequest,
  UpdateMachineRequest,
  Supplier,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  Market,
  CreateMarketRequest,
  UpdateMarketRequest,
  ProductFamily,
  CreateProductFamilyRequest,
  UpdateProductFamilyRequest,
  Recipe,
  CreateRecipeRequest,
  RecipeDraft,
  SaveRecipeDraftRequest,
  StockItem,
  StockLot,
  StockMovement,
  CreateStockLotRequest,
  AdjustStockLotRequest,
  UpdateMinimumThresholdRequest,
  Batch,
  CreateBatchRequest,
  IngredientQuantity,
  BatchFeasibilityReport,
  BatchStop,
  CreateBatchStopRequest,
  EndBatchStopRequest,
  CloseBatchRequest,
  BatchClosureResult,
  BatchPrintData,
  BatchProductAllocation,
  AddBatchProductAllocationRequest,
  ImportType,
  ImportLog,
  MappingCorrection,
  ArticleImportRow,
  ArticlesImportPreviewResult,
  ArticlesImportConfirmResult,
  StockImportRow,
  StocksImportPreviewResult,
  StocksImportConfirmResult,
  ExpectedRequirementImportRow,
  ExpectedRequirementsImportPreviewResult,
  ExpectedRequirementsImportConfirmResult,
  InventoryImportPreviewResult,
  ChangePasswordRequest,
  JobTitle,
  CreateJobTitleRequest,
  UpdateJobTitleRequest,
  UserAdminView,
  CreateUserRequest,
  UpdateUserRequest,
  CreatedUserResult,
  Feedback,
  CreateFeedbackRequest,
  DashboardSummary,
  ResetPasswordResponse,
  LotTraceability,
  StockLotTraceability,
  AromaSamplesQuery,
  PaginatedAromaSamples,
  AromaSampleDetailResponse,
  AromaSamplesImportPreviewResult,
  AromaSamplesImportConfirmResult,
  AromaSampleImportRow,
} from '@lca-mes/shared';

export class ApiError extends Error {
  readonly status: number;
  /** Code machine-readable optionnel (ex: 'PASSWORD_CHANGE_REQUIRED'), voir backend. */
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  message?: string | string[];
  error?: string;
}

async function throwIfError(response: Response): Promise<void> {
  if (response.ok) return;
  let message = `Erreur ${response.status}`;
  let code: string | undefined;
  try {
    const body = (await response.json()) as ErrorBody;
    if (body.message) {
      message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    }
    code = body.error;
  } catch {
    // Corps de réponse non-JSON : on garde le message générique.
  }
  throw new ApiError(response.status, message, code);
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });
  await throwIfError(response);

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Envoi multipart/form-data (upload de fichier) : ne fixe jamais `Content-Type`
 * soi-même, pour laisser le navigateur poser la frontière multipart.
 */
async function requestMultipart<T>(path: string, formData: FormData, token: string): Promise<T> {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(path, { method: 'POST', headers, body: formData });
  await throwIfError(response);

  return (await response.json()) as T;
}

/** Construit la chaîne de requête `GET /rnd/aroma-samples` — omet tout paramètre absent. */
function buildAromaSamplesQueryString(query?: AromaSamplesQuery): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.search) params.set('search', query.search);
  if (query.category) params.set('category', query.category);
  if (query.active !== undefined) params.set('active', String(query.active));
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

function buildImportFormData(file: File, mappingCorrections?: MappingCorrection[]): FormData {
  const formData = new FormData();
  formData.append('file', file);
  if (mappingCorrections && mappingCorrections.length > 0) {
    formData.append('mappingCorrections', JSON.stringify(mappingCorrections));
  }
  return formData;
}

export const api = {
  login: (payload: LoginRequest): Promise<LoginResponse> =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  me: (token: string): Promise<AuthenticatedUser> => request<AuthenticatedUser>('/auth/me', {}, token),

  changePassword: (token: string, payload: ChangePasswordRequest): Promise<{ success: true }> =>
    request<{ success: true }>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }, token),

  listJobTitles: (token: string): Promise<JobTitle[]> => request<JobTitle[]>('/auth/job-titles', {}, token),

  createJobTitle: (token: string, payload: CreateJobTitleRequest): Promise<JobTitle> =>
    request<JobTitle>('/auth/job-titles', { method: 'POST', body: JSON.stringify(payload) }, token),

  updateJobTitle: (token: string, id: string, payload: UpdateJobTitleRequest): Promise<JobTitle> =>
    request<JobTitle>(`/auth/job-titles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deactivateJobTitle: (token: string, id: string): Promise<JobTitle> =>
    request<JobTitle>(`/auth/job-titles/${id}`, { method: 'DELETE' }, token),

  reactivateJobTitle: (token: string, id: string): Promise<JobTitle> =>
    request<JobTitle>(`/auth/job-titles/${id}/reactivate`, { method: 'POST' }, token),

  listUsers: (token: string): Promise<UserAdminView[]> => request<UserAdminView[]>('/auth/users', {}, token),

  createUser: (token: string, payload: CreateUserRequest): Promise<CreatedUserResult> =>
    request<CreatedUserResult>('/auth/users', { method: 'POST', body: JSON.stringify(payload) }, token),

  updateUser: (token: string, id: string, payload: UpdateUserRequest): Promise<UserAdminView> =>
    request<UserAdminView>(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deactivateUser: (token: string, id: string): Promise<UserAdminView> =>
    request<UserAdminView>(`/auth/users/${id}`, { method: 'DELETE' }, token),

  reactivateUser: (token: string, id: string): Promise<UserAdminView> =>
    request<UserAdminView>(`/auth/users/${id}/reactivate`, { method: 'POST' }, token),

  resetUserPassword: (token: string, id: string): Promise<ResetPasswordResponse> =>
    request<ResetPasswordResponse>(`/auth/users/${id}/reset-password`, { method: 'POST' }, token),

  listArticles: (token: string, type?: ArticleType): Promise<Article[]> =>
    request<Article[]>(`/catalog/articles${type ? `?type=${type}` : ''}`, {}, token),

  createArticle: (token: string, payload: CreateArticleRequest): Promise<Article> =>
    request<Article>('/catalog/articles', { method: 'POST', body: JSON.stringify(payload) }, token),

  updateArticle: (token: string, id: string, payload: UpdateArticleRequest): Promise<Article> =>
    request<Article>(`/catalog/articles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deactivateArticle: (token: string, id: string): Promise<Article> =>
    request<Article>(`/catalog/articles/${id}`, { method: 'DELETE' }, token),

  listRecipesByProduct: (token: string, finishedProductId: string): Promise<Recipe[]> =>
    request<Recipe[]>(`/catalog/recipes?finishedProductId=${finishedProductId}`, {}, token),

  getRecipe: (token: string, id: string): Promise<Recipe> => request<Recipe>(`/catalog/recipes/${id}`, {}, token),

  createRecipe: (token: string, payload: CreateRecipeRequest): Promise<Recipe> =>
    request<Recipe>('/catalog/recipes', { method: 'POST', body: JSON.stringify(payload) }, token),

  archiveRecipe: (token: string, id: string): Promise<Recipe> =>
    request<Recipe>(`/catalog/recipes/${id}`, { method: 'DELETE' }, token),

  /** `undefined` (204) signifie qu'aucun brouillon n'existe pour ce produit — état normal. */
  getRecipeDraft: (token: string, finishedProductId: string): Promise<RecipeDraft | undefined> =>
    request<RecipeDraft | undefined>(
      `/catalog/recipes/drafts?finishedProductId=${finishedProductId}`,
      {},
      token,
    ),

  /**
   * `keepalive` permet à la requête de survivre à une navigation/fermeture d'onglet
   * (autosave déclenché juste avant que la page se ferme) — voir hook d'autosave.
   */
  saveRecipeDraft: (
    token: string,
    payload: SaveRecipeDraftRequest,
    opts?: { keepalive?: boolean },
  ): Promise<RecipeDraft> =>
    request<RecipeDraft>(
      '/catalog/recipes/drafts',
      { method: 'PUT', body: JSON.stringify(payload), keepalive: opts?.keepalive },
      token,
    ),

  deleteRecipeDraft: (token: string, id: string): Promise<void> =>
    request<void>(`/catalog/recipes/drafts/${id}`, { method: 'DELETE' }, token),

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

  createMachine: (token: string, payload: CreateMachineRequest): Promise<Machine> =>
    request<Machine>('/catalog/machines', { method: 'POST', body: JSON.stringify(payload) }, token),

  updateMachine: (token: string, id: string, payload: UpdateMachineRequest): Promise<Machine> =>
    request<Machine>(`/catalog/machines/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deactivateMachine: (token: string, id: string): Promise<Machine> =>
    request<Machine>(`/catalog/machines/${id}`, { method: 'DELETE' }, token),

  listSuppliers: (token: string): Promise<Supplier[]> => request<Supplier[]>('/catalog/suppliers', {}, token),

  createSupplier: (token: string, payload: CreateSupplierRequest): Promise<Supplier> =>
    request<Supplier>('/catalog/suppliers', { method: 'POST', body: JSON.stringify(payload) }, token),

  updateSupplier: (token: string, id: string, payload: UpdateSupplierRequest): Promise<Supplier> =>
    request<Supplier>(`/catalog/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deactivateSupplier: (token: string, id: string): Promise<Supplier> =>
    request<Supplier>(`/catalog/suppliers/${id}`, { method: 'DELETE' }, token),

  listMarkets: (token: string): Promise<Market[]> => request<Market[]>('/catalog/markets', {}, token),

  createMarket: (token: string, payload: CreateMarketRequest): Promise<Market> =>
    request<Market>('/catalog/markets', { method: 'POST', body: JSON.stringify(payload) }, token),

  updateMarket: (token: string, id: string, payload: UpdateMarketRequest): Promise<Market> =>
    request<Market>(`/catalog/markets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deactivateMarket: (token: string, id: string): Promise<Market> =>
    request<Market>(`/catalog/markets/${id}`, { method: 'DELETE' }, token),

  listProductFamilies: (token: string): Promise<ProductFamily[]> =>
    request<ProductFamily[]>('/catalog/product-families', {}, token),

  createProductFamily: (token: string, payload: CreateProductFamilyRequest): Promise<ProductFamily> =>
    request<ProductFamily>('/catalog/product-families', { method: 'POST', body: JSON.stringify(payload) }, token),

  updateProductFamily: (token: string, id: string, payload: UpdateProductFamilyRequest): Promise<ProductFamily> =>
    request<ProductFamily>(`/catalog/product-families/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deactivateProductFamily: (token: string, id: string): Promise<ProductFamily> =>
    request<ProductFamily>(`/catalog/product-families/${id}`, { method: 'DELETE' }, token),

  listBatches: (token: string): Promise<Batch[]> => request<Batch[]>('/batching/batches', {}, token),

  getBatchPreparation: (token: string, recipeId: string, quantity: number): Promise<IngredientQuantity[]> =>
    request<IngredientQuantity[]>(
      `/batching/batches/preparation?recipeId=${recipeId}&quantity=${quantity}`,
      {},
      token,
    ),

  createBatch: (token: string, payload: CreateBatchRequest): Promise<Batch> =>
    request<Batch>('/batching/batches', { method: 'POST', body: JSON.stringify(payload) }, token),

  getBatchFeasibility: (token: string, batchId: string): Promise<BatchFeasibilityReport> =>
    request<BatchFeasibilityReport>(`/batching/batches/${batchId}/feasibility`, {}, token),

  updateBatchPlannedQuantity: (token: string, batchId: string, plannedQuantity: number): Promise<Batch> =>
    request<Batch>(
      `/batching/batches/${batchId}/planned-quantity`,
      { method: 'PATCH', body: JSON.stringify({ plannedQuantity }) },
      token,
    ),

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

  // Impression des étiquettes Brady BBP12 (voir ADR 0010 § Décisions 16/17) : lecture
  // seule, aucun effet de bord, appelable un nombre quelconque de fois.
  getBatchPrintData: (token: string, batchId: string): Promise<BatchPrintData> =>
    request<BatchPrintData>(`/production/batches/${batchId}/print-data`, {}, token),

  listBatchAllocations: (token: string, batchId: string): Promise<BatchProductAllocation[]> =>
    request<BatchProductAllocation[]>(`/batching/batches/${batchId}/allocations`, {}, token),

  addBatchAllocation: (
    token: string,
    batchId: string,
    payload: AddBatchProductAllocationRequest,
  ): Promise<BatchProductAllocation> =>
    request<BatchProductAllocation>(
      `/batching/batches/${batchId}/allocations`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listImportLogs: (token: string, type?: ImportType): Promise<ImportLog[]> =>
    request<ImportLog[]>(`/import-export/logs${type ? `?type=${type}` : ''}`, {}, token),

  previewArticlesImport: (
    token: string,
    file: File,
    mappingCorrections?: MappingCorrection[],
  ): Promise<ArticlesImportPreviewResult> =>
    requestMultipart<ArticlesImportPreviewResult>(
      '/import-export/articles/preview',
      buildImportFormData(file, mappingCorrections),
      token,
    ),

  confirmArticlesImport: (
    token: string,
    payload: { importLogId: string; rows: ArticleImportRow[]; mappingCorrections?: MappingCorrection[] },
  ): Promise<ArticlesImportConfirmResult> =>
    request<ArticlesImportConfirmResult>(
      '/import-export/articles/confirm',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  previewStocksImport: (
    token: string,
    file: File,
    mappingCorrections?: MappingCorrection[],
  ): Promise<StocksImportPreviewResult> =>
    requestMultipart<StocksImportPreviewResult>(
      '/import-export/stocks/preview',
      buildImportFormData(file, mappingCorrections),
      token,
    ),

  confirmStocksImport: (
    token: string,
    payload: { importLogId: string; rows: StockImportRow[]; mappingCorrections?: MappingCorrection[] },
  ): Promise<StocksImportConfirmResult> =>
    request<StocksImportConfirmResult>(
      '/import-export/stocks/confirm',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  previewExpectedRequirementsImport: (
    token: string,
    file: File,
    mappingCorrections?: MappingCorrection[],
  ): Promise<ExpectedRequirementsImportPreviewResult> =>
    requestMultipart<ExpectedRequirementsImportPreviewResult>(
      '/import-export/expected-requirements/preview',
      buildImportFormData(file, mappingCorrections),
      token,
    ),

  confirmExpectedRequirementsImport: (
    token: string,
    payload: {
      importLogId: string;
      rows: ExpectedRequirementImportRow[];
      mappingCorrections?: MappingCorrection[];
    },
  ): Promise<ExpectedRequirementsImportConfirmResult> =>
    request<ExpectedRequirementsImportConfirmResult>(
      '/import-export/expected-requirements/confirm',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  previewInventoryImport: (
    token: string,
    file: File,
    mappingCorrections?: MappingCorrection[],
  ): Promise<InventoryImportPreviewResult> =>
    requestMultipart<InventoryImportPreviewResult>(
      '/import-export/inventory/preview',
      buildImportFormData(file, mappingCorrections),
      token,
    ),

  createFeedback: (token: string, payload: CreateFeedbackRequest): Promise<Feedback> =>
    request<Feedback>('/feedback', { method: 'POST', body: JSON.stringify(payload) }, token),

  listFeedback: (token: string): Promise<Feedback[]> => request<Feedback[]>('/feedback', {}, token),

  markFeedbackAsTreated: (token: string, id: string): Promise<Feedback> =>
    request<Feedback>(`/feedback/${id}/treated`, { method: 'PATCH' }, token),

  getDashboardSummary: (token: string): Promise<DashboardSummary> =>
    request<DashboardSummary>('/dashboard/summary', {}, token),

  getLotTraceability: (token: string, id: string): Promise<LotTraceability> =>
    request<LotTraceability>(`/traceability/lots/${id}`, {}, token),

  // ADR 0010 § Décision 15 : plusieurs allocations d'un même batch peuvent désormais
  // partager le même lotNumber — le contrat renvoie toujours une liste, y compris
  // vide ([]) si aucun lot ne correspond (jamais 404).
  getLotTraceabilityByNumber: (token: string, lotNumber: string): Promise<LotTraceability[]> =>
    request<LotTraceability[]>(`/traceability/lots?lotNumber=${encodeURIComponent(lotNumber)}`, {}, token),

  getStockLotTraceability: (token: string, id: string): Promise<StockLotTraceability> =>
    request<StockLotTraceability>(`/traceability/stock-lots/${id}`, {}, token),

  listAromaSamples: (token: string, query?: AromaSamplesQuery): Promise<PaginatedAromaSamples> =>
    request<PaginatedAromaSamples>(`/rnd/aroma-samples${buildAromaSamplesQueryString(query)}`, {}, token),

  getAromaSample: (token: string, id: string): Promise<AromaSampleDetailResponse> =>
    request<AromaSampleDetailResponse>(`/rnd/aroma-samples/${id}`, {}, token),

  previewAromaSamplesImport: (
    token: string,
    file: File,
    mappingCorrections?: MappingCorrection[],
  ): Promise<AromaSamplesImportPreviewResult> =>
    requestMultipart<AromaSamplesImportPreviewResult>(
      '/rnd/aroma-samples/import/preview',
      buildImportFormData(file, mappingCorrections),
      token,
    ),

  confirmAromaSamplesImport: (
    token: string,
    payload: { importLogId: string; rows: AromaSampleImportRow[]; mappingCorrections?: MappingCorrection[] },
  ): Promise<AromaSamplesImportConfirmResult> =>
    request<AromaSamplesImportConfirmResult>(
      '/rnd/aroma-samples/import/confirm',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),
};
