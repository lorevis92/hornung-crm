import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message, type = 'success', timeout = 4500) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((list) => [...list, { id, message, type }])
      if (timeout) setTimeout(() => dismiss(id), timeout)
    },
    [dismiss]
  )

  const value = useMemo(
    () => ({
      toast: push,
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error', 7000),
      info: (m) => push(m, 'info')
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-lift backdrop-blur ${
                t.type === 'error'
                  ? 'border-red-200 bg-red-50/95 text-red-900'
                  : t.type === 'info'
                    ? 'border-line bg-white/95 text-ink-800'
                    : 'border-emerald-200 bg-emerald-50/95 text-emerald-900'
              }`}
            >
              <Icon size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p className="flex-1 text-sm leading-relaxed">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded-md p-1 opacity-60 transition hover:opacity-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
