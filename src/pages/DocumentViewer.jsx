import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FileX } from 'lucide-react'
import { LoadGate } from '../components/LoadState'
import { EmptyState, Spinner } from '../components/ui'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { readViewerParams } from '../lib/documentViewer'
import { useLoad } from '../lib/useLoad'

// pdfjs-dist is a large dependency — only fetched on this page.
const PdfSourceViewer = lazy(() => import('../components/PdfSourceViewer'))

// The document and a short-lived signed URL to read it — inside the app, so
// the same login and the same permissions (RLS) apply as everywhere else.
export async function loadViewerDocument(dataApi, documentId) {
  const doc = await dataApi.getClientDocument(documentId)
  if (!doc) return null
  const fileUrl = await dataApi.getDownloadUrl(doc, { download: false })
  return { doc, fileUrl }
}

// The viewer itself, full page: the given page of the document, with the
// given sentence highlighted. Pure presentation, given what was loaded.
export function DocumentViewerView({ doc, fileUrl, page, quote, onBack }) {
  return (
    <div className="space-y-3">
      <h1 className="truncate text-[15px] font-semibold text-ink-800">{doc.file_name}</h1>
      <Suspense
        fallback={
          <div className="flex min-h-[60vh] items-center justify-center">
            <Spinner size={22} />
          </div>
        }
      >
        <PdfSourceViewer
          fileUrl={fileUrl}
          isPdf={doc.mime_type === 'application/pdf'}
          isText={doc.mime_type === 'text/plain'}
          fileName={doc.file_name}
          page={page}
          quote={quote}
          onBack={onBack}
        />
      </Suspense>
    </div>
  )
}

// /documents/:documentId/view?page=&quote= — opened in a new browser tab by
// every "view in document" link of the app (src/lib/documentViewer.js).
export default function DocumentViewer() {
  const { documentId } = useParams()
  const [searchParams] = useSearchParams()
  const { page, quote } = readViewerParams(searchParams)
  const navigate = useNavigate()
  const { t } = useI18n()
  const [data, setData] = useState(null)

  const loadState = useLoad(
    useCallback(
      async (isCurrent) => {
        const loaded = await loadViewerDocument(api, documentId)
        if (isCurrent()) setData(loaded)
      },
      [documentId]
    )
  )

  // This tab was opened for the document: "Chiudi" closes it. A tab the
  // browser will not let a script close (opened by hand, from a bookmark)
  // goes back to the app instead.
  const close = () => {
    window.close()
    setTimeout(() => {
      if (!window.closed) navigate('/', { replace: true })
    }, 150)
  }

  useEffect(() => {
    if (data?.doc?.file_name) document.title = data.doc.file_name
  }, [data])

  if (loadState.status !== 'ready') return <LoadGate load={loadState} showDetail />
  if (!data) return <EmptyState icon={FileX} title={t('viewer.notFound')} />

  return <DocumentViewerView doc={data.doc} fileUrl={data.fileUrl} page={page} quote={quote} onBack={close} />
}
