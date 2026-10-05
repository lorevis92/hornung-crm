import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Bot, Eye, Maximize2, Minimize2, Send, X } from 'lucide-react'
import { Spinner } from './ui'
import { useI18n } from '../i18n'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/data'
import { parseAssistantMessage } from '../lib/citations'

// One assistant reply, with its document references (src/lib/citations.js)
// rendered as click-throughs: a reference to an extracted value opens the
// document at its page with its sentence highlighted, a reference to a
// document in general opens it from the start. onViewDocument(documentId,
// { page, quote }) is Tax Summary's own viewer, or — on the case page — a
// jump to Tax Summary opened on that point.
function AssistantMessageContent({ content, onViewDocument }) {
  const { t } = useI18n()
  const parts = parseAssistantMessage(content)
  return (
    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
      {parts.map((part, i) =>
        part.type === 'doc' ? (
          <button
            key={i}
            type="button"
            className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-gold-50 px-1.5 py-0.5 text-[12.5px] font-medium text-gold-800 underline decoration-gold-300 underline-offset-2 hover:bg-gold-100"
            onClick={() => onViewDocument(part.documentId, { page: part.page, quote: part.quote })}
            title={part.quote || undefined}
          >
            <Eye size={11} aria-hidden="true" />
            {part.fileName}
            {part.page ? <span className="text-gold-700">· {t('assistant.page', { page: part.page })}</span> : null}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </p>
  )
}

// The "ask about this case" chat bubble, on Tax Summary and on the case
// page — the same conversation on both, scoped to the ONE case open there. The server
// (api/case-assistant.js) rebuilds the case's context from the database on
// every question; this component only ever sends the caseId and the
// specialist's own message text.
export default function CaseAssistant({ caseId, onViewDocument }) {
  const { t } = useI18n()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!open || historyLoaded || !caseId) return
    let active = true
    setLoadingHistory(true)
    api
      .listCaseAssistantMessages(caseId)
      .then((rows) => {
        if (!active) return
        setMessages(rows.map((r) => ({ role: r.role, content: r.content })))
        setHistoryLoaded(true)
      })
      .catch((error) => {
        console.error(error)
        toast.error(error.message || t('common.error'))
      })
      .finally(() => active && setLoadingHistory(false))
    return () => {
      active = false
    }
  }, [open, historyLoaded, caseId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages((list) => [...list, { role: 'user', content: text }])
    setSending(true)
    try {
      const { reply } = await api.askCaseAssistant(caseId, text)
      setMessages((list) => [...list, { role: 'assistant', content: reply }])
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
      setMessages((list) => list.slice(0, -1))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gold-600 text-white shadow-lift transition hover:bg-gold-700"
        aria-label={t('assistant.open')}
        title={t('assistant.open')}
      >
        <Bot size={24} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div
      className={clsx(
        'fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-lift',
        fullscreen ? 'inset-4 sm:inset-8' : 'bottom-5 right-5 h-[520px] w-[360px] max-w-[92vw]'
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-sand/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-gold-700" aria-hidden="true" />
          <p className="text-[14.5px] font-semibold text-ink-800">{t('assistant.title')}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost btn-sm !p-1.5"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? t('assistant.collapseSize') : t('assistant.expandSize')}
            aria-label={fullscreen ? t('assistant.collapseSize') : t('assistant.expandSize')}
          >
            {fullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm !p-1.5"
            onClick={() => setOpen(false)}
            title={t('assistant.close')}
            aria-label={t('assistant.close')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {loadingHistory ? (
          <div className="flex justify-center py-6">
            <Spinner size={18} />
          </div>
        ) : null}
        {!loadingHistory && !messages.length ? (
          <p className="rounded-xl border border-dashed border-line bg-sand/40 px-3 py-4 text-center text-[13px] text-ink-400">
            {t('assistant.empty')}
          </p>
        ) : null}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-xl rounded-tr-sm bg-gold-600 px-3 py-2 text-[13.5px] text-white">
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="mr-auto max-w-[92%] rounded-xl rounded-tl-sm bg-sand px-3 py-2 text-ink-800">
              <AssistantMessageContent content={m.content} onViewDocument={onViewDocument} />
            </div>
          )
        )}
        {sending ? (
          <div className="mr-auto flex items-center gap-2 rounded-xl rounded-tl-sm bg-sand px-3 py-2">
            <Spinner size={14} />
            <span className="text-[12.5px] text-ink-400">{t('assistant.thinking')}</span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-end gap-2 border-t border-line p-3">
        <textarea
          className="min-h-[38px] flex-1 resize-none rounded-lg border border-line px-3 py-2 text-[13.5px] focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-300"
          rows={1}
          placeholder={t('assistant.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          type="button"
          className="btn-primary btn-sm shrink-0"
          onClick={send}
          disabled={sending || !input.trim()}
          aria-label={t('assistant.send')}
        >
          <Send size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
