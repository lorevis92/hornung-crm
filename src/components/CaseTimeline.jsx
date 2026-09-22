import { History, UploadCloud, ArrowRightLeft, Mail } from 'lucide-react'
import { useI18n } from '../i18n'
import { formatDateTime } from '../lib/format'

const ICONS = {
  status_change: ArrowRightLeft,
  document_uploaded: UploadCloud,
  email_sent: Mail
}

export default function CaseTimeline({ events = [] }) {
  const { t, lang } = useI18n()
  if (!events.length) return null

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <History size={19} className="text-gold-600" aria-hidden="true" />
        <p className="text-[15px] font-semibold text-ink-900">{t('case.timeline')}</p>
      </div>
      <ol className="divide-y divide-line">
        {events.slice(0, 12).map((event) => {
          const Icon = ICONS[event.event_type] || History
          return (
            <li key={event.id} className="flex items-start gap-3 px-4 py-2.5">
              <Icon size={15} className="mt-1 shrink-0 text-ink-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-ink-700">
                  {event.event_type === 'status_change'
                    ? `${t(`status.${event.from_status}`)} → ${t(`status.${event.to_status}`)}`
                    : event.note || event.event_type}
                </p>
                <p className="text-[12.5px] text-ink-400">{formatDateTime(event.created_at, lang)}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
