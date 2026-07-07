import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@lca-mes/shared';
import { api } from '../api/client';

const TOKEN_STORAGE_KEY = 'lca-mes.accessToken';

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Recharge le profil (ex: après un changement de mot de passe qui lève mustChangePassword). */
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  // Tant que la session n'a pas été vérifiée auprès de l'API, on évite d'afficher
  // la page de login par erreur à un utilisateur déjà connecté (rechargement de page).
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    api
      .me(token)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login({ email, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, response.accessToken);
    setToken(response.accessToken);
    setUser(response.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    setUser(await api.me(token));
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
