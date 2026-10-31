import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AuthPage } from '../auth/AuthPage';
export function HomePage() {
  const { user } = useAuth();
  return user ? <Navigate to="/rooms" replace /> : <AuthPage mode="login" />;
}
