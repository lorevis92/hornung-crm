import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { LogOut, Menu, X, FlaskConical } from 'lucide-react'
import clsx from 'clsx'
import Brand from './Brand'
import LanguageSwitcher from './LanguageSwitcher'
import { useI18n } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { CONTACT } from '../lib/config'
import { initials } from '../lib/format'

function navLinkClass({ isActive }) {
  return clsx(
    'rounded-lg px-3 py-2 text-[15px] font-medium transition',
    isActive ? 'bg-gold-50 text-gold-800' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
  )
}

export default function Layout({ children }) {
  const { t } = useI18n()
  const { profile, isStaff, signOut, isDemo } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  const links = isStaff
    ? [
        { to: '/clients', label: t('nav.clients') },
        { to: '/pricing', label: t('nav.pricing') }
      ]
    : [
        { to: '/', label: t('nav.home') },
        { to: '/my-data', label: t('nav.myData') },
        { to: '/pricing', label: t('nav.pricing') }
      ]

  return (
    <div className="flex min-h-screen flex-col">
      {isDemo ? (
        <div className="no-print flex items-center justify-center gap-2 bg-ink-900 px-4 py-1.5 text-center text-[13px] font-medium text-gold-200">
          <FlaskConical size={14} aria-hidden="true" />
          {t('common.demoBadge')}
        </div>
      ) : null}

      <header className="no-print sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to={isStaff ? '/clients' : '/'} className="shrink-0 rounded-lg">
            <Brand />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className={navLinkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <LanguageSwitcher compact />
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-100 text-[13px] font-semibold text-gold-800"
                aria-hidden="true"
              >
                {initials(profile?.full_name || profile?.email || '?')}
              </span>
              <button type="button" onClick={signOut} className="btn-ghost btn-sm" title={t('common.logout')}>
                <LogOut size={17} aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{t('common.logout')}</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn-ghost btn-sm md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={t('nav.menu')}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {menuOpen ? (
          <div className="border-t border-line bg-white px-4 pb-4 pt-2 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/'}
                  onClick={() => setMenuOpen(false)}
                  className={navLinkClass}
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <LanguageSwitcher />
              <button type="button" onClick={signOut} className="btn-secondary btn-sm">
                <LogOut size={16} aria-hidden="true" />
                {t('common.logout')}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <main key={location.pathname} className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="no-print border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-[13px] text-ink-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {CONTACT.company} · {t('common.tagline')}
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a className="link" href={`mailto:${CONTACT.email}`}>
              {CONTACT.email}
            </a>
            <a className="link" href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}>
              {CONTACT.phone}
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

export function PlainLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-sand">
      <div className="flex flex-1 items-center justify-center px-4 py-10">{children}</div>
    </div>
  )
}
