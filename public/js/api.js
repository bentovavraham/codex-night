// Thin wrapper around fetch that pipes JSON in/out and surfaces API errors.
// Attached to window.api so every component can use it without imports.

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let payload = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

window.api = {
  me:                ()                 => request('GET',  '/api/auth/me'),
  login:             (email, password)  => request('POST', '/api/auth/login', { email, password }),
  logout:            ()                 => request('POST', '/api/auth/logout'),

  listProjects:      ()                 => request('GET',  '/api/projects'),
  createProject:     (data)             => request('POST', '/api/projects', data),
  getProject:        (id)               => request('GET',  `/api/projects/${id}`),
  updateProject:     (id, data)         => request('PUT',  `/api/projects/${id}`, data),
  getDashboard:      (id)               => request('GET',  `/api/projects/${id}/dashboard`),
  addMember:         (id, data)         => request('POST', `/api/projects/${id}/members`, data),

  listUsers:         ()                 => request('GET',  '/api/users/directory'),
  createUser:        (data)             => request('POST', '/api/users', data),

  getQbCodes:        ()                 => request('GET',  '/api/qb-codes'),

  getBudget:         (id)               => request('GET',  `/api/projects/${id}/budget`),
  initBudget:        (id, lines)        => request('POST', `/api/projects/${id}/budget/initialize`, { lines }),
  updateBudgetLine:  (pid, lid, data)   => request('PUT',  `/api/projects/${pid}/budget-lines/${lid}`, data),
  getBudgetHistory:  (pid, lid)         => request('GET',  `/api/projects/${pid}/budget-lines/${lid}/history`),

  listContracts:     (pid, filters={})  => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([,v])=>v)).toString();
    return request('GET', `/api/projects/${pid}/contracts${qs ? '?' + qs : ''}`);
  },
  createContract:    (pid, data)        => request('POST', `/api/projects/${pid}/contracts`, data),
  getContract:       (id)               => request('GET',  `/api/contracts/${id}`),
  getContractHistory:(id)               => request('GET',  `/api/contracts/${id}/history`),
  updateContract:    (id, data)         => request('PUT',  `/api/contracts/${id}`, data),

  listInvoices:      (pid, filters={})  => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([,v])=>v)).toString();
    return request('GET', `/api/projects/${pid}/invoices${qs ? '?' + qs : ''}`);
  },
  createInvoice:     (data)             => request('POST', '/api/invoices', data),
  getInvoice:        (id)               => request('GET',  `/api/invoices/${id}`),
  updateInvoice:     (id, data)         => request('PUT',  `/api/invoices/${id}`, data),
  getInvoiceHistory: (id)               => request('GET',  `/api/invoices/${id}/history`),
  approveInvoice:    (id)               => request('POST', `/api/invoices/${id}/approve`),
  rejectInvoice:     (id, note)         => request('POST', `/api/invoices/${id}/reject`, { note }),
  holdInvoice:       (id, note)         => request('POST', `/api/invoices/${id}/hold`, { note }),
  revertInvoice:     (id)               => request('POST', `/api/invoices/${id}/revert`),
  bulkApprove:       (ids)              => request('POST', '/api/invoices/bulk-approve', { ids }),
  markPushed:        (id)               => request('POST', `/api/invoices/${id}/mark-pushed`),
  markPaid:          (id, paid_date)    => request('POST', `/api/invoices/${id}/mark-paid`, { paid_date }),

  // File upload / extraction
  uploadFile: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/files', { method: 'POST', credentials: 'same-origin', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  },
  extractContract: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/contracts/extract', { method: 'POST', credentials: 'same-origin', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  },
  extractInvoice: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/invoices/extract', { method: 'POST', credentials: 'same-origin', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  },

  // Cost control
  getCostSummary:   (pid)              => request('GET',  `/api/projects/${pid}/cost-summary`),
  getContractLedger:(id)               => request('GET',  `/api/contracts/${id}/ledger`),

  // Change orders
  listChangeOrders: (contractId)       => request('GET',  `/api/contracts/${contractId}/change-orders`),
  createChangeOrder:(contractId, data) => request('POST', `/api/contracts/${contractId}/change-orders`, data),
  updateChangeOrder:(id, data)         => request('PUT',  `/api/change-orders/${id}`, data),
  approveChangeOrder:(id)              => request('POST', `/api/change-orders/${id}/approve`),
  rejectChangeOrder: (id, note)        => request('POST', `/api/change-orders/${id}/reject`, { note }),
  deleteChangeOrder: (id)              => request('DELETE',`/api/change-orders/${id}`),

  // T&M charges
  listTMCharges:    (contractId)       => request('GET',  `/api/contracts/${contractId}/tm-charges`),
  createTMCharge:   (contractId, data) => request('POST', `/api/contracts/${contractId}/tm-charges`, data),
  updateTMCharge:   (id, data)         => request('PUT',  `/api/tm-charges/${id}`, data),
  approveTMCharge:  (id)               => request('POST', `/api/tm-charges/${id}/approve`),
  rejectTMCharge:   (id)               => request('POST', `/api/tm-charges/${id}/reject`),
  deleteTMCharge:   (id)               => request('DELETE',`/api/tm-charges/${id}`),

  // Expenses
  listExpenses:     (contractId)       => request('GET',  `/api/contracts/${contractId}/expenses`),
  createExpense:    (contractId, data) => request('POST', `/api/contracts/${contractId}/expenses`, data),
  updateExpense:    (id, data)         => request('PUT',  `/api/expenses/${id}`, data),
  approveExpense:   (id)               => request('POST', `/api/expenses/${id}/approve`),
  rejectExpense:    (id)               => request('POST', `/api/expenses/${id}/reject`),
  deleteExpense:    (id)               => request('DELETE',`/api/expenses/${id}`),

  searchVendors:    (q='')              => request('GET', `/api/vendors${q ? '?q=' + encodeURIComponent(q) : ''}`),
  searchCustomers:  (q='')              => request('GET', `/api/customers${q ? '?q=' + encodeURIComponent(q) : ''}`),

  // Admin (session auth when logged in as admin)
  adminStatus:      ()                  => request('GET', '/api/admin/status'),
  adminImport:      (kind, payload)     => request('POST', `/api/admin/import-${kind}`, payload),
  adminReplaceCodes:(force=true)        => request('POST', '/api/admin/replace-qb-codes', { force }),
};
