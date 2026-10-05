import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import Modal from '../Modal'
import { Checkbox, EmptyState, Field, Spinner, Textarea, TextInput } from '../ui'
import { useToast } from '../../context/ToastContext'
import { useI18n } from '../../i18n'
import { api } from '../../lib/data'
import { formatChf } from '../../lib/format'
import { slugify, uniqueSlug } from '../../lib/slug'

// Only the "further services" (kind === 'service') can be freely
// added/removed/reordered — the base price list's rows (base/per_unit/
// tier/surcharge) are structural to the fee estimator's own formula
// (src/lib/pricing.js's estimateFee matches specific codes), so those can
// only be renamed/re-priced here, never added or removed.
const ADHOC_PRICING_KIND = 'service'
const BASE_PRICING_KINDS = ['base', 'per_unit', 'tier', 'surcharge']

function emptyPricingDraft() {
  return {
    code: '',
    labelEn: '',
    labelDe: '',
    labelFr: '',
    labelIt: '',
    descriptionEn: '',
    descriptionDe: '',
    descriptionFr: '',
    descriptionIt: '',
    price: '',
    onRequest: false
  }
}

// The price list behind the fee estimate (pricing_items).
export default function PricingTab({ pricingItems, setPricingItems }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [pricingModalOpen, setPricingModalOpen] = useState(false)
  const [editingPricingId, setEditingPricingId] = useState(null)
  const [pricingDraft, setPricingDraft] = useState(emptyPricingDraft)
  const [pricingSaving, setPricingSaving] = useState(false)
  const [pricingDeleteTarget, setPricingDeleteTarget] = useState(null)
  const [pricingDeleting, setPricingDeleting] = useState(false)
  const [pricingBusyId, setPricingBusyId] = useState(null)

  const basePricingItems = useMemo(
    () => pricingItems.filter((p) => BASE_PRICING_KINDS.includes(p.kind)).sort((a, b) => a.sort_order - b.sort_order),
    [pricingItems]
  )
  const servicePricingItems = useMemo(
    () =>
      pricingItems
        .filter((p) => p.kind === ADHOC_PRICING_KIND && p.active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [pricingItems]
  )

  const openEditPricing = (item) => {
    setEditingPricingId(item.id)
    setPricingDraft({
      code: item.code,
      labelEn: item.label_en || '',
      labelDe: item.label_de || '',
      labelFr: item.label_fr || '',
      labelIt: item.label_it || '',
      descriptionEn: item.description_en || '',
      descriptionDe: item.description_de || '',
      descriptionFr: item.description_fr || '',
      descriptionIt: item.description_it || '',
      price: item.price != null ? String(item.price) : '',
      onRequest: Boolean(item.on_request)
    })
    setPricingModalOpen(true)
  }

  const openAddService = () => {
    setEditingPricingId(null)
    setPricingDraft(emptyPricingDraft())
    setPricingModalOpen(true)
  }

  const closePricingModal = () => {
    if (pricingSaving) return
    setPricingModalOpen(false)
  }

  const pricingDraftValid =
    pricingDraft.labelEn.trim() && (pricingDraft.onRequest || pricingDraft.price !== '')

  const savePricing = async () => {
    if (!pricingDraftValid) return
    setPricingSaving(true)
    try {
      const patch = {
        label_en: pricingDraft.labelEn.trim(),
        label_de: pricingDraft.labelDe.trim() || null,
        label_fr: pricingDraft.labelFr.trim() || null,
        label_it: pricingDraft.labelIt.trim() || null,
        description_en: pricingDraft.descriptionEn.trim() || null,
        description_de: pricingDraft.descriptionDe.trim() || null,
        description_fr: pricingDraft.descriptionFr.trim() || null,
        description_it: pricingDraft.descriptionIt.trim() || null,
        on_request: pricingDraft.onRequest,
        price: pricingDraft.onRequest ? 0 : Number(pricingDraft.price)
      }
      if (editingPricingId) {
        const updated = await api.updatePricingItem(editingPricingId, patch)
        setPricingItems((list) => list.map((p) => (p.id === editingPricingId ? updated : p)))
      } else {
        const existingCodes = new Set(pricingItems.map((p) => p.code))
        const code = uniqueSlug(slugify(pricingDraft.labelEn), existingCodes)
        const nextSortOrder = servicePricingItems.length
          ? Math.max(...servicePricingItems.map((p) => p.sort_order)) + 10
          : 10
        const created = await api.createPricingItem({
          code,
          kind: ADHOC_PRICING_KIND,
          sort_order: nextSortOrder,
          ...patch
        })
        setPricingItems((list) => [...list, created])
      }
      toast.success(t('common.saved'))
      setPricingModalOpen(false)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setPricingSaving(false)
    }
  }

  const askDeletePricing = (item) => setPricingDeleteTarget(item)
  const cancelDeletePricing = () => {
    if (pricingDeleting) return
    setPricingDeleteTarget(null)
  }
  const confirmDeletePricing = async () => {
    if (!pricingDeleteTarget) return
    setPricingDeleting(true)
    try {
      await api.deletePricingItem(pricingDeleteTarget.id)
      setPricingItems((list) => list.filter((p) => p.id !== pricingDeleteTarget.id))
      toast.success(t('common.saved'))
      setPricingDeleteTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setPricingDeleting(false)
    }
  }

  const moveService = async (item, direction) => {
    const idx = servicePricingItems.findIndex((p) => p.id === item.id)
    const other = servicePricingItems[idx + direction]
    if (!other) return
    setPricingBusyId(item.id)
    try {
      const [updatedA, updatedB] = await Promise.all([
        api.updatePricingItem(item.id, { sort_order: other.sort_order }),
        api.updatePricingItem(other.id, { sort_order: item.sort_order })
      ])
      setPricingItems((list) =>
        list.map((p) => {
          if (p.id === updatedA.id) return updatedA
          if (p.id === updatedB.id) return updatedB
          return p
        })
      )
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setPricingBusyId(null)
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="card card-pad space-y-4">
          <div>
            <h2 className="section-title text-xl">{t('taxSettings.pricingBaseTitle')}</h2>
            <p className="section-sub">{t('taxSettings.pricingBaseHelp')}</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full">
              <thead className="bg-sand">
                <tr>
                  <th className="table-head">{t('taxSettings.pricingName')}</th>
                  <th className="table-head text-right">{t('taxSettings.pricingPrice')}</th>
                  <th className="table-head text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {basePricingItems.map((item) => (
                  <tr key={item.id}>
                    <td className="table-cell">
                      <p className="font-medium text-ink-900">{item.label_en}</p>
                      {item.description_en ? (
                        <p className="mt-0.5 max-w-md text-[12.5px] text-ink-400">{item.description_en}</p>
                      ) : null}
                    </td>
                    <td className="table-cell whitespace-nowrap text-right tabular-nums text-ink-700">
                      {item.on_request ? t('pricing.onRequest') : formatChf(item.price, lang)}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => openEditPricing(item)}
                          title={t('common.edit')}
                          aria-label={t('common.edit')}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-pad space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title text-xl">{t('taxSettings.pricingServicesTitle')}</h2>
              <p className="section-sub">{t('taxSettings.pricingServicesHelp')}</p>
            </div>
            <button type="button" className="btn-primary btn-sm" onClick={openAddService}>
              <Plus size={16} aria-hidden="true" />
              {t('taxSettings.addService')}
            </button>
          </div>

          {servicePricingItems.length ? (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full">
                <thead className="bg-sand">
                  <tr>
                    <th className="table-head">{t('taxSettings.pricingName')}</th>
                    <th className="table-head text-right">{t('taxSettings.pricingPrice')}</th>
                    <th className="table-head text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {servicePricingItems.map((item, idx) => (
                    <tr key={item.id}>
                      <td className="table-cell">
                        <p className="font-medium text-ink-900">{item.label_en}</p>
                        {item.description_en ? (
                          <p className="mt-0.5 max-w-md text-[12.5px] text-ink-400">{item.description_en}</p>
                        ) : null}
                      </td>
                      <td className="table-cell whitespace-nowrap text-right tabular-nums text-ink-700">
                        {item.on_request ? t('pricing.onRequest') : formatChf(item.price, lang)}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={idx === 0 || pricingBusyId === item.id}
                            onClick={() => moveService(item, -1)}
                            title={t('taxSettings.moveUp')}
                            aria-label={t('taxSettings.moveUp')}
                          >
                            <ArrowUp size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={idx === servicePricingItems.length - 1 || pricingBusyId === item.id}
                            onClick={() => moveService(item, 1)}
                            title={t('taxSettings.moveDown')}
                            aria-label={t('taxSettings.moveDown')}
                          >
                            <ArrowDown size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => openEditPricing(item)}
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-ink-400 hover:text-red-700"
                            onClick={() => askDeletePricing(item)}
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
            <EmptyState icon={Settings2} title={t('taxSettings.noServices')} />
          )}
        </div>
      </div>

    <Modal
      open={pricingModalOpen}
      onClose={closePricingModal}
      title={editingPricingId ? t('taxSettings.editPricing') : t('taxSettings.addService')}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary btn-sm" onClick={closePricingModal} disabled={pricingSaving}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={savePricing}
            disabled={pricingSaving || !pricingDraftValid}
          >
            {pricingSaving ? <Spinner size={16} /> : null}
            {pricingSaving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('taxSettings.pricingLabelEn')} htmlFor="pricing-label-en" required>
            <TextInput
              id="pricing-label-en"
              value={pricingDraft.labelEn}
              onChange={(e) => setPricingDraft((d) => ({ ...d, labelEn: e.target.value }))}
              autoFocus
            />
          </Field>
          <Field label={t('taxSettings.pricingLabelDe')} htmlFor="pricing-label-de">
            <TextInput
              id="pricing-label-de"
              value={pricingDraft.labelDe}
              onChange={(e) => setPricingDraft((d) => ({ ...d, labelDe: e.target.value }))}
            />
          </Field>
          <Field label={t('taxSettings.pricingLabelFr')} htmlFor="pricing-label-fr">
            <TextInput
              id="pricing-label-fr"
              value={pricingDraft.labelFr}
              onChange={(e) => setPricingDraft((d) => ({ ...d, labelFr: e.target.value }))}
            />
          </Field>
          <Field label={t('taxSettings.pricingLabelIt')} htmlFor="pricing-label-it">
            <TextInput
              id="pricing-label-it"
              value={pricingDraft.labelIt}
              onChange={(e) => setPricingDraft((d) => ({ ...d, labelIt: e.target.value }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('taxSettings.pricingDescriptionEn')} htmlFor="pricing-desc-en">
            <Textarea
              id="pricing-desc-en"
              rows={2}
              value={pricingDraft.descriptionEn}
              onChange={(e) => setPricingDraft((d) => ({ ...d, descriptionEn: e.target.value }))}
            />
          </Field>
          <Field label={t('taxSettings.pricingDescriptionDe')} htmlFor="pricing-desc-de">
            <Textarea
              id="pricing-desc-de"
              rows={2}
              value={pricingDraft.descriptionDe}
              onChange={(e) => setPricingDraft((d) => ({ ...d, descriptionDe: e.target.value }))}
            />
          </Field>
          <Field label={t('taxSettings.pricingDescriptionFr')} htmlFor="pricing-desc-fr">
            <Textarea
              id="pricing-desc-fr"
              rows={2}
              value={pricingDraft.descriptionFr}
              onChange={(e) => setPricingDraft((d) => ({ ...d, descriptionFr: e.target.value }))}
            />
          </Field>
          <Field label={t('taxSettings.pricingDescriptionIt')} htmlFor="pricing-desc-it">
            <Textarea
              id="pricing-desc-it"
              rows={2}
              value={pricingDraft.descriptionIt}
              onChange={(e) => setPricingDraft((d) => ({ ...d, descriptionIt: e.target.value }))}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t('taxSettings.pricingPrice')}
            htmlFor="pricing-price"
            required={!pricingDraft.onRequest}
            className="w-[160px]"
          >
            <TextInput
              id="pricing-price"
              type="number"
              min="0"
              step="0.01"
              value={pricingDraft.price}
              onChange={(e) => setPricingDraft((d) => ({ ...d, price: e.target.value }))}
              disabled={pricingDraft.onRequest}
            />
          </Field>
          <Checkbox
            id="pricing-on-request"
            label={t('taxSettings.pricingOnRequest')}
            checked={pricingDraft.onRequest}
            onChange={(e) => setPricingDraft((d) => ({ ...d, onRequest: e.target.checked }))}
          />
        </div>
      </div>
    </Modal>

    <Modal
      open={!!pricingDeleteTarget}
      onClose={cancelDeletePricing}
      title={t('taxSettings.deletePricingConfirm')}
      description={
        pricingDeleteTarget
          ? t('taxSettings.deletePricingConfirmBody', { label: pricingDeleteTarget.label_en })
          : ''
      }
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary btn-sm" onClick={cancelDeletePricing} disabled={pricingDeleting}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-danger btn-sm" onClick={confirmDeletePricing} disabled={pricingDeleting}>
            {pricingDeleting ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
            {pricingDeleting ? t('common.deleting') : t('common.delete')}
          </button>
        </>
      }
    />
    </>
  )
}
