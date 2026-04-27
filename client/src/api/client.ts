async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {},
  };
  if (body !== undefined) {
    (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!res.ok) {
    const err = new Error((payload as any)?.error || `HTTP ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }
  return payload as T;
}

export const api = {
  // Auth
  me:           ()                    => request<any>('GET',  '/api/auth/me'),
  login:        (email: string, password: string) => request<any>('POST', '/api/auth/login', { email, password }),
  logout:       ()                    => request<any>('POST', '/api/auth/logout'),

  // Projects
  listProjects: ()                    => request<any[]>('GET',  '/api/projects'),
  createProject:(data: any)           => request<any>('POST', '/api/projects', data),
  getProject:   (id: number)          => request<any>('GET',  `/api/projects/${id}`),
  updateProject:(id: number, data: any) => request<any>('PUT', `/api/projects/${id}`, data),

  // Phases
  listPhases:   (projectId: number)   => request<any[]>('GET',  `/api/projects/${projectId}/phases`),
  createPhase:  (projectId: number, data: any) => request<any>('POST', `/api/projects/${projectId}/phases`, data),
  updatePhase:  (id: number, data: any) => request<any>('PATCH', `/api/phases/${id}`, data),

  // Budget
  getBudget:    (phaseId: number)     => request<any[]>('GET',  `/api/phases/${phaseId}/budget`),
  updateBudgetLine: (id: number, data: any) => request<any>('PATCH', `/api/budget-lines/${id}`, data),
  getLineActivity: (lineId: number)          => request<any>('GET',  `/api/budget-lines/${lineId}/activity`),
  initBudget:   (phaseId: number, template: string) => request<any>('POST', `/api/phases/${phaseId}/budget/init`, { template }),

  // Contracts
  listContracts:   (phaseId: number)  => request<any[]>('GET',  `/api/phases/${phaseId}/contracts`),
  listBudgetLines: (phaseId: number)  => request<any[]>('GET',  `/api/phases/${phaseId}/budget-lines`),
  createContract:(data: any)          => request<any>('POST',   '/api/contracts', data),
  getContract:  (id: number)          => request<any>('GET',    `/api/contracts/${id}`),
  updateContract:(id: number, data: any) => request<any>('PUT', `/api/contracts/${id}`, data),
  deleteContract:(id: number)         => request<any>('DELETE', `/api/contracts/${id}`),

  // Invoices
  listInvoices: (phaseId: number, filters?: any) => {
    const qs = filters ? '?' + new URLSearchParams(Object.entries(filters).filter(([,v]) => v) as any).toString() : '';
    return request<any[]>('GET', `/api/phases/${phaseId}/invoices${qs}`);
  },
  createInvoice:(data: any)           => request<any>('POST',   '/api/invoices', data),
  getInvoice:   (id: number)          => request<any>('GET',    `/api/invoices/${id}`),
  updateInvoice:(id: number, data: any) => request<any>('PUT',  `/api/invoices/${id}`, data),
  deleteInvoice:(id: number)          => request<any>('DELETE', `/api/invoices/${id}`),
  approveInvoice:(id: number)         => request<any>('POST', `/api/invoices/${id}/approve`),
  rejectInvoice:(id: number, note: string) => request<any>('POST', `/api/invoices/${id}/reject`, { note }),

  // Change Orders
  listChangeOrders:(contractId: number) => request<any[]>('GET', `/api/contracts/${contractId}/change-orders`),
  createChangeOrder:(contractId: number, data: any) => request<any>('POST', `/api/contracts/${contractId}/change-orders`, data),
  approveChangeOrder:(id: number)     => request<any>('POST', `/api/change-orders/${id}/approve`),
  rejectChangeOrder:(id: number, note: string) => request<any>('POST', `/api/change-orders/${id}/reject`, { note }),

  // QB Accounts
  listQbAccounts:()                   => request<any[]>('GET', '/api/qb-accounts'),

  // File upload / extraction
  uploadFile: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/files', { method: 'POST', credentials: 'same-origin', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  },
  extractInvoice: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/invoices/extract', { method: 'POST', credentials: 'same-origin', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  },
  extractContract: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/contracts/extract', { method: 'POST', credentials: 'same-origin', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  },

  // Import queue
  importFiles: async (phaseId: number, files: File[]) => {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    const res = await fetch(`/api/phases/${phaseId}/import`, { method: 'POST', credentials: 'same-origin', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  },
  getImportQueue: (phaseId: number) => request<any[]>('GET', `/api/phases/${phaseId}/import-queue`),
  updateImportItem: (id: number, data: any) => request<any>('PATCH', `/api/import-queue/${id}`, data),
  confirmImportItem: (id: number, formData: any) => request<any>('POST', `/api/import-queue/${id}/confirm`, { formData }),
  discardImportItem: (id: number) => request<any>('DELETE', `/api/import-queue/${id}`),
};
