import { AlertTriangle, Check, Eye, FileText, Link2, Split } from 'lucide-react'
import clsx from 'clsx'
import { Spinner } from './ui'
import { useI18n } from '../i18n'
import { docTypeLabel } from '../lib/labels'

// Tax Summary's by-category reading of the extraction: every bank account
// in one place, every property in one place, regardless of which document
// each row came from (src/lib/categoryEntities.js builds the grouping).
//
// The by-document view answers "what does this file say". This one answers
// "how many properties does this client have, and what do we know about
// each" — so the one thing it must never lose is where each figure came
// from: every value keeps its own source-document link, and a merged
// entity shows which document contributed what.
//
// Read-only on purpose. Editing a value stays in the by-document view,
// where a value belongs to exactly one document and there is no ambiguity
// about what is being changed.
export default function CategoryEntityView({
  groups = [],
  suggestions = [],
  findingsByMember,
  documents = [],
  savingPairKey = null,
  viewingKey = null,
  onViewDocument,
  onViewSource,
  onResolveSuggestion
}) {
  const { t, lang } = useI18n()
  const fileNameOf = (documentId) => documents.find((d) => d.id === documentId)?.file_name || ''

  if (!groups.length) return null

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const groupSuggestions = suggestions.filter((s) => s.categoryCode === group.categoryCode)
        return (
          <section key={group.categoryCode} className="space-y-3">
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-700">
              {group.category ? docTypeLabel(group.category, lang) : group.categoryCode}
              <span className="text-[12.5px] font-normal text-ink-400">
                {t('summary.entityCount', { count: group.entities.length })}
              </span>
            </h3>

            {/* Only probably the same thing — never merged behind the
                specialist's back, see migration 48. */}
            {groupSuggestions.map((suggestion) => {
              const pair = suggestion.keys.join('::')
              const busy = savingPairKey === pair
              return (
                <div
                  key={pair}
                  className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="flex items-start gap-1.5 text-[13.5px] text-ink-800">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                      <span>
                        {suggestion.reason === 'missingIdentifier'
                          ? t('summary.mergeSuggestMissing', {
                              identified: suggestion.labels.find(Boolean) || '',
                              documents: suggestion.documentIds.map(fileNameOf).filter(Boolean).join(', ')
                            })
                          : t(
                              suggestion.reason === 'probableIdentifier'
                                ? 'summary.mergeSuggestProbable'
                                : 'summary.mergeSuggestSimilar',
                              { a: suggestion.labels[0] || '', b: suggestion.labels[1] || '' }
                            )}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => onResolveSuggestion?.(suggestion, 'merged')}
                      >
                        {busy ? <Spinner size={13} /> : <Link2 size={13} aria-hidden="true" />}
                        {t('summary.mergeConfirm')}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => onResolveSuggestion?.(suggestion, 'separate')}
                      >
                        <Split size={13} aria-hidden="true" />
                        {t('summary.mergeKeepSeparate')}
                      </button>
                    </span>
                  </div>
                </div>
              )
            })}

            <div className="space-y-3">
              {group.entities.map((entity) => {
                const entityFindings = entity.members.flatMap(
                  (m) => findingsByMember?.(m.documentId, m.rowKey) || []
                )
                return (
                  <div key={entity.key} className="rounded-xl border border-line bg-white">
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-sand/30 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-ink-900">
                          {entity.label || (
                            <span className="font-medium text-amber-700">{t('summary.rowUnidentified')}</span>
                          )}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-400">
                          {entity.members.map((member) => (
                            <button
                              key={`${member.documentId}:${member.rowKey}`}
                              type="button"
                              className="inline-flex items-center gap-1 text-gold-700 underline decoration-gold-300 underline-offset-2 hover:text-gold-800"
                              onClick={() => onViewDocument?.(member.documentId)}
                            >
                              <FileText size={11} aria-hidden="true" />
                              {member.fileName}
                            </button>
                          ))}
                        </p>
                      </div>
                      {entity.mergedBy ? (
                        <span
                          className={clsx(
                            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                            entity.mergedBy === 'decision'
                              ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                              : 'bg-gold-50 text-gold-800 ring-1 ring-inset ring-gold-200'
                          )}
                        >
                          {entity.mergedBy === 'decision' ? (
                            <Check size={11} aria-hidden="true" />
                          ) : (
                            <Link2 size={11} aria-hidden="true" />
                          )}
                          {t(
                            entity.mergedBy === 'decision'
                              ? 'summary.entityMergedConfirmed'
                              : 'summary.entityMergedIdentifier',
                            { count: entity.documentIds.length }
                          )}
                        </span>
                      ) : null}
                    </div>

                    {entityFindings.length ? (
                      <ul className="space-y-1 border-b border-line bg-amber-50/40 px-3 py-2">
                        {entityFindings.map((finding, idx) => (
                          <li
                            key={`${finding.kind}:${finding.fieldKey || ''}:${idx}`}
                            className="flex items-start gap-1.5 text-[12.5px] text-amber-800"
                          >
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                            {finding.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <ul className="divide-y divide-line/70">
                      {entity.values.map((block) => (
                        <li key={block.fieldKey} className="px-3 py-1.5">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13.5px]">
                            <span className="font-medium text-ink-900">{block.fieldLabel}:</span>
                            {block.entries.map((entry, idx) => (
                              <span
                                key={`${entry.documentId}:${entry.rowKey}:${idx}`}
                                className="inline-flex items-center gap-1"
                              >
                                <span className={clsx(entry.includedInCalculation ? 'text-ink-900' : 'text-ink-400 line-through')}>
                                  {entry.value}
                                </span>
                                {/* Which document said THIS value — shown
                                    whenever the entity spans more than one,
                                    so a merge never blurs provenance. */}
                                {entity.documentIds.length > 1 ? (
                                  <button
                                    type="button"
                                    className="text-[11.5px] text-ink-400 underline decoration-ink-200 underline-offset-2 hover:text-gold-800"
                                    onClick={() => onViewDocument?.(entry.documentId)}
                                  >
                                    {entry.fileName}
                                  </button>
                                ) : null}
                                {entry.sourceQuote || entry.sourcePage ? (
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm"
                                    disabled={viewingKey === `${entry.documentId}:${entry.fieldKey}:${entry.rowKey}`}
                                    onClick={() => onViewSource?.(entry)}
                                    title={t('extraction.viewSource')}
                                    aria-label={t('extraction.viewSource')}
                                  >
                                    {viewingKey === `${entry.documentId}:${entry.fieldKey}:${entry.rowKey}` ? (
                                      <Spinner size={12} />
                                    ) : (
                                      <Eye size={12} aria-hidden="true" />
                                    )}
                                  </button>
                                ) : null}
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
