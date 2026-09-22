export function docTypeLabel(type, lang = 'en') {
  if (!type) return null
  return type[`label_${lang}`] || type.label_en || type.id
}

export function findDocType(types, id) {
  return types.find((t) => t.id === id) || null
}

export function groupByCategory(types) {
  return types.reduce((acc, type) => {
    ;(acc[type.category] ||= []).push(type)
    return acc
  }, {})
}
