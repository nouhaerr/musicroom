import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { FeaturePage } from '../components/ui/FeaturePage';
import { HomePage } from '../features/home/HomePage';
import { featureRoutes } from './routes';

export function App() {
  return <Routes><Route element={<AppLayout />}>
    <Route index element={<HomePage />} />
    {featureRoutes.map(({ path, title, description }) => <Route key={path} path={path} element={<FeaturePage title={title} description={description} />} />)}
    <Route path="*" element={<FeaturePage title="Page not found" description="Choose a page from the navigation to continue." pending={false} />} />
  </Route></Routes>;
}
