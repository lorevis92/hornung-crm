import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import Layout, { PlainLayout } from './components/Layout'
import { PageLoader } from './components/ui'
import Brand from './components/Brand'
import { useAuth } from './context/AuthContext'
import { useI18n } from './i18n'
import { CONTACT } from './lib/config'

import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import ClientHome from './pages/ClientHome'
import CasePage from './pages/CasePage'
import MyData from './pages/MyData'
import Pricing from './pages/Pricing'
import SpecialistHome from './pages/SpecialistHome'
import SpecialistClient from './pages/SpecialistClient'
import NotFound from './pages/NotFound'

function NoAccess() {
  const { signOut } = useAuth()
  return (
    <PlainLayout>
      <div className="card card-pad w-full max-w-md text-center">
        <div className="mb-4 flex justify-center">
          <Brand size="lg" showTagline={false} />
        </div>
        <ShieldAlert size={28} className="mx-auto mb-3 text-gold-600" aria-hidden="true" />
        <h1 className="display text-2xl">No access to this portal</h1>
        <p className="mt-2 text-[15px] text-ink-500">
          Your account exists, but it is not registered as a client of Hornung Consulting. If you
          think this is a mistake, please contact{' '}
          <a className="link" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email}
          </a>
          .
        </p>
        <button type="button" onClick={signOut} className="btn-secondary mt-6 w-full">
          Sign out
        </button>
      </div>
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
