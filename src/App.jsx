import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AuthProvider from './hooks/AuthProvider'
import { useAuth } from './hooks/useAuth'
import DashboardLayout from './layouts/DashboardLayout'
import DashboardPage from './pages/DashboardPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ModulePage from './pages/ModulePage'
import RemessaBoletosAnalisePage from './pages/RemessaBoletosAnalisePage'
import RemessaBoletosImportPage from './pages/RemessaBoletosImportPage'
import RemessaBoletosNovaPage from './pages/RemessaBoletosNovaPage'
import RemessaBoletosPage from './pages/RemessaBoletosPage'
import RemessaBoletosRapidaPage from './pages/RemessaBoletosRapidaPage'
import RegisterPage from './pages/RegisterPage'

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-700">
        Carregando...
      </div>
    )
  }

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/cadastro"
        element={
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        }
      />

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/boletos"
            element={
              <ModulePage
                title="Boletos"
                description="Area preparada para controle e analise de boletos de inquilinos."
              />
            }
          />
          <Route
            path="/repasses"
            element={
              <ModulePage
                title="Repasses"
                description="Area preparada para acompanhamento de repasses a proprietarios."
              />
            }
          />
          <Route
            path="/pagamentos"
            element={
              <ModulePage
                title="Pagamentos"
                description="Area preparada para gestao de pagamentos para fornecedores."
              />
            }
          />
          <Route
            path="/relatorios"
            element={
              <ModulePage
                title="Relatorios"
                description="Area preparada para consolidacao de relatorios financeiros."
              />
            }
          />
          <Route path="/remessa-boletos" element={<RemessaBoletosPage />} />
          <Route path="/remessa-boletos/rapida" element={<RemessaBoletosRapidaPage />} />
          <Route path="/remessa-boletos/nova" element={<RemessaBoletosNovaPage />} />
          <Route path="/remessa-boletos/:analiseId/importar" element={<RemessaBoletosImportPage />} />
          <Route path="/remessa-boletos/:analiseId" element={<RemessaBoletosAnalisePage />} />
          <Route
            path="/configuracoes"
            element={
              <ModulePage
                title="Configuracoes"
                description="Area preparada para personalizar parametros da plataforma."
              />
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
