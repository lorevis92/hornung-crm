import clsx from 'clsx'
import { STATUS_META } from '../lib/constants'
import { useI18n } from '../i18n'

export default function StatusBadge({ status, size = 'md' }) {
  const { t } = useI18n()
  const meta = STATUS_META[status] || STATUS_META.opened

  return (
    <span className={clsx('chip', meta.chip, size === 'sm' && 'px-2.5 py-0.5 text-[12px]')}>
      <span className={clsx('h-2 w-2 rounded-full', meta.dot)} aria-hidden="true" />
      {t(`status.${status}`)}
    </span>
  )
}
