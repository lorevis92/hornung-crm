import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, ListChecks, Pencil } from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import { useI18n } from '../i18n'
import { docTypeLabel, groupByCategory } from '../lib/labels'
import { DOC_CATEGORIES } from '../lib/constants'

export default function ChecklistPanel({
  documentTypes = [],
  requested = [],
  documents = [],
  canEdit = false,
  onSave
}) {
  const { t, lang } = useI18n()
  const [showAll, setShowAll] = useState(false)
  const [editing, setEditing] = useState(false)
  const [selection, setSelection] = useState([])
  const [saving, setSaving] = useState(false)

  const uploadedTypes = useMemo(
    () => new Set(documents.map((d) => d.document_type_id).filter(Boolean)),
    [documents]
  )
  const requestedIds = useMemo(() => requested.map((r) => r.document_type_id), [requested])
  const grouped = useMemo(() => groupByCategory(documentTypes), [documentTypes])

  const openEditor = () => {
    setSelection(requestedIds)
    setEditing(true)
  }

  const toggle = (id) =>
    setSelection((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const save = async () => {
    setSaving(true)
    try {
      await onSave(selection)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-start gap-2.5">
          <ListChecks size={19} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <p className="text-[15px] font-semibold text-ink-900">{t('case.checklist')}</p>
            <p className="text-[13px] text-ink-400">{t('case.checklistHelp')}</p>
          </div>
        </div>
        {canEdit ? (
          <button type="button" className="btn-ghost btn-sm" onClick={openEditor}>
            <Pencil size={15} aria-hidden="true" />
            {t('common.edit')}
          </button>
        ) : null}
      </div>

      <div className="px-4 py-3">
        {requestedIds.length ? (
          <ul className="space-y-1.5">
            {requestedIds.map((id) => {
              const type = documentTypes.find((x) => x.id === id)
              const done = uploadedTypes.has(id)
              return (
                <li key={id} className="flex items-start gap-2.5">
                  <span
                    className={clsx(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                      done
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-ink-200 bg-white text-transparent'
                    )}
                    aria-hidden="true"
                  >
                    <Check size={13} />
                  </span>
                  <span
                    className={clsx(
                      'text-[14.5px] leading-snug',
                      done ? 'text-ink-400' : 'text-ink-700'
                    )}
                  >
                    {docTypeLabel(type, lang) || id}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-[14.5px] text-ink-400">{t('case.noChecklist')}</p>
        )}

        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-medium text-gold-700 hover:underline"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
        >
          {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {showAll ? t('case.hideAllTypes') : t('case.showAllTypes')}
        </button>

        {showAll ? (
          <div className="mt-3 space-y-4 border-t border-line pt-3">
            {DOC_CATEGORIES.filter((cat) => grouped[cat]?.length).map((cat) => (
              <div key={cat}>
                <p className="eyebrow mb-1.5">{t(`docCat.${cat}`)}</p>
                <ul className="space-y-1">
                  {grouped[cat].map((type) => (
                    <li key={type.id} className="text-[14px] leading-snug text-ink-600">
                      · {docTypeLabel(type, lang)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={t('case.editChecklist')}
        description={t('case.checklistHelp')}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {DOC_CATEGORIES.filter((cat) => grouped[cat]?.length).map((cat) => (
            <fieldset key={cat}>
              <legend className="eyebrow mb-2">{t(`docCat.${cat}`)}</legend>
              <div className="space-y-2">
                {grouped[cat].map((type) => (
                  <label
                    key={type.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-sand"
                  >
                    <input
                      type="checkbox"
                      className="checkbox mt-0.5"
                      checked={selection.includes(type.id)}
                      onChange={() => toggle(type.id)}
                    />
                    <span className="text-[14.5px] leading-snug text-ink-700">
                      {docTypeLabel(type, lang)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Modal>
    </div>
  )
}
