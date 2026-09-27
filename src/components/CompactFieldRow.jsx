import { useEffect, useRef, useState } from 'react'
import { Eye, MoreVertical, Save } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, Textarea } from './ui'
import { useI18n } from '../i18n'
import { formatDateTime } from '../lib/format'

// Dense, single-line alternative to ExtractedFieldRow — same data, same
// actions (edit, view source, exclude/include), reached through a
// three-dot menu instead of always-visible controls, so a specialist can
// see many fields at once without scrolling through card padding. Editing
// still goes through the exact same onChange/onConfirm callbacks as the
// spacious row; only the presentation (and the local "is the inline editor
// open" toggle) is different.
export default function CompactFieldRow({
  field,
  showDocument = false,
  saving = false,
  viewingSource = false,
  togglingInclude = false,
  onChange,
  onConfirm,
  onViewSource,
  onToggleInclude,
  innerRef
}) {
  const { t, lang } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const menuRef = useRef(null)
  const wasSaving = useRef(saving)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Collapse the inline editor once a save this row triggered finishes —
  // mirrors the spacious row's "always editable" field, just not left open
  // by default.
  useEffect(() => {
    if (wasSaving.current && !saving) setEditing(false)
    wasSaving.current = saving
  }, [saving])

  const canViewSource = field.source_quote || field.isPdf
  const excluded = field.included_in_calculation === false
  const hasValue = Boolean(field.field_value)
  const edited = field.verified_by_specialist

  const statusText = !hasValue
    ? t('extraction.notFound')
    : edited
      ? t('extraction.editedOn', { date: formatDateTime(field.verified_at, lang) })
      : field.confidence != null
        ? `${t('extraction.needsReview')} · ${t('extraction.confidence', { percent: Math.round(field.confidence * 100) })}`
        : t('extraction.addedManually')

  return (
    <li ref={innerRef} className="border-b border-line/70 last:border-b-0">
      {editing ? (
        <div className="flex items-end gap-2 px-2 py-2">
          <Textarea
            rows={1}
            className="min-h-0 py-1.5 text-[13.5px]"
            autoFocus
            value={field.field_value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('extraction.notFoundPlaceholder')}
          />
          <button
            type="button"
            className="btn-secondary btn-sm shrink-0"
            onClick={onConfirm}
            disabled={saving || !field.field_value.trim()}
          >
            {saving ? <Spinner size={14} /> : <Save size={14} aria-hidden="true" />}
            {t('common.save')}
          </button>
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-sand/60">
          <div className="min-w-0 flex-1 truncate text-[13.5px] leading-snug">
            <span className="font-medium text-ink-900">{field.field_label}</span>
            {showDocument && field.file_name ? <span className="text-ink-500"> ({field.file_name})</span> : null}
            <span className="text-ink-900">: </span>
            <span className={clsx(hasValue ? 'text-ink-900' : 'italic text-ink-500')}>
              {hasValue ? field.field_value : t('extraction.notFoundPlaceholder')}
            </span>
          </div>
          <span
            className={clsx(
              'shrink-0 whitespace-nowrap text-[11.5px]',
              excluded ? 'text-amber-700' : edited ? 'text-emerald-700' : field.confidence != null ? 'text-amber-700' : 'text-ink-400'
            )}
          >
            {statusText}
            {excluded ? ` · ${t('extraction.excludedBadge')}` : ''}
          </span>
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={t('common.actions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical size={15} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-line bg-white py-1 shadow-lift">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center px-3 py-2 text-left text-[13.5px] text-ink-700 hover:bg-sand/70"
                  onClick={() => {
                    setEditing(true)
                    setMenuOpen(false)
                  }}
                >
                  {t('common.edit')}
                </button>
                {canViewSource ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13.5px] text-ink-700 hover:bg-sand/70 disabled:opacity-50"
                    disabled={viewingSource}
                    onClick={() => {
                      onViewSource()
                      setMenuOpen(false)
                    }}
                  >
                    {viewingSource ? <Spinner size={14} /> : <Eye size={14} aria-hidden="true" />}
                    {t('extraction.viewSource')}
                  </button>
                ) : null}
                {hasValue && onToggleInclude ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3 py-2 text-left text-[13.5px] text-ink-700 hover:bg-sand/70 disabled:opacity-50"
                    disabled={togglingInclude}
                    onClick={() => {
                      onToggleInclude()
                      setMenuOpen(false)
                    }}
                  >
                    {excluded ? t('extraction.includeInCalculation') : t('extraction.excludeFromCalculation')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </li>
  )
}
