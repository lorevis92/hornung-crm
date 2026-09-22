import { useMemo } from 'react'
import { Calculator } from 'lucide-react'
import { useI18n } from '../i18n'
import { estimateFee } from '../lib/pricing'
import { formatChf } from '../lib/format'

export default function FeeEstimatePanel({
  pricing = [],
  questionnaire,
  caseRow,
  editable = false,
  onToggle,
  compact = false
}) {
  const { t, lang } = useI18n()

  const estimate = useMemo(
    () =>
      estimateFee(
        pricing,
        {
          persons: questionnaire?.persons || [],
          properties: questionnaire?.properties || [],
          deliveryByPost: caseRow?.delivery_by_post,
          express: caseRow?.express
        },
        lang
      ),
    [pricing, questionnaire, caseRow, lang]
  )

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
                  <td className="py-2 pr-2 text-ink-600">
                    {line.label}
                    {line.qty > 1 ? <span className="text-ink-400"> × {line.qty}</span> : null}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums text-ink-900">
                    {formatChf(line.amount, lang)}
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
            </tfoot>
          </table>
        ) : (
          <p className="py-2 text-[14.5px] text-ink-400">{t('pricing.noEstimate')}</p>
        )}

        {editable ? (
          <div className="mt-3 flex flex-wrap gap-4 border-t border-line pt-3">
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
        ) : null}

        <p className="hint mt-2">{t('pricing.estimateDisclaimer')}</p>
      </div>
    </div>
  )
}
