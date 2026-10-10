import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedLayout } from './components/Layout'
import { Spinner } from './components/ui'
import { AnalysisPage } from './pages/AnalysisPage'
import { AuthPage } from './pages/AuthPage'
import { DashboardPage } from './pages/DashboardPage'
import { FilesPage } from './pages/FilesPage'
import { ProfilePage } from './pages/ProfilePage'

// The benchmark page pulls in the charting library, so it loads on demand.
const BenchmarkPage = lazy(() => import('./pages/BenchmarkPage').then((m) => ({ default: m.BenchmarkPage })))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="files/:id" element={<AnalysisPage />} />
        <Route
          path="benchmark"
          element={
            <Suspense fallback={<Spinner />}>
              <BenchmarkPage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
