import { useMemo, useState } from 'react'
import { Calculator, Plus, RotateCcw, X } from 'lucide-react'
import clsx from 'clsx'
import { Select, TextInput } from './ui'
import { useI18n } from '../i18n'
import { estimateFee, pricingLabel } from '../lib/pricing'
import { formatChf } from '../lib/format'

// The two surcharges have their own dedicated checkboxes below, driven by
// their own tax_cases columns — they must not also appear in the "add a
// line" picker, or the same thing would be switchable from two places.
const SURCHARGE_CODES = new Set(['postal_delivery', 'express'])

// The fee estimate for one case. Read-only for the client (Pricing.jsx);
// editable for the consultant, who can switch any derived line off, add a
// price-list item the Questionnaire doesn't imply, and — when none of that
// gets to the right number — type the total by hand.
//
// Everything editable here is persisted through onToggle, which is
// CasePage's toggleCaseOption: a plain api.updateCase patch. The automatic
// estimate underneath never stops being computed, so a case whose
// Questionnaire changes still tracks it; the consultant's edits are stored
// as the difference from it (see migration 47), not as a frozen copy.
export default function FeeEstimatePanel({
  pricing = [],
  questionnaire,
  caseRow,
  editable = false,
  onToggle,
  compact = false
}) {
  const { t, lang } = useI18n()
  const [overrideDraft, setOverrideDraft] = useState('')
  const [adding, setAdding] = useState('')

  const excludedCodes = caseRow?.fee_excluded_codes || []
  const extraCodes = caseRow?.fee_extra_codes || []

  const estimate = useMemo(
    () =>
      estimateFee(
        pricing,
        {
          persons: questionnaire?.persons || [],
          properties: questionnaire?.properties || [],
          deliveryByPost: caseRow?.delivery_by_post,
          express: caseRow?.express,
          excludedCodes,
          extraCodes,
          totalOverride: caseRow?.fee_total_override
        },
        lang
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricing, questionnaire, caseRow, lang]
  )

  // Only what isn't already on the estimate, and never the two surcharges
  // that have their own checkboxes.
  const addableItems = useMemo(() => {
    const present = new Set(estimate.lines.map((l) => l.code))
    return pricing
      .filter((item) => item.active !== false && !present.has(item.code) && !SURCHARGE_CODES.has(item.code))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }, [pricing, estimate.lines])

  const setExcluded = (code, excluded) => {
    const next = excluded
      ? [...new Set([...excludedCodes, code])]
      : excludedCodes.filter((c) => c !== code)
    onToggle?.({ fee_excluded_codes: next })
  }

  const addLine = (code) => {
    if (!code) return
    setAdding('')
    onToggle?.({
      fee_extra_codes: [...new Set([...extraCodes, code])],
      // Adding something that was previously switched off means switching
      // it back on, not holding both states at once.
      fee_excluded_codes: excludedCodes.filter((c) => c !== code)
    })
  }

  const removeExtra = (code) => {
    onToggle?.({ fee_extra_codes: extraCodes.filter((c) => c !== code) })
  }

  const applyOverride = () => {
    const parsed = Number(String(overrideDraft).replace(/['\s]/g, '').replace(/,/g, '.'))
    if (!Number.isFinite(parsed)) return
    setOverrideDraft('')
    onToggle?.({ fee_total_override: Number(parsed.toFixed(2)) })
  }

  const clearOverride = () => {
    setOverrideDraft('')
    onToggle?.({ fee_total_override: null })
  }

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
        <Calculator size={19} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
        <div>
          <p className="text-[15px] font-semibold text-ink-900">{t('case.feeEstimate')}</p>
          {!compact ? <p className="text-[13px] text-ink-400">{t('case.feeEstimateHelp')}</p> : null}
        </div>
      </div>

      <div className="px-4 py-3">
        {estimate.lines.length ? (
          <table className="w-full text-[14.5px]">
            <tbody className="divide-y divide-line">
              {estimate.lines.map((line) => (
                <tr key={line.code}>
                  <td className="py-2 pr-2">
                    <span className={clsx('flex items-center gap-2', line.excluded && 'text-ink-400')}>
                      {editable ? (
                        <input
                          type="checkbox"
                          className="checkbox shrink-0"
                          checked={!line.excluded}
                          onChange={(e) => setExcluded(line.code, !e.target.checked)}
                          aria-label={line.label}
                        />
                      ) : null}
                      <span className={clsx(line.excluded ? 'line-through' : 'text-ink-600')}>
                        {line.label}
                        {line.qty > 1 ? <span className="text-ink-400"> × {line.qty}</span> : null}
                      </span>
                      {line.source === 'extra' ? (
                        <span className="shrink-0 rounded-full bg-gold-50 px-1.5 py-0.5 text-[11px] font-medium text-gold-800">
                          {t('case.feeLineAdded')}
                        </span>
                      ) : null}
                      {editable && line.source === 'extra' ? (
                        <button
                          type="button"
                          className="btn-ghost btn-sm shrink-0"
                          onClick={() => removeExtra(line.code)}
                          aria-label={t('common.remove')}
                          title={t('common.remove')}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  </td>
                  <td
                    className={clsx(
                      'py-2 text-right font-medium tabular-nums',
                      line.excluded ? 'text-ink-300 line-through' : 'text-ink-900'
                    )}
                  >
                    {line.onRequest ? t('pricing.onRequest') : formatChf(line.amount, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-200">
                <td className="pt-2.5 font-semibold text-ink-900">{t('case.total')}</td>
                <td className="pt-2.5 text-right text-[17px] font-bold tabular-nums text-gold-800">
                  {formatChf(estimate.total, lang)}
                </td>
              </tr>
              {estimate.isOverridden ? (
                <tr>
                  <td colSpan={2} className="pt-1 text-right text-[12.5px] text-amber-700">
                    {t('case.feeTotalOverridden', { computed: formatChf(estimate.computedTotal, lang) })}
                  </td>
                </tr>
              ) : null}
            </tfoot>
          </table>
        ) : (
          <p className="py-2 text-[14.5px] text-ink-400">{t('pricing.noEstimate')}</p>
        )}

        {editable ? (
          <div className="mt-3 space-y-3 border-t border-line pt-3">
            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-[14px] text-ink-700">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={Boolean(caseRow?.delivery_by_post)}
                  onChange={(e) => onToggle?.({ delivery_by_post: e.target.checked })}
                />
                {t('case.deliveryByPost')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[14px] text-ink-700">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={Boolean(caseRow?.express)}
                  onChange={(e) => onToggle?.({ express: e.target.checked })}
                />
                {t('case.express')}
              </label>
            </div>

            {addableItems.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <Plus size={14} className="shrink-0 text-ink-400" aria-hidden="true" />
                <Select
                  className="max-w-[320px]"
                  value={adding}
                  onChange={(e) => addLine(e.target.value)}
                  aria-label={t('case.feeAddLine')}
                >
                  <option value="">{t('case.feeAddLine')}</option>
                  {addableItems.map((item) => (
                    <option key={item.code} value={item.code}>
                      {pricingLabel(item, lang)}
                      {item.on_request || !Number(item.price) ? '' : ` — ${formatChf(Number(item.price), lang)}`}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[13.5px] text-ink-600" htmlFor="fee-override">
                {t('case.feeOverrideLabel')}
              </label>
              <TextInput
                id="fee-override"
                inputMode="decimal"
                className="w-[140px]"
                value={overrideDraft}
                placeholder={
                  estimate.isOverridden
                    ? String(caseRow.fee_total_override)
                    : String(estimate.computedTotal)
                }
                onChange={(e) => setOverrideDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyOverride()
                  }
                }}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={applyOverride}
                disabled={!overrideDraft.trim()}
              >
                {t('case.feeOverrideApply')}
              </button>
              {estimate.isOverridden ? (
                <button type="button" className="btn-ghost btn-sm" onClick={clearOverride}>
                  <RotateCcw size={13} aria-hidden="true" />
                  {t('case.feeOverrideClear')}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="hint mt-2">{t('pricing.estimateDisclaimer')}</p>
      </div>
    </div>
  )
}
