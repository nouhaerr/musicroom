import { AuthProvider } from '../features/auth/AuthProvider';
import { AuthPage } from '../features/auth/AuthPage';
import { AccountPage } from '../features/auth/AccountPage';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { FeaturePage } from '../components/ui/FeaturePage';
import { HomePage } from '../features/home/HomePage';
import { featureRoutes } from './routes';

export function App() {
  return <AuthProvider><Routes><Route element={<AppLayout />}>
    <Route index element={<HomePage />} />
    {(['login', 'register', 'verify-email', 'forgot-password', 'reset-password'] as const).map(mode => <Route key={mode} path={'/auth/' + mode} element={<AuthPage key={mode} mode={mode} />} />)}
    <Route path="/account" element={<AccountPage />} />
    {featureRoutes.filter(route => !route.path.startsWith('/auth/')).map(({ path, title, description }) => <Route key={path} path={path} element={<FeaturePage title={title} description={description} />} />)}
    <Route path="*" element={<FeaturePage title="Page not found" description="Choose a page from the navigation to continue." pending={false} />} />
  </Route></Routes></AuthProvider>;
}
