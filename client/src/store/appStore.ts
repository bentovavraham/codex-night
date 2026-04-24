import { create } from 'zustand';

export type ProjectType = 'industrial' | 'residential' | null;

interface AppStore {
  projectType: ProjectType;
  activeProjectId: number | null;
  activePhaseId: number | null;
  detailPanelOpen: boolean;

  setProjectType: (t: ProjectType) => void;
  setActiveProject: (id: number | null) => void;
  setActivePhase: (id: number | null) => void;
  openPanel: () => void;
  closePanel: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  projectType: null,
  activeProjectId: null,
  activePhaseId: null,
  detailPanelOpen: false,

  setProjectType: (t) => set({ projectType: t, activeProjectId: null, activePhaseId: null }),
  setActiveProject: (id) => set({ activeProjectId: id, activePhaseId: null }),
  setActivePhase: (id) => set({ activePhaseId: id }),
  openPanel: () => set({ detailPanelOpen: true }),
  closePanel: () => set({ detailPanelOpen: false }),
}));
