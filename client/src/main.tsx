import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import './styles/base.css';

import AppShell from './components/AppShell';
import TypeSelect from './screens/TypeSelect';
import ProjectList from './screens/ProjectList';
import ProjectDetail from './screens/ProjectDetail';
import PhaseHome from './screens/PhaseHome';
import BudgetGrid from './screens/BudgetGrid';
import BudgetTab, { QBSourceView, CompareView } from './screens/BudgetTab';
import CommitmentsGrid from './screens/CommitmentsGrid';
import PlaceholderTab from './screens/PlaceholderTab';
import InvoicesTab from './screens/InvoicesTab';
import ContractsTab from './screens/ContractsTab';
import AuditTab from './screens/AuditTab';
import HistoryTab from './screens/HistoryTab';
import LoginScreen from './screens/LoginScreen';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
  mutationCache: new MutationCache({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['budget-crosscheck'] });
    },
  }),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/" element={<AppShell />}>
            <Route index element={<TypeSelect />} />
            <Route path="projects" element={<ProjectList />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="projects/:projectId/phases/:phaseId" element={<PhaseHome />}>
              <Route index element={<Navigate to="budget" replace />} />
              <Route path="budget" element={<BudgetTab />}>
                <Route index element={<Navigate to="pm" replace />} />
                <Route path="pm"      element={<BudgetGrid />} />
                <Route path="qb"      element={<QBSourceView />} />
                <Route path="compare" element={<CompareView />} />
              </Route>
              <Route path="commitments"   element={<CommitmentsGrid />} />
              <Route path="contracts"     element={<ContractsTab />} />
              <Route path="invoices"      element={<InvoicesTab />} />
              <Route path="change-orders" element={<PlaceholderTab label="Change Orders" />} />
              <Route path="audit"         element={<AuditTab />} />
              <Route path="alerts"        element={<PlaceholderTab label="Alerts" />} />
              <Route path="history"       element={<HistoryTab />} />
            </Route>
            <Route path="invoices"  element={<PlaceholderTab label="Global Invoices" />} />
            <Route path="by-trade"  element={<PlaceholderTab label="By Trade" />} />
            <Route path="alerts"    element={<PlaceholderTab label="Alerts" />} />
            <Route path="admin"     element={<PlaceholderTab label="Admin" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
