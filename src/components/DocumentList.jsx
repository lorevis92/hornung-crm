import { useState } from 'react'
import { FileText, Download, Trash2, Image as ImageIcon, FileSpreadsheet } from 'lucide-react'
import { useI18n } from '../i18n'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/data'
import { formatBytes, formatDate } from '../lib/format'
import { docTypeLabel, findDocType } from '../lib/labels'
import { Spinner } from './ui'

function iconFor(mime = '') {
  if (mime.startsWith('image/')) return ImageIcon
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return FileSpreadsheet
  return FileText
}

export default function DocumentList({ documents = [], documentTypes = [], onDelete, canDelete = false }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [busyId, setBusyId] = useState(null)

  const download = async (doc) => {
    setBusyId(doc.id)
    try {
      const url = await api.getDownloadUrl(doc)
      if (!url) {
        toast.info(t('common.demoBadge'))
        return
      }
      window.open(url, '_blank', 'noopener')
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (doc) => {
    if (!window.confirm(t('case.deleteConfirm'))) return
    setBusyId(doc.id)
    try {
      await onDelete(doc)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
      {documents.map((doc) => {
        const Icon = iconFor(doc.mime_type)
        const type = findDocType(documentTypes, doc.document_type_id)
        return (
          <li key={doc.id} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-sand/70">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-gold-700">
              <Icon size={19} aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-ink-900">{doc.file_name}</p>
              <p className="mt-0.5 truncate text-[13px] text-ink-400">
                {type ? <span className="text-ink-500">{docTypeLabel(type, lang)} · </span> : null}
                {formatDate(doc.created_at, lang)}
                {doc.file_size ? ` · ${formatBytes(doc.file_size)}` : ''}
              </p>
              {doc.note ? <p className="mt-1 text-[13px] italic text-ink-500">{doc.note}</p> : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => download(doc)}
                className="btn-ghost btn-sm"
                title={t('common.download')}
                disabled={busyId === doc.id}
              >
                {busyId === doc.id ? <Spinner size={16} /> : <Download size={17} aria-hidden="true" />}
                <span className="sr-only">{t('common.download')}</span>
              </button>
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => remove(doc)}
                  className="btn-ghost btn-sm text-ink-400 hover:text-red-700"
                  title={t('common.delete')}
                  disabled={busyId === doc.id}
                >
                  <Trash2 size={17} aria-hidden="true" />
                  <span className="sr-only">{t('common.delete')}</span>
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
