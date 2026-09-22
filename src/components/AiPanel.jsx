import { useMemo, useState } from 'react'
import { Sparkles, Quote, Send, Share2, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import { useI18n } from '../i18n'
import { EmptyState } from './ui'

const GROUP_ORDER = ['income', 'deductions', 'assets', 'property', 'other']

/**
 * Phase 2 panel — visible to the specialist only.
 * The layout, the data model and the "where does this value come from?" trail
 * are already in place; the extraction service just has to fill the table.
 */
export default function AiPanel({ fields = [] }) {
  const { t } = useI18n()
  const [openSource, setOpenSource] = useState(null)
  const [question, setQuestion] = useState('')

  const groups = useMemo(() => {
    const byGroup = fields.reduce((acc, f) => {
      ;(acc[f.group_key || 'other'] ||= []).push(f)
      return acc
    }, {})
    return GROUP_ORDER.filter((g) => byGroup[g]?.length).map((g) => [g, byGroup[g]])
  }, [fields])

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Sparkles size={19} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <p className="text-[15px] font-semibold text-ink-900">{t('case.aiPanel')}</p>
            <p className="text-[13px] text-ink-400">{t('case.aiPanelHelp')}</p>
          </div>
        </div>
        <span className="chip bg-gold-50 text-gold-800 ring-gold-200">{t('case.aiPhase2')}</span>
      </div>

      <div className="px-4 py-4">
        {groups.length ? (
          <div className="space-y-5">
            {groups.map(([group, rows]) => (
              <div key={group}>
                <p className="eyebrow mb-2">{t(`docCat.${group}`)}</p>
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {rows.map((field) => {
                    const open = openSource === field.id
                    const confidence = Number(field.confidence || 0)
                    return (
                      <li key={field.id} className="bg-white">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                          <span className="min-w-[180px] flex-1 text-[14.5px] text-ink-600">
                            {field.field_label || field.field_key}
                          </span>
                          <span className="font-mono text-[15px] font-semibold text-ink-900">
                            {field.currency ? `${field.currency} ` : ''}
                            {field.field_value}
                          </span>
                          <span
                            className={clsx(
                              'chip px-2 py-0.5 text-[11.5px]',
                              confidence >= 0.95
                                ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                                : confidence >= 0.85
                                  ? 'bg-amber-50 text-amber-800 ring-amber-200'
                                  : 'bg-red-50 text-red-800 ring-red-200'
                            )}
                            title={t('case.confidence')}
                          >
                            {Math.round(confidence * 100)}%
                          </span>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => setOpenSource(open ? null : field.id)}
                            aria-expanded={open}
                          >
                            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                            {t('case.source')}
                          </button>
                        </div>

                        {open ? (
                          <div className="border-t border-line bg-sand/70 px-3.5 py-3">
                            <p className="text-[13px] font-medium text-ink-500">
                              {field.document_name || '—'}
                              {field.source_page ? ` · p. ${field.source_page}` : ''}
                            </p>
                            {field.source_snippet ? (
                              <p className="mt-1.5 flex gap-2 text-[14px] italic leading-relaxed text-ink-700">
                                <Quote size={14} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
                                {field.source_snippet}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Sparkles} title={t('case.aiEmpty')} description={t('case.aiPhase2Help')} />
        )}

        <div className="mt-5 rounded-xl bg-sand px-4 py-3.5">
          <label className="label" htmlFor="ai-question">
            {t('case.askAi')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="ai-question"
              className="input flex-1"
              placeholder={t('case.askAiPlaceholder')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled
            />
            <button type="button" className="btn-secondary" disabled>
              <Send size={16} aria-hidden="true" />
              {t('case.askAi')}
            </button>
          </div>
          <p className="hint">{t('case.askAiDisabled')}</p>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line px-4 py-3">
          <p className="text-[13.5px] text-ink-400">{t('case.exportPhase3')}</p>
          <button type="button" className="btn-secondary btn-sm" disabled>
            <Share2 size={15} aria-hidden="true" />
            {t('case.exportDoctorTax')}
          </button>
        </div>
      </div>
    </div>
  )
}
