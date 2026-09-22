import { useRef, useState } from 'react'
import { UploadCloud, Paperclip } from 'lucide-react'
import clsx from 'clsx'
import { useI18n } from '../i18n'
import { useToast } from '../context/ToastContext'
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from '../lib/config'
import { docTypeLabel } from '../lib/labels'
import { Spinner } from './ui'

export default function Uploader({ documentTypes = [], onUpload, disabled = false, compact = false }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [typeId, setTypeId] = useState('')

  const validate = (file) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t('case.fileTooLarge', { name: file.name }))
      return false
    }
    if (ACCEPTED_FILE_TYPES.length && file.type && !ACCEPTED_FILE_TYPES.includes(file.type)) {
      toast.error(t('case.typeNotAllowed', { name: file.name }))
      return false
    }
    return true
  }

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(validate)
    if (!files.length) return
    setBusy(true)
    try {
      for (const file of files) {
        await onUpload(file, { document_type_id: typeId || null })
      }
      setTypeId('')
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={clsx(disabled && 'pointer-events-none opacity-60')}>
      {!compact && documentTypes.length ? (
        <div className="mb-3">
          <label className="label" htmlFor="upload-type">
            {t('case.documentType')} <span className="font-normal text-ink-400">({t('common.optional')})</span>
          </label>
          <select
            id="upload-type"
            className="select"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
          >
            <option value="">{t('case.chooseType')}</option>
            {documentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {docTypeLabel(type, lang)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={clsx(
          'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 text-center transition',
          compact ? 'py-6' : 'py-9',
          dragging ? 'border-gold-400 bg-gold-50' : 'border-line bg-sand/60 hover:border-gold-300'
        )}
      >
        {busy ? (
          <div className="flex items-center gap-2 text-ink-600">
            <Spinner />
            <span className="text-[15px]">{t('case.uploading')}</span>
          </div>
        ) : (
          <>
            <UploadCloud size={compact ? 24 : 30} className="mb-2 text-gold-600" aria-hidden="true" />
            <p className="text-[15px] text-ink-600">
              {t('case.dropHere')}{' '}
              <button
                type="button"
                className="link"
                onClick={() => inputRef.current?.click()}
              >
                {t('case.browse')}
              </button>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-400">
              <Paperclip size={13} aria-hidden="true" />
              PDF, JPG, PNG, Word, Excel — max 25 MB
            </p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          accept={ACCEPTED_FILE_TYPES.join(',')}
        />
      </div>
    </div>
  )
}
