import { useRef, useState } from 'react'
import { ClipboardPaste, Upload } from 'lucide-react'
import { Spinner, Textarea } from './ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'

// A client rarely fills the online Questionnaire directly — more often
// they send the specialist a document, or just write the details in an
// email. This is the explicit first step the Questionnaire is meant to
// be: upload that document, or paste the email text straight in, and let
// the same extraction pipeline that already reads a "current_tax_sheet"
// document propose the result as suggestions to confirm (never applied
// silently) — the exact same mechanism, just given a new kind of input
// instead of waiting for a document to arrive and be classified on its
// own. Needs an open tax year to file the upload under (client_documents
// requires one); if none exists yet, the caller passes no caseId and this
// renders a short pointer to open one instead of the controls.
export default function QuestionnaireAutoFill({ caseId, clientId, taxYear, onDone }) {
  const { t } = useI18n()
  const toast = useToast()
  const fileInputRef = useRef(null)
  const [pastedText, setPastedText] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (action) => {
    setBusy(true)
    try {
      await action()
      toast.success(t('data.autoFillDone'))
      setPastedText('')
      setShowPaste(false)
      onDone?.()
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(() => api.fillQuestionnaireFromDocument(caseId, file, { clientId, taxYear }))
  }

  const handlePasteSubmit = () => {
    const text = pastedText.trim()
    if (!text) return
    run(() => api.fillQuestionnaireFromText(caseId, text, { clientId, taxYear }))
  }

  return (
    <div className="card card-pad space-y-3">
      <div>
        <h2 className="section-title text-xl">{t('data.autoFillTitle')}</h2>
        <p className="section-sub">{t('data.autoFillHelp')}</p>
      </div>

      {!caseId ? (
        <p className="text-[13.5px] text-ink-400">{t('data.autoFillNeedsCase')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
              className="hidden"
              onChange={handleFile}
              disabled={busy}
            />
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              {busy ? <Spinner size={15} /> : <Upload size={15} aria-hidden="true" />}
              {t('data.autoFillFromFile')}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setShowPaste((v) => !v)}
              disabled={busy}
            >
              <ClipboardPaste size={15} aria-hidden="true" />
              {t('data.autoFillFromText')}
            </button>
          </div>

          {showPaste ? (
            <div className="space-y-2">
              <Textarea
                rows={6}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={t('data.autoFillPastePlaceholder')}
                disabled={busy}
              />
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={handlePasteSubmit}
                disabled={busy || !pastedText.trim()}
              >
                {busy ? <Spinner size={15} /> : null}
                {t('data.autoFillSubmitText')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
