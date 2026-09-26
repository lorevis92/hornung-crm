// Shared by every "the specialist types a name, we derive an internal key"
// editor in /tax-settings (document fields, tax parameters): lowercased,
// accents stripped, anything non-alphanumeric collapsed to underscores. The
// derived key is never shown to the (non-technical) staff.
export function slugify(label) {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'item'
  )
}

export function uniqueSlug(baseKey, existingKeys) {
  if (!existingKeys.has(baseKey)) return baseKey
  let i = 2
  while (existingKeys.has(`${baseKey}_${i}`)) i++
  return `${baseKey}_${i}`
}
