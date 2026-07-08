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
  ResetPasswordResponse,
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
};
