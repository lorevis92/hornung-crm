import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import CaseAssistant from '../components/CaseAssistant'
import { LoadGate } from '../components/LoadState'
import HouseholdCard from '../components/summary/HouseholdCard'
import SummaryDocument from '../components/summary/SummaryDocument'
import { EmptyState, Spinner } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { fullName } from '../lib/format'
import { resolvePersonDisplayOrder } from '../lib/personOrder'
import { buildDocumentList, householdOf, loadTaxSummary } from '../lib/taxSummaryData'
import { resolveTaxSummaryView } from '../lib/taxSummaryView'
import { useLoad } from '../lib/useLoad'

// pdfjs-dist is a large dependency — only fetched when a document is opened.
const PdfSourceViewer = lazy(() => import('../components/PdfSourceViewer'))

// Tax Summary: the household, then every document of the case/year, one by
// one, each saying first whom it refers to and, opened, everything read from
// it. Read-only; the only action is "Riprova estrazione". The source viewer
// is a same-page state driven by ?view=source, so the browser's own back
// button returns to the list.
export default function TaxSummary() {
  const { caseId } = useParams()
  const { t } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [data, setData] = useState(null)
  const [openIds, setOpenIds] = useState(() => new Set())
  const [source, setSource] = useState(null)
  const [fileUrls, setFileUrls] = useState({})
  const [openingId, setOpeningId] = useState(null)
  const [retryingId, setRetryingId] = useState(null)
  const itemRefs = useRef({})
  const enteredSourceViaClick = useRef(false)

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

  const view = resolveTaxSummaryView(searchParams.get('view'), Boolean(source))

  const openItem = (documentId) => setOpenIds((ids) => new Set(ids).add(documentId))
  const toggleItem = (documentId) =>
    setOpenIds((ids) => {
      const next = new Set(ids)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })

  // Opens the viewer on one document — at a page with a sentence
  // highlighted, or from the start when neither is given.
  const viewSource = async (doc, { source_page = null, source_quote = null } = {}, { pushHistory = true } = {}) => {
    if (openingId) return
    let url = fileUrls[doc.id]
    if (!url) {
      setOpeningId(doc.id)
      try {
        url = await api.getDownloadUrl(doc, { download: false })
        setFileUrls((prev) => ({ ...prev, [doc.id]: url }))
      } catch (error) {
        console.error(error)
        toast.error(error.message || t('common.error'))
        return
      } finally {
        setOpeningId(null)
      }
    }
    setSource({
      documentId: doc.id,
      fileName: doc.file_name,
      isPdf: doc.mime_type === 'application/pdf',
      isText: doc.mime_type === 'text/plain',
      page: source_page,
      quote: source_quote
    })
    enteredSourceViaClick.current = pushHistory
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('view', 'source')
        return next
      },
      { replace: !pushHistory }
    )
  }

  // An assistant reference clicked on this page.
  const viewDocumentById = (documentId, sourcePoint = {}) => {
    const doc = data?.documents.find((d) => d.id === documentId)
    if (!doc) return
    openItem(doc.id)
    viewSource(doc, { source_page: sourcePoint.page || null, source_quote: sourcePoint.quote || null })
  }

  // Arriving with ?doc=<id>[&page=&quote=] — an assistant reference clicked
  // on the case page — opens that document straight away, at that point.
  const handledDocParam = useRef(null)
  const requestedDoc = searchParams.get('doc')
  useEffect(() => {
    if (!requestedDoc || !data || handledDocParam.current === requestedDoc) return
    handledDocParam.current = requestedDoc
    const doc = data.documents.find((d) => d.id === requestedDoc)
    if (!doc) return
    openItem(doc.id)
    viewSource(
      doc,
      { source_page: Number(searchParams.get('page')) || null, source_quote: searchParams.get('quote') || null },
      { pushHistory: false }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDoc, data])

  const backToList = () => {
    if (enteredSourceViaClick.current) {
      navigate(-1)
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        for (const key of ['view', 'doc', 'page', 'quote']) next.delete(key)
        return next
      })
    }
    const documentId = source?.documentId
    requestAnimationFrame(() => {
      itemRefs.current[documentId]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

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

      {view === 'source' ? (
        <Suspense
          fallback={
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner size={22} />
            </div>
          }
        >
          <PdfSourceViewer
            fileUrl={fileUrls[source.documentId] || null}
            isPdf={source.isPdf}
            isText={source.isText}
            fileName={source.fileName}
            page={source.page}
            quote={source.quote}
            onBack={backToList}
          />
        </Suspense>
      ) : (
        <>
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
                    innerRef={(el) => {
                      itemRefs.current[item.doc.id] = el
                    }}
                    item={item}
                    open={openIds.has(item.doc.id)}
                    onToggle={() => toggleItem(item.doc.id)}
                    onViewSource={viewSource}
                    onRetry={() => retryExtraction(item.doc)}
                    retrying={retryingId === item.doc.id}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState icon={FolderOpen} title={t('summary.noDocuments')} />
            )}
          </section>
        </>
      )}

      <CaseAssistant caseId={caseId} onViewDocument={viewDocumentById} />
    </div>
  )
}
