const LOCALE_MAP = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }

export function formatDate(value, lang = 'en') {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(LOCALE_MAP[lang] || 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

export function formatDateTime(value, lang = 'en') {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(LOCALE_MAP[lang] || 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatChf(amount, lang = 'en') {
  const n = Number(amount || 0)
  return new Intl.NumberFormat(LOCALE_MAP[lang] || 'de-CH', {
    style: 'currency',
    currency: 'CHF',
    maximumFractionDigits: n % 1 === 0 ? 0 : 2
  }).format(n)
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fullName(person) {
  if (!person) return ''
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function relativeDays(dateValue) {
  if (!dateValue) return null
  const target = new Date(dateValue)
  if (Number.isNaN(target.getTime())) return null
  const diff = Math.ceil((target - new Date()) / (1000 * 60 * 60 * 24))
  return diff
}

export function safeFileName(name = 'file') {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-120)
}
