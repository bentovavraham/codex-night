import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import styles from './AppShell.module.css';
import { api } from '../api/client';
import { useUserStore } from '../store/userStore';

export default function AppShell() {
  const navigate = useNavigate();
  const setUser = useUserStore(s => s.setUser);

  const { data, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data) setUser(data);
  }, [data]);

  useEffect(() => {
    if (isError) navigate('/login');
  }, [isError]);

  if (!data && !isError) return null;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar />
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
