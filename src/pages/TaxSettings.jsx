import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, FileCog, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import { EmptyState, Field, PageLoader, Spinner, TextInput } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'

// Field keys are never shown to the (non-technical) staff — they only ever
// type a natural-language name. Derived here from that name: lowercased,
// accents stripped, anything non-alphanumeric collapsed to underscores.
function slugify(label) {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field'
  )
}

function uniqueFieldKey(baseKey, existingKeys) {
  if (!existingKeys.has(baseKey)) return baseKey
  let i = 2
  while (existingKeys.has(`${baseKey}_${i}`)) i++
  return `${baseKey}_${i}`
}

// Simple keyword heuristic — no NLP needed, just enough to spare the
// specialist from ever picking a value type by hand.
const DATE_KEYWORDS = ['data', 'date', 'datum', 'birth', 'geburt', 'naissance', 'nascita']
const NUMERIC_KEYWORDS = [
  'importo', 'amount', 'saldo', 'balance', 'numero', 'number', 'anzahl', 'betrag',
  'montant', 'nombre', 'count', 'percentuale', 'percent', 'salario', 'salary',
  'gehalt', 'salaire', 'reddito', 'income', 'einkommen', 'revenu', 'capital',
  'contribution', 'contributo', 'beitrag', 'cotisation'
]

function inferValueType(label) {
  const lower = label.toLowerCase()
  if (DATE_KEYWORDS.some((kw) => lower.includes(kw))) return 'date'
  if (NUMERIC_KEYWORDS.some((kw) => lower.includes(kw))) return 'numeric'
  return 'text'
}

export default function TaxSettings() {
  const { t, lang } = useI18n()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('fields')
  const [categories, setCategories] = useState([])
  const [fields, setFields] = useState([])
  const [selectedCategory, setSelectedCategory] = useState(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let active = true
    const run = async () => {
      const [cats, defs] = await Promise.all([api.listDocumentCategories(), api.listFieldDefinitions()])
      if (!active) return
      setCategories(cats)
      setFields(defs)
      setSelectedCategory((prev) => prev || cats[0]?.code || null)
      setLoading(false)
    }
    run()
    return () => {
      active = false
    }
  }, [])

  const fieldsForSelected = useMemo(
    () =>
      fields
        .filter((f) => f.category_code === selectedCategory)
        .sort((a, b) => a.sort_order - b.sort_order),
    [fields, selectedCategory]
  )

  const selectedCategoryRow = categories.find((c) => c.code === selectedCategory) || null

  const openAdd = () => {
    setEditingId(null)
    setDraftLabel('')
    setModalOpen(true)
  }

  const openEdit = (field) => {
    setEditingId(field.id)
    setDraftLabel(field.field_label || '')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
  }

  const saveField = async () => {
    const label = draftLabel.trim()
    if (!label) return
    setSaving(true)
    try {
      if (editingId) {
        // Renaming only ever touches the label — the field_key stays put so
        // it keeps matching any data already extracted under that key.
        const updated = await api.updateFieldDefinition(editingId, { field_label: label })
        setFields((list) => list.map((f) => (f.id === editingId ? updated : f)))
      } else {
        const existingKeys = new Set(fieldsForSelected.map((f) => f.field_key))
        const field_key = uniqueFieldKey(slugify(label), existingKeys)
        const nextSortOrder = fieldsForSelected.length
          ? Math.max(...fieldsForSelected.map((f) => f.sort_order)) + 10
          : 10
        const created = await api.createFieldDefinition({
          category_code: selectedCategory,
          field_key,
          field_label: label,
          value_type: inferValueType(label),
          sort_order: nextSortOrder
        })
        setFields((list) => [...list, created])
      }
      toast.success(t('common.saved'))
      setModalOpen(false)
    } catch (error) {
      console.error(error)
      toast.error(error.code === '23505' ? t('taxSettings.fieldExists') : error.message || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const askDelete = (field) => setDeleteTarget(field)
  const cancelDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
  }
  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteFieldDefinition(deleteTarget.id)
      setFields((list) => list.filter((f) => f.id !== deleteTarget.id))
      toast.success(t('common.saved'))
      setDeleteTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setDeleting(false)
    }
  }

  const moveField = async (field, direction) => {
    const idx = fieldsForSelected.findIndex((f) => f.id === field.id)
    const other = fieldsForSelected[idx + direction]
    if (!other) return
    setBusyId(field.id)
    try {
      const [updatedA, updatedB] = await Promise.all([
        api.updateFieldDefinition(field.id, { sort_order: other.sort_order }),
        api.updateFieldDefinition(other.id, { sort_order: field.sort_order })
      ])
      setFields((list) =>
        list.map((f) => {
          if (f.id === updatedA.id) return updatedA
          if (f.id === updatedB.id) return updatedB
          return f
        })
      )
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageLoader label={t('common.loading')} />

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t('taxSettings.title')}</p>
        <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">{t('taxSettings.title')}</h1>
        <p className="mt-2 text-[15px] text-ink-500">{t('taxSettings.subtitle')}</p>
      </div>

      <nav className="flex gap-1 border-b border-line" aria-label="Tax settings sections">
        {[
          ['fields', t('taxSettings.fieldsTab')],
          ['parameters', t('taxSettings.parametersTab')]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={clsx(
              '-mb-px border-b-2 px-4 py-2.5 text-[15px] font-medium transition',
              tab === key
                ? 'border-gold-600 text-gold-800'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            )}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'fields' ? (
        <div className="grid gap-5 md:grid-cols-[240px_1fr]">
          <div className="card divide-y divide-line overflow-hidden p-0">
            {categories.map((cat) => (
              <button
                key={cat.code}
                type="button"
                onClick={() => setSelectedCategory(cat.code)}
                className={clsx(
                  'block w-full px-4 py-3 text-left text-[14px] transition',
                  selectedCategory === cat.code
                    ? 'bg-gold-50 font-medium text-gold-800'
                    : 'text-ink-600 hover:bg-sand/70'
                )}
              >
                {docTypeLabel(cat, lang)}
              </button>
            ))}
          </div>

          <div className="card card-pad space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title text-xl">
                {t('taxSettings.fieldsFor', {
                  category: selectedCategoryRow ? docTypeLabel(selectedCategoryRow, lang) : ''
                })}
              </h2>
              <button type="button" className="btn-primary btn-sm" onClick={openAdd}>
                <Plus size={16} aria-hidden="true" />
                {t('taxSettings.addField')}
              </button>
            </div>

            {fieldsForSelected.length ? (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full">
                  <thead className="bg-sand">
                    <tr>
                      <th className="table-head">{t('taxSettings.fieldName')}</th>
                      <th className="table-head text-right">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-white">
                    {fieldsForSelected.map((field, idx) => (
                      <tr key={field.id}>
                        <td className="table-cell text-ink-700">{field.field_label || field.field_key}</td>
                        <td className="table-cell">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              disabled={idx === 0 || busyId === field.id}
                              onClick={() => moveField(field, -1)}
                              title={t('taxSettings.moveUp')}
                              aria-label={t('taxSettings.moveUp')}
                            >
                              <ArrowUp size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              disabled={idx === fieldsForSelected.length - 1 || busyId === field.id}
                              onClick={() => moveField(field, 1)}
                              title={t('taxSettings.moveDown')}
                              aria-label={t('taxSettings.moveDown')}
                            >
                              <ArrowDown size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => openEdit(field)}
                              title={t('common.edit')}
                              aria-label={t('common.edit')}
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-sm text-ink-400 hover:text-red-700"
                              onClick={() => askDelete(field)}
                              title={t('common.delete')}
                              aria-label={t('common.delete')}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={FileCog} title={t('taxSettings.noFields')} />
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Settings2}
          title={t('taxSettings.parametersTab')}
          description={t('taxSettings.parametersComingSoon')}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? t('taxSettings.editField') : t('taxSettings.addField')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={closeModal} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={saveField}
              disabled={saving || !draftLabel.trim()}
            >
              {saving ? <Spinner size={16} /> : null}
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        <Field label={t('taxSettings.fieldName')} htmlFor="field-name" required>
          <TextInput id="field-name" value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} autoFocus />
        </Field>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={cancelDelete}
        title={t('taxSettings.deleteFieldConfirm')}
        description={
          deleteTarget
            ? t('taxSettings.deleteFieldConfirmBody', { label: deleteTarget.field_label || deleteTarget.field_key })
            : ''
        }
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={cancelDelete} disabled={deleting}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-danger btn-sm" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
              {deleting ? t('common.deleting') : t('common.delete')}
            </button>
          </>
        }
      />
    </div>
  )
}
