import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout, { PlainLayout } from './components/Layout'
import { PageLoader } from './components/ui'
import NoAccessNotice from './components/NoAccessNotice'
import { useAuth } from './context/AuthContext'
import { useI18n } from './i18n'

import Login from './pages/Login'
import Register from './pages/Register'
import SetPassword from './pages/SetPassword'
import ClientHome from './pages/ClientHome'
import CasePage from './pages/CasePage'
import MyData from './pages/MyData'
import Pricing from './pages/Pricing'
import SpecialistHome from './pages/SpecialistHome'
import SpecialistClient from './pages/SpecialistClient'
import Account from './pages/Account'
import NotFound from './pages/NotFound'

function NoAccess() {
  const { signOut } = useAuth()
  return (
    <PlainLayout>
      <NoAccessNotice onSignOut={signOut} />
    </PlainLayout>
  )
}

function Protected({ children, staffOnly = false }) {
  const { loading, profile, access, isStaff } = useAuth()
  const location = useLocation()
  const { t } = useI18n()

  if (loading) {
    return (
      <PlainLayout>
        <PageLoader label={t('common.loading')} />
      </PlainLayout>
    )
  }
  if (access === 'no-profile') return <NoAccess />
  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (staffOnly && !isStaff) return <Navigate to="/" replace />

  return <Layout>{children}</Layout>
}

function HomeRedirect() {
  const { isStaff } = useAuth()
  return isStaff ? <Navigate to="/clients" replace /> : <ClientHome />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/set-password" element={<SetPassword />} />

      <Route
        path="/"
        element={
          <Protected>
            <HomeRedirect />
          </Protected>
        }
      />
      <Route
        path="/year/:caseId"
        element={
          <Protected>
            <CasePage />
          </Protected>
        }
      />
      <Route
        path="/my-data"
        element={
          <Protected>
            <MyData />
          </Protected>
        }
      />
      <Route
        path="/pricing"
        element={
          <Protected>
            <Pricing />
          </Protected>
        }
      />
      <Route
        path="/account"
        element={
          <Protected>
            <Account />
          </Protected>
        }
      />

      <Route
        path="/clients"
        element={
          <Protected staffOnly>
            <SpecialistHome />
          </Protected>
        }
      />
      <Route
        path="/clients/:clientId"
        element={
          <Protected staffOnly>
            <SpecialistClient />
          </Protected>
        }
      />

      <Route
        path="*"
        element={
          <Protected>
            <NotFound />
          </Protected>
        }
      />
    </Routes>
  )
}
