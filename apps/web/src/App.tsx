import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { CatalogPage } from './pages/CatalogPage';
import { RecipesPage } from './pages/RecipesPage';
import { MachinesPage } from './pages/MachinesPage';
import { StockPage } from './pages/StockPage';
import { ProductionPage } from './pages/ProductionPage';
import { ImportsPage } from './pages/imports/ImportsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { FeedbackPage } from './pages/admin/FeedbackPage';
import { ProtectedRoute } from './auth/ProtectedRoute';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute allowPendingPasswordChange>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute requireSystemAdmin>
            <AdminUsersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/feedback"
        element={
          <ProtectedRoute requireSystemAdmin>
            <FeedbackPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalog"
        element={
          <ProtectedRoute requireFullAccess>
            <CatalogPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalog/recipes"
        element={
          <ProtectedRoute requireFullAccess>
            <RecipesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalog/machines"
        element={
          <ProtectedRoute requireFullAccess>
            <MachinesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/stock"
        element={
          <ProtectedRoute>
            <StockPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/production"
        element={
          <ProtectedRoute requireFullAccess>
            <ProductionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/imports"
        element={
          <ProtectedRoute requireFullAccess>
            <ImportsPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
