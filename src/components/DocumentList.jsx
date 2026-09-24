import { useState } from 'react'
import {
  FileText, Download, Trash2, Eye, Image as ImageIcon, FileSpreadsheet, List, LayoutGrid
} from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import { useI18n } from '../i18n'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/data'
import { formatBytes, formatDate } from '../lib/format'
import { docTypeLabel, findDocType } from '../lib/labels'
import { Select, Spinner } from './ui'

const VIEW_KEY = 'hornung.docview'
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

function readStoredView() {
  try {
    const stored = localStorage.getItem(VIEW_KEY)
    return stored === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function storeView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    /* localStorage unavailable — ignore, the app still works */
  }
}

function iconFor(mime = '') {
  if (mime.startsWith('image/')) return ImageIcon
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return FileSpreadsheet
  return FileText
}

function previewKind(mime = '') {
  if (mime === 'application/pdf') return 'pdf'
  if (IMAGE_MIMES.includes(mime)) return 'image'
  return 'none'
}

export default function DocumentList({
  documents = [],
  documentTypes = [],
  categories = [],
  canAssignCategory = false,
  onCategoryChange,
  onDelete,
  canDelete = false
}) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [busyId, setBusyId] = useState(null)
  const [categoryBusyId, setCategoryBusyId] = useState(null)
  const [view, setView] = useState(readStoredView)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const changeView = (next) => {
    setView(next)
    storeView(next)
  }

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

  const askDelete = (doc) => setDeleteTarget(doc)

  const cancelDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setBusyId(deleteTarget.id)
    try {
      await onDelete(deleteTarget)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
      setBusyId(null)
    }
  }

  const changeCategory = async (doc, categoryCode) => {
    setCategoryBusyId(doc.id)
    try {
      await onCategoryChange(doc, categoryCode)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setCategoryBusyId(null)
    }
  }

  const openPreview = async (doc) => {
    setPreviewDoc(doc)
    setPreviewUrl(null)
    setPreviewLoading(true)
    try {
      const url = await api.getDownloadUrl(doc, { download: false })
      setPreviewUrl(url)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreviewDoc(null)
    setPreviewUrl(null)
  }

  const previewDocKind = previewDoc ? previewKind(previewDoc.mime_type) : 'none'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1" role="group" aria-label={t('case.viewToggle')}>
        <button
          type="button"
          className={clsx('btn-ghost btn-sm', view === 'list' && 'bg-ink-100 text-ink-900')}
          onClick={() => changeView('list')}
          aria-pressed={view === 'list'}
          aria-label={t('case.viewList')}
          title={t('case.viewList')}
        >
          <List size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={clsx('btn-ghost btn-sm', view === 'grid' && 'bg-ink-100 text-ink-900')}
          onClick={() => changeView('grid')}
          aria-pressed={view === 'grid'}
          aria-label={t('case.viewGrid')}
          title={t('case.viewGrid')}
        >
          <LayoutGrid size={16} aria-hidden="true" />
        </button>
      </div>

      {view === 'list' ? (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {documents.map((doc) => {
            const Icon = iconFor(doc.mime_type)
            const type = findDocType(documentTypes, doc.document_type_id)
            return (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-sand/70">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-gold-700">
                  <Icon size={19} aria-hidden="true" />
                </span>

                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openPreview(doc)}
                >
                  <p className="truncate text-[15px] font-medium text-ink-900 hover:underline">
                    {doc.file_name}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-400">
                    {type ? <span className="text-ink-500">{docTypeLabel(type, lang)} · </span> : null}
                    {formatDate(doc.created_at, lang)}
                    {doc.file_size ? ` · ${formatBytes(doc.file_size)}` : ''}
                  </p>
                  {doc.note ? <p className="mt-1 text-[13px] italic text-ink-500">{doc.note}</p> : null}
                </button>

                {canAssignCategory ? (
                  <Select
                    className="w-[190px] shrink-0"
                    value={doc.category_code || ''}
                    onChange={(e) => changeCategory(doc, e.target.value || null)}
                    disabled={categoryBusyId === doc.id}
                    aria-label={t('case.taxCategory')}
                    title={t('case.taxCategory')}
                  >
                    <option value="">{t('case.taxCategoryPlaceholder')}</option>
                    {categories.map((cat) => (
                      <option key={cat.code} value={cat.code}>
                        {docTypeLabel(cat, lang)}
                      </option>
                    ))}
                  </Select>
                ) : null}

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => download(doc)}
                    className="btn-ghost btn-sm"
                    title={t('common.download')}
                    aria-label={t('common.download')}
                    disabled={busyId === doc.id}
                  >
                    {busyId === doc.id ? <Spinner size={16} /> : <Download size={17} aria-hidden="true" />}
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => askDelete(doc)}
                      className="btn-ghost btn-sm text-ink-400 hover:text-red-700"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      disabled={busyId === doc.id}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {documents.map((doc) => {
            const Icon = iconFor(doc.mime_type)
            const type = findDocType(documentTypes, doc.document_type_id)
            return (
              <div
                key={doc.id}
                className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white p-3.5 text-center transition hover:border-gold-300 hover:shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => openPreview(doc)}
                  className="flex w-full flex-col items-center gap-2"
                >
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-700">
                    <Icon size={28} aria-hidden="true" />
                  </span>
                  <p className="line-clamp-2 min-h-[2.5em] w-full break-words text-[13.5px] font-medium leading-snug text-ink-900">
                    {doc.file_name}
                  </p>
                </button>
                <p className="w-full truncate text-[11.5px] text-ink-400">
                  {formatDate(doc.created_at, lang)}
                  {doc.file_size ? ` · ${formatBytes(doc.file_size)}` : ''}
                </p>
                {type ? (
                  <p className="w-full truncate text-[11px] text-ink-400">{docTypeLabel(type, lang)}</p>
                ) : null}

                {canAssignCategory ? (
                  <Select
                    className="w-full text-[12.5px]"
                    value={doc.category_code || ''}
                    onChange={(e) => changeCategory(doc, e.target.value || null)}
                    disabled={categoryBusyId === doc.id}
                    aria-label={t('case.taxCategory')}
                    title={t('case.taxCategory')}
                  >
                    <option value="">{t('case.taxCategoryPlaceholder')}</option>
                    {categories.map((cat) => (
                      <option key={cat.code} value={cat.code}>
                        {docTypeLabel(cat, lang)}
                      </option>
                    ))}
                  </Select>
                ) : null}

                <div className="mt-1 flex shrink-0 items-center gap-1 border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={() => openPreview(doc)}
                    className="btn-ghost btn-sm"
                    title={t('case.preview')}
                    aria-label={t('case.preview')}
                  >
                    <Eye size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => download(doc)}
                    className="btn-ghost btn-sm"
                    title={t('common.download')}
                    aria-label={t('common.download')}
                    disabled={busyId === doc.id}
                  >
                    {busyId === doc.id ? <Spinner size={16} /> : <Download size={16} aria-hidden="true" />}
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => askDelete(doc)}
                      className="btn-ghost btn-sm text-ink-400 hover:text-red-700"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      disabled={busyId === doc.id}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!previewDoc}
        onClose={closePreview}
        title={previewDoc?.file_name || ''}
        size="lg"
        footer={
          previewDoc ? (
            <button type="button" className="btn-secondary btn-sm" onClick={() => download(previewDoc)}>
              <Download size={16} aria-hidden="true" />
              {t('common.download')}
            </button>
          ) : null
        }
      >
        {previewLoading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <Spinner size={22} />
          </div>
        ) : previewDocKind === 'pdf' && previewUrl ? (
          <iframe title={previewDoc?.file_name} src={previewUrl} className="h-[75vh] w-full rounded-lg border-0" />
        ) : previewDocKind === 'image' && previewUrl ? (
          <div className="flex max-h-[75vh] items-center justify-center overflow-auto">
            <img src={previewUrl} alt={previewDoc?.file_name} className="max-h-[75vh] max-w-full rounded-lg object-contain" />
          </div>
        ) : (
          <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
            <p className="text-[14.5px] text-ink-500">{t('case.previewUnavailable')}</p>
            {previewDoc ? (
              <button type="button" className="btn-primary btn-sm" onClick={() => download(previewDoc)}>
                <Download size={16} aria-hidden="true" />
                {t('common.download')}
              </button>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={cancelDelete}
        title={t('case.deleteConfirm')}
        description={deleteTarget ? t('case.deleteConfirmBody', { name: deleteTarget.file_name }) : ''}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={cancelDelete}
              disabled={deleting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
              {deleting ? t('common.deleting') : t('common.delete')}
            </button>
          </>
        }
      />
    </div>
  )
}
