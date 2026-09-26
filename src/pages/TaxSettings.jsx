import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown, ArrowUp, ExternalLink, FileCog, Pencil, Plus, Settings2, Trash2
} from 'lucide-react'
import Modal from '../components/Modal'
import { EmptyState, Field, PageLoader, Select, Spinner, Textarea, TextInput } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'
import { CANTONS } from '../lib/constants'
import { currentTaxYear } from '../lib/config'
import { formatChf, formatDate } from '../lib/format'
import { slugify, uniqueSlug } from '../lib/slug'

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

const PARAM_VALUE_TYPES = ['fixed_amount', 'percentage', 'formula', 'no_cap']

function emptyParamDraft() {
  return {
    name: '',
    scope: 'federal',
    canton: '',
    taxYear: String(currentTaxYear() + 1),
    valueType: 'fixed_amount',
    value: '',
    notes: '',
    sourceUrl: '',
    lastVerifiedAt: ''
  }
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

  const [parameters, setParameters] = useState([])
  const [scopeFilter, setScopeFilter] = useState('all')
  const [cantonFilter, setCantonFilter] = useState('all')
  const [paramModalOpen, setParamModalOpen] = useState(false)
  const [editingParamId, setEditingParamId] = useState(null)
  const [paramDraft, setParamDraft] = useState(emptyParamDraft)
  const [paramSaving, setParamSaving] = useState(false)
  const [paramDeleteTarget, setParamDeleteTarget] = useState(null)
  const [paramDeleting, setParamDeleting] = useState(false)

  useEffect(() => {
    let active = true
    const run = async () => {
      const [cats, defs, params] = await Promise.all([
        api.listDocumentCategories(),
        api.listFieldDefinitions(),
        api.listTaxParameters()
      ])
      if (!active) return
      setCategories(cats)
      setFields(defs)
      setParameters(params)
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
        const field_key = uniqueSlug(slugify(label), existingKeys)
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

  // ------------------------------------------------------ tax parameters ---
  const filteredParameters = useMemo(
    () =>
      parameters
        .filter((p) => scopeFilter === 'all' || p.scope === scopeFilter)
        .filter((p) => cantonFilter === 'all' || p.canton_code === cantonFilter)
        .sort(
          (a, b) =>
            a.scope.localeCompare(b.scope) ||
            (a.canton_code || '').localeCompare(b.canton_code || '') ||
            (a.parameter_label || '').localeCompare(b.parameter_label || '')
        ),
    [parameters, scopeFilter, cantonFilter]
  )

  const cantonsInUse = useMemo(
    () => [...new Set(parameters.map((p) => p.canton_code).filter(Boolean))].sort(),
    [parameters]
  )

  const formatParamValue = (p) => {
    if (p.value_type === 'no_cap') return t('taxSettings.noCap')
    if (p.value_numeric == null) return '—'
    if (p.value_type === 'percentage') return `${p.value_numeric}%`
    return formatChf(p.value_numeric, lang)
  }

  const openAddParam = () => {
    setEditingParamId(null)
    setParamDraft(emptyParamDraft())
    setParamModalOpen(true)
  }

  const openEditParam = (p) => {
    setEditingParamId(p.id)
    setParamDraft({
      name: p.parameter_label || p.parameter_key,
      scope: p.scope,
      canton: p.canton_code || '',
      taxYear: String(p.tax_year),
      valueType: p.value_type,
      value: p.value_numeric ?? '',
      notes: p.notes || '',
      sourceUrl: p.source_url || '',
      lastVerifiedAt: p.last_verified_at ? p.last_verified_at.slice(0, 10) : ''
    })
    setParamModalOpen(true)
  }

  const closeParamModal = () => {
    if (paramSaving) return
    setParamModalOpen(false)
  }

  const paramDraftValid =
    paramDraft.name.trim() &&
    paramDraft.taxYear &&
    (paramDraft.scope === 'federal' || paramDraft.canton) &&
    (paramDraft.valueType === 'no_cap' || paramDraft.value !== '')

  const saveParameter = async () => {
    if (!paramDraftValid) return
    setParamSaving(true)
    try {
      const name = paramDraft.name.trim()
      const taxYear = Number(paramDraft.taxYear)
      const cantonCode = paramDraft.scope === 'cantonal' ? paramDraft.canton : null
      const lastVerifiedAt = paramDraft.lastVerifiedAt
        ? new Date(paramDraft.lastVerifiedAt).toISOString()
        : new Date().toISOString()

      if (editingParamId) {
        // Renaming only ever touches the label — parameter_key stays put.
        const updated = await api.updateTaxParameter(editingParamId, {
          parameter_label: name,
          scope: paramDraft.scope,
          canton_code: cantonCode,
          tax_year: taxYear,
          value_type: paramDraft.valueType,
          value_numeric: paramDraft.value === '' ? null : Number(paramDraft.value),
          notes: paramDraft.notes.trim() || null,
          source_url: paramDraft.sourceUrl.trim() || null,
          last_verified_at: lastVerifiedAt
        })
        setParameters((list) => list.map((p) => (p.id === editingParamId ? updated : p)))
      } else {
        const existingKeys = new Set(
          parameters
            .filter((p) => p.scope === paramDraft.scope && (p.canton_code || '') === (cantonCode || '') && p.tax_year === taxYear)
            .map((p) => p.parameter_key)
        )
        const parameter_key = uniqueSlug(slugify(name), existingKeys)
        const created = await api.createTaxParameter({
          scope: paramDraft.scope,
          canton_code: cantonCode,
          tax_year: taxYear,
          parameter_key,
          parameter_label: name,
          value_type: paramDraft.valueType,
          value_numeric: paramDraft.value === '' ? null : Number(paramDraft.value),
          notes: paramDraft.notes.trim() || null,
          source_url: paramDraft.sourceUrl.trim() || null,
          last_verified_at: lastVerifiedAt
        })
        setParameters((list) => [...list, created])
      }
      toast.success(t('common.saved'))
      setParamModalOpen(false)
    } catch (error) {
      console.error(error)
      toast.error(error.code === '23505' ? t('taxSettings.parameterExists') : error.message || t('common.error'))
    } finally {
      setParamSaving(false)
    }
  }

  const askDeleteParam = (p) => setParamDeleteTarget(p)
  const cancelDeleteParam = () => {
    if (paramDeleting) return
    setParamDeleteTarget(null)
  }
  const confirmDeleteParam = async () => {
    if (!paramDeleteTarget) return
    setParamDeleting(true)
    try {
      await api.deleteTaxParameter(paramDeleteTarget.id)
      setParameters((list) => list.filter((p) => p.id !== paramDeleteTarget.id))
      toast.success(t('common.saved'))
      setParamDeleteTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setParamDeleting(false)
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
        <div className="card card-pad space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-[170px]"
                value={scopeFilter}
                onChange={(e) => {
                  setScopeFilter(e.target.value)
                  if (e.target.value === 'federal') setCantonFilter('all')
                }}
                aria-label={t('taxSettings.scope')}
              >
                <option value="all">{t('taxSettings.allScopes')}</option>
                <option value="federal">{t('taxSettings.federal')}</option>
                <option value="cantonal">{t('taxSettings.cantonal')}</option>
              </Select>
              <Select
                className="w-[170px]"
                value={cantonFilter}
                onChange={(e) => setCantonFilter(e.target.value)}
                disabled={scopeFilter === 'federal'}
                aria-label={t('taxSettings.canton')}
              >
                <option value="all">{t('taxSettings.allCantons')}</option>
                {cantonsInUse.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <button type="button" className="btn-primary btn-sm" onClick={openAddParam}>
              <Plus size={16} aria-hidden="true" />
              {t('taxSettings.addParameter')}
            </button>
          </div>

          {filteredParameters.length ? (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full">
                <thead className="bg-sand">
                  <tr>
                    <th className="table-head">{t('taxSettings.parameterName')}</th>
                    <th className="table-head">{t('taxSettings.scope')}</th>
                    <th className="table-head">{t('taxSettings.value')}</th>
                    <th className="table-head">{t('taxSettings.taxYear')}</th>
                    <th className="table-head">{t('taxSettings.lastVerified')}</th>
                    <th className="table-head text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {filteredParameters.map((p) => (
                    <tr key={p.id}>
                      <td className="table-cell">
                        <p className="font-medium text-ink-900">{p.parameter_label || p.parameter_key}</p>
                        {p.notes ? <p className="mt-0.5 max-w-sm text-[12.5px] text-ink-400">{p.notes}</p> : null}
                        {p.source_url ? (
                          <a
                            href={p.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-gold-700 hover:underline"
                          >
                            <ExternalLink size={11} aria-hidden="true" />
                            {t('taxSettings.source')}
                          </a>
                        ) : null}
                      </td>
                      <td className="table-cell whitespace-nowrap text-ink-600">
                        {p.scope === 'federal' ? t('taxSettings.federal') : `${t('taxSettings.cantonal')} · ${p.canton_code}`}
                      </td>
                      <td className="table-cell whitespace-nowrap text-ink-700">
                        {formatParamValue(p)}
                        <span className="ml-1.5 text-[11.5px] text-ink-400">
                          ({t(`taxSettings.valueType_${p.value_type}`)})
                        </span>
                      </td>
                      <td className="table-cell text-ink-600">{p.tax_year}</td>
                      <td className="table-cell whitespace-nowrap">
                        {p.last_verified_at ? (
                          <span className="text-[12.5px] text-emerald-700">{formatDate(p.last_verified_at, lang)}</span>
                        ) : (
                          <span className="text-[12.5px] font-medium text-amber-700">{t('taxSettings.notVerified')}</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => openEditParam(p)}
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-ink-400 hover:text-red-700"
                            onClick={() => askDeleteParam(p)}
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
            <EmptyState icon={Settings2} title={t('taxSettings.noParameters')} />
          )}
        </div>
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

      <Modal
        open={paramModalOpen}
        onClose={closeParamModal}
        title={editingParamId ? t('taxSettings.editParameter') : t('taxSettings.addParameter')}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={closeParamModal} disabled={paramSaving}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={saveParameter}
              disabled={paramSaving || !paramDraftValid}
            >
              {paramSaving ? <Spinner size={16} /> : null}
              {paramSaving ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('taxSettings.parameterName')} htmlFor="param-name" required>
            <TextInput
              id="param-name"
              value={paramDraft.name}
              onChange={(e) => setParamDraft((d) => ({ ...d, name: e.target.value }))}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('taxSettings.scope')} htmlFor="param-scope" required>
              <Select
                id="param-scope"
                value={paramDraft.scope}
                onChange={(e) =>
                  setParamDraft((d) => ({ ...d, scope: e.target.value, canton: e.target.value === 'federal' ? '' : d.canton }))
                }
              >
                <option value="federal">{t('taxSettings.federal')}</option>
                <option value="cantonal">{t('taxSettings.cantonal')}</option>
              </Select>
            </Field>
            <Field label={t('taxSettings.canton')} htmlFor="param-canton" required={paramDraft.scope === 'cantonal'}>
              <Select
                id="param-canton"
                value={paramDraft.canton}
                onChange={(e) => setParamDraft((d) => ({ ...d, canton: e.target.value }))}
                disabled={paramDraft.scope === 'federal'}
              >
                <option value="">{t('common.none')}</option>
                {CANTONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('taxSettings.taxYear')} htmlFor="param-year" required>
              <TextInput
                id="param-year"
                type="number"
                value={paramDraft.taxYear}
                onChange={(e) => setParamDraft((d) => ({ ...d, taxYear: e.target.value }))}
              />
            </Field>
            <Field label={t('taxSettings.valueType')} htmlFor="param-value-type" required>
              <Select
                id="param-value-type"
                value={paramDraft.valueType}
                onChange={(e) => setParamDraft((d) => ({ ...d, valueType: e.target.value }))}
              >
                {PARAM_VALUE_TYPES.map((vt) => (
                  <option key={vt} value={vt}>
                    {t(`taxSettings.valueType_${vt}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label={paramDraft.valueType === 'percentage' ? t('taxSettings.valuePercent') : t('taxSettings.valueAmount')}
            htmlFor="param-value"
            required={paramDraft.valueType !== 'no_cap'}
            hint={paramDraft.valueType === 'no_cap' ? t('taxSettings.noCapHint') : undefined}
          >
            <TextInput
              id="param-value"
              type="number"
              value={paramDraft.value}
              onChange={(e) => setParamDraft((d) => ({ ...d, value: e.target.value }))}
              disabled={paramDraft.valueType === 'no_cap'}
            />
          </Field>

          <Field label={t('taxSettings.notes')} htmlFor="param-notes" hint={t('taxSettings.notesHint')}>
            <Textarea
              id="param-notes"
              rows={2}
              value={paramDraft.notes}
              onChange={(e) => setParamDraft((d) => ({ ...d, notes: e.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('taxSettings.source')} htmlFor="param-source">
              <TextInput
                id="param-source"
                type="url"
                placeholder="https://…"
                value={paramDraft.sourceUrl}
                onChange={(e) => setParamDraft((d) => ({ ...d, sourceUrl: e.target.value }))}
              />
            </Field>
            <Field label={t('taxSettings.lastVerified')} htmlFor="param-verified" hint={t('taxSettings.lastVerifiedHint')}>
              <TextInput
                id="param-verified"
                type="date"
                value={paramDraft.lastVerifiedAt}
                onChange={(e) => setParamDraft((d) => ({ ...d, lastVerifiedAt: e.target.value }))}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!paramDeleteTarget}
        onClose={cancelDeleteParam}
        title={t('taxSettings.deleteParameterConfirm')}
        description={
          paramDeleteTarget
            ? t('taxSettings.deleteParameterConfirmBody', {
                label: paramDeleteTarget.parameter_label || paramDeleteTarget.parameter_key
              })
            : ''
        }
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={cancelDeleteParam} disabled={paramDeleting}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-danger btn-sm" onClick={confirmDeleteParam} disabled={paramDeleting}>
              {paramDeleting ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
              {paramDeleting ? t('common.deleting') : t('common.delete')}
            </button>
          </>
        }
      />
    </div>
  )
}
