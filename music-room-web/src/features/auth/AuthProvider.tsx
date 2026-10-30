import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ApiClient, User } from '../../api/client';
import { client } from '../../api/instance';

const Context = createContext<{ client: ApiClient; user: User | null }>({ client, user: null });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState(client.user);
  useEffect(() => client.subscribe(setUser), []);
  return <Context.Provider value={{ client, user }}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
