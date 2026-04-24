import { create } from 'zustand';

export type UserRole = 'pm' | 'partner' | 'admin';

interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

interface UserStore {
  user: User | null;
  setUser: (u: User | null) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  setUser: (u) => set({ user: u }),
}));
