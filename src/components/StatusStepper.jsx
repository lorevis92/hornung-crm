import clsx from 'clsx'
import { Check } from 'lucide-react'
import { STATUS_STEPS } from '../lib/constants'
import { useI18n } from '../i18n'

/**
 * Linear progress of a tax file. `waiting_client` is not a step of its own —
 * it is shown as a warning state on the "in process" step, because from the
 * client's point of view the file is still being handled.
 */
export default function StatusStepper({ status }) {
  const { t } = useI18n()
  const waiting = status === 'waiting_client'
  const effective = waiting ? 'opened' : status
  const currentIndex = Math.max(STATUS_STEPS.indexOf(effective), 0)

  return (
    <ol className="flex w-full items-center gap-1.5" aria-label={t('status.label')}>
      {STATUS_STEPS.map((step, index) => {
        const done = index < currentIndex
        const active = index === currentIndex
        return (
          <li key={step} className="flex flex-1 flex-col gap-1.5">
            <span
              className={clsx(
                'h-1.5 w-full rounded-full transition-colors',
                done && 'bg-gold-500',
                active && (waiting ? 'bg-amber-400' : 'bg-gold-500'),
                !done && !active && 'bg-ink-200'
              )}
            />
            <span
              className={clsx(
                'flex items-center gap-1 text-[12.5px] font-medium',
                done || active ? 'text-ink-700' : 'text-ink-400'
              )}
            >
              {done ? <Check size={13} className="text-gold-600" aria-hidden="true" /> : null}
              <span className="truncate">{t(`status.${step}`)}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
