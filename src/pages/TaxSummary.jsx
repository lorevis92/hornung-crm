import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import CaseAssistant from '../components/CaseAssistant'
import { LoadGate } from '../components/LoadState'
import HouseholdCard from '../components/summary/HouseholdCard'
import SummaryDocument from '../components/summary/SummaryDocument'
import { EmptyState } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { fullName } from '../lib/format'
import { resolvePersonDisplayOrder } from '../lib/personOrder'
import { buildDocumentList, householdOf, loadTaxSummary } from '../lib/taxSummaryData'
import { useLoad } from '../lib/useLoad'

// Tax Summary: the household, then every document of the case/year, one by
// one, each saying first whom it refers to and, opened, everything read from
// it. Read-only; the only action is "Riprova estrazione". A document opens in
// a new browser tab on the full-page viewer (src/lib/documentViewer.js), so
// this page stays exactly where it was.
export default function TaxSummary() {
  const { caseId } = useParams()
  const { t } = useI18n()
  const toast = useToast()

  const [data, setData] = useState(null)
  const [openIds, setOpenIds] = useState(() => new Set())
  const [retryingId, setRetryingId] = useState(null)

  const loadState = useLoad(
    useCallback(
      async (isCurrent) => {
        const loaded = await loadTaxSummary(api, caseId)
        if (isCurrent()) setData(loaded)
      },
      [caseId]
    )
  )

  const household = useMemo(() => householdOf(data?.questionnaire), [data])
  const personOrder = useMemo(
    () =>
      resolvePersonDisplayOrder({
        primaryPerson: household.primary,
        spousePerson: household.spouse,
        overrideOrder: data?.caseRow?.client?.person_order_override || null
      }),
    [household, data]
  )
  const items = useMemo(
    () =>
      data
        ? buildDocumentList({
            ...data,
            household,
            personOrderOverride: data.caseRow?.client?.person_order_override || null
          })
        : [],
    [data, household]
  )
  const failedCount = items.filter((i) => i.doc.status === 'extraction_failed').length

  const toggleItem = (documentId) =>
    setOpenIds((ids) => {
      const next = new Set(ids)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })

  const retryExtraction = async (doc) => {
    setRetryingId(doc.id)
    try {
      await api.retryExtraction(doc.id)
      toast.success(t('summary.retryDone'))
      await loadState.refresh()
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setRetryingId(null)
    }
  }

  if (loadState.status !== 'ready') return <LoadGate load={loadState} showDetail />
  if (!data) return <EmptyState icon={FolderOpen} title={t('common.error')} />

  const coupleName =
    personOrder.ordered.map((o) => fullName(o.person)).filter(Boolean).join(' & ') ||
    fullName(data.caseRow.client) ||
    data.caseRow.client?.email ||
    ''

  return (
    <div className="space-y-6">
      <Link
        to={`/year/${caseId}`}
        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {t('summary.backToCase')}
      </Link>

      <div>
        <p className="eyebrow">{t('summary.title')}</p>
        <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">
          {t('summary.subtitle', { name: coupleName, year: data.caseRow.tax_year })}
        </h1>
        <p className="mt-1 text-[14.5px] text-ink-500">{t('summary.pageHelp')}</p>
      </div>

      <HouseholdCard
        clientId={data.caseRow.client_id}
        household={household}
        properties={data.questionnaire?.properties || []}
        personOrder={personOrder}
      />

      <section className="space-y-3">
        <div>
          <h2 className="section-title text-xl">{t('summary.documentsTitle')}</h2>
          <p className="section-sub">
            {t('summary.documentsHelp', { count: items.length })}
            {failedCount ? ` ${t('summary.documentsFailed', { count: failedCount })}` : ''}
          </p>
        </div>
        {items.length ? (
          <ul className="space-y-2">
            {items.map((item) => (
              <SummaryDocument
                key={item.doc.id}
                item={item}
                open={openIds.has(item.doc.id)}
                onToggle={() => toggleItem(item.doc.id)}
                onRetry={() => retryExtraction(item.doc)}
                retrying={retryingId === item.doc.id}
              />
            ))}
          </ul>
        ) : (
          <EmptyState icon={FolderOpen} title={t('summary.noDocuments')} />
        )}
      </section>

      <CaseAssistant caseId={caseId} />
    </div>
  )
}
