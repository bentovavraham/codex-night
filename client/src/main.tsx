import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/base.css';

import AppShell from './components/AppShell';
import TypeSelect from './screens/TypeSelect';
import ProjectList from './screens/ProjectList';
import ProjectDetail from './screens/ProjectDetail';
import PhaseHome from './screens/PhaseHome';
import BudgetGrid from './screens/BudgetGrid';
import CommitmentsGrid from './screens/CommitmentsGrid';
import PlaceholderTab from './screens/PlaceholderTab';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<TypeSelect />} />
            <Route path="projects" element={<ProjectList />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="projects/:projectId/phases/:phaseId" element={<PhaseHome />}>
              <Route index element={<Navigate to="budget" replace />} />
              <Route path="budget"        element={<BudgetGrid />} />
              <Route path="commitments"   element={<CommitmentsGrid />} />
              <Route path="contracts"     element={<PlaceholderTab label="Contracts" />} />
              <Route path="invoices"      element={<PlaceholderTab label="Invoices" />} />
              <Route path="change-orders" element={<PlaceholderTab label="Change Orders" />} />
              <Route path="alerts"        element={<PlaceholderTab label="Alerts" />} />
              <Route path="history"       element={<PlaceholderTab label="History" />} />
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
