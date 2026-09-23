import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import clsx from 'clsx'

export function Spinner({ size = 20, className = '' }) {
  return <Loader2 size={size} className={clsx('animate-spin', className)} aria-hidden="true" />
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-ink-400">
      <Spinner size={26} />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-sand/60 px-6 py-10 text-center">
      {Icon ? (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-gold-600 ring-1 ring-line">
          <Icon size={22} aria-hidden="true" />
        </span>
      ) : null}
      <p className="font-medium text-ink-800">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[15px] text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function SectionHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="section-title">{title}</h2>
        {description ? <p className="section-sub max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Field({ label, hint, htmlFor, children, className = '', required = false }) {
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-gold-700">*</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  )
}

export function TextInput({ className = '', ...props }) {
  return <input className={clsx('input', className)} {...props} />
}

export function PasswordInput({ className = '', ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        className={clsx('input pr-10', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-400 hover:text-ink-700"
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
      </button>
    </div>
  )
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={clsx('select', className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={clsx('textarea', className)} {...props} />
}

export function Checkbox({ label, hint, id, ...props }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="checkbox mt-1" {...props} />
      <label htmlFor={id} className="cursor-pointer select-none text-[15px] leading-snug text-ink-700">
        {label}
        {hint ? <span className="block text-[13px] text-ink-400">{hint}</span> : null}
      </label>
    </div>
  )
}

export function Stat({ label, value, tone = 'neutral', icon: Icon }) {
  const tones = {
    neutral: 'text-ink-900',
    gold: 'text-gold-700',
    amber: 'text-amber-700',
    emerald: 'text-emerald-700'
  }
  return (
    <div className="card px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
        {Icon ? <Icon size={17} className="text-ink-300" aria-hidden="true" /> : null}
      </div>
      <p className={clsx('display mt-1.5 text-3xl', tones[tone])}>{value}</p>
    </div>
  )
}
