import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { Spinner } from './ui'
import { useI18n } from '../i18n'
import { findQuoteItemIndexes } from '../lib/pdfHighlight'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Approximate on-canvas bounding box for a text-content item, using the
// classic pdf.js technique (viewport transform × item transform). Good
// enough for a highlight overlay — not meant to be pixel-perfect.
function itemRect(item, viewport) {
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
  const fontHeight = Math.hypot(tx[2], tx[3])
  const width = item.width * viewport.scale
  return { left: tx[4], top: tx[5] - fontHeight, width, height: fontHeight * 1.3 }
}

// Case-insensitive substring search with the same progressive-shortening
// fallback as findQuoteItemIndexes (src/lib/pdfHighlight.js) — a pasted
// email's exact wording can drift slightly from the AI's own quote, so an
// exact match is tried first, then shorter prefixes of it, rather than
// giving up and showing no highlight at all. Kept on the original
// (un-normalized) string, not lowercased/whitespace-collapsed like the PDF
// version, so the returned index maps directly back into `text` for
// splitting into before/match/after spans.
function findTextMatch(text, quote) {
  if (!text || !quote) return null
  const lowerText = text.toLowerCase()
  const trimmedQuote = quote.trim()
  const candidates = [trimmedQuote, trimmedQuote.slice(0, 60), trimmedQuote.slice(0, 30), trimmedQuote.slice(0, 15)]
  const tried = new Set()
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase()
    if (candidate.length < 6 || tried.has(lowerCandidate)) continue
    tried.add(lowerCandidate)
    const at = lowerText.indexOf(lowerCandidate)
    if (at !== -1) return { start: at, end: at + candidate.length }
  }
  return null
}

// Renders a single PDF page to a canvas and, if a matching quote is found on
// it, draws approximate highlight rectangles over it. Falls back to a plain
// <img> for image uploads, or plain text (highlighted inline) for a pasted-
// text upload — no page/highlight-overlay concept for either of those.
export default function PdfSourceViewer({ fileUrl, isPdf, isText, fileName, page, quote, onBack }) {
  const { t } = useI18n()
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const pdfRef = useRef(null)
  const markRef = useRef(null)
  const [pageNum, setPageNum] = useState(page || 1)
  const [numPages, setNumPages] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [highlights, setHighlights] = useState([])
  const [plainText, setPlainText] = useState(null)

  useEffect(() => {
    if (!isPdf || !fileUrl) {
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    ;(async () => {
      try {
        // pdfjs-dist 6.x dropped the old "bare URL string" shorthand —
        // getDocument() now only recognizes its named { url } (or data/
        // range) option, silently reading a string as {} otherwise and
        // throwing "expected either `data`, `range`, or `url` parameter."
        // This is why every PDF failed here regardless of fileUrl actually
        // being valid.
        const pdf = await pdfjsLib.getDocument({ url: fileUrl }).promise
        if (cancelled) return
        pdfRef.current = pdf
        setNumPages(pdf.numPages)
        await renderPage(pdf, Math.min(Math.max(1, page || 1), pdf.numPages))
      } catch (err) {
        console.error('[PdfSourceViewer]', err)
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, isPdf])

  useEffect(() => {
    if (!isPdf || !pdfRef.current) return
    renderPage(pdfRef.current, pageNum)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum])

  // A pasted-text upload (see fillQuestionnaireFromText in
  // src/lib/data/supabaseData.js) has no pages or canvas to render — just
  // its own text, fetched once and highlighted the same way a PDF quote is,
  // via a plain case-insensitive substring search instead of pdf.js's
  // text-item matching.
  useEffect(() => {
    if (!isText || !fileUrl) {
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    ;(async () => {
      try {
        const res = await fetch(fileUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (!cancelled) setPlainText(text)
      } catch (err) {
        console.error('[PdfSourceViewer]', err)
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fileUrl, isText])

  useEffect(() => {
    if (plainText == null) return
    requestAnimationFrame(() => {
      markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [plainText])

  async function renderPage(pdf, num) {
    const clamped = Math.min(Math.max(1, num), pdf.numPages)
    setPageNum(clamped)
    const pdfPage = await pdf.getPage(clamped)

    const containerWidth = containerRef.current?.clientWidth || 800
    const baseViewport = pdfPage.getViewport({ scale: 1 })
    const scale = Math.min(1.8, Math.max(0.5, (containerWidth - 32) / baseViewport.width))
    const viewport = pdfPage.getViewport({ scale })

    const canvas = canvasRef.current
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

    let rects = []
    console.error('[PdfSourceViewer DEBUG]', JSON.stringify({ quote, clamped, page, willTry: Boolean(quote && clamped === (page || 1)) }))
    if (quote && clamped === (page || 1)) {
      const textContent = await pdfPage.getTextContent()
      const strings = textContent.items.map((i) => i.str)
      const matchedIdx = findQuoteItemIndexes(strings, quote)
      console.error('[PdfSourceViewer DEBUG] matchedIdx', JSON.stringify(matchedIdx), 'itemCount', strings.length)
      rects = matchedIdx.map((idx) => itemRect(textContent.items[idx], viewport))
      console.error('[PdfSourceViewer DEBUG] rects', JSON.stringify(rects))
    }
    setHighlights(rects)
    if (rects.length) {
      requestAnimationFrame(() => {
        containerRef.current?.scrollTo({
          top: Math.max(0, rects[0].top - containerRef.current.clientHeight / 3),
          behavior: 'smooth'
        })
      })
    }
  }

  if (isText) {
    const match = plainText != null ? findTextMatch(plainText, quote) : null
    return (
      <div className="space-y-3">
        <button type="button" className="btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('extraction.backToVerification')}
        </button>
        <div className="max-h-[65vh] overflow-auto rounded-xl border border-line bg-sand/40 p-4">
          {loading ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner size={22} />
            </div>
          ) : error ? (
            <p className="p-6 text-center text-[14px] text-ink-500">{t('common.error')}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] text-ink-800">
              {match ? (
                <>
                  {plainText.slice(0, match.start)}
                  <mark ref={markRef} className="rounded-sm bg-gold-400/40 ring-2 ring-gold-500/70">
                    {plainText.slice(match.start, match.end)}
                  </mark>
                  {plainText.slice(match.end)}
                </>
              ) : (
                plainText
              )}
            </pre>
          )}
        </div>
      </div>
    )
  }

  if (!isPdf) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('extraction.backToVerification')}
        </button>
        <div className="flex items-center justify-center rounded-xl border border-line bg-sand/40 p-4">
          {fileUrl ? (
            <img src={fileUrl} alt={fileName} className="max-h-[65vh] max-w-full rounded-lg object-contain" />
          ) : (
            <Spinner size={22} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('extraction.backToVerification')}
        </button>
        {numPages ? (
          <div className="flex items-center gap-1 text-[14px] text-ink-600">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={pageNum <= 1}
              onClick={() => renderPage(pdfRef.current, pageNum - 1)}
              aria-label={t('extraction.previousPage')}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span>{t('extraction.pageOf', { page: pageNum, total: numPages })}</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={pageNum >= numPages}
              onClick={() => renderPage(pdfRef.current, pageNum + 1)}
              aria-label={t('extraction.nextPage')}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      <div ref={containerRef} className="relative max-h-[65vh] overflow-auto rounded-xl border border-line bg-sand/40 p-4">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <Spinner size={22} />
          </div>
        ) : null}
        {error ? <p className="p-6 text-center text-[14px] text-ink-500">{t('common.error')}</p> : null}
        {/* Always mounted (never conditionally removed) so canvasRef stays
            attached to the same node and the drawn page survives the
            loading/error states toggling above it. */}
        <div className={clsx('relative inline-block', (loading || error) && 'hidden')}>
          <canvas ref={canvasRef} />
          {highlights.map((r, i) => (
            <div
              key={i}
              className="absolute rounded-sm bg-gold-400/40 ring-2 ring-gold-500/70"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
