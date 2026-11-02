import { documentFields, identifyDocument, isValidExpiryDate } from '../config/model.js'

// Normalize calendar components to UTC only for subtraction, never parse a local timestamp.
function calendarDay(year, month, day) {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getTime() / 86400000
}

/** Summarize manually entered expiry dates without reading files or exposing credential values. */
export function collectExpiries(documents, { now = new Date(), language = 'en' } = {}) {
  const today = calendarDay(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const entries = []
  for (const document of documents) {
    const { path, data } = document
    if (document.missing || document.error || !data || Array.isArray(data)
      || data.schemaVersion !== 1 || typeof path !== 'string') {
      continue
    }
    const identified = identifyDocument(path)
    if (!identified)
      continue
    const { kind, scope, environment, name } = identified
    const fields = documentFields(kind, { scope, language })
    for (const field of fields) {
      if (field.type !== 'date' || !field.expiresFor)
        continue
      const reference = data[field.expiresFor]
      if (typeof reference !== 'string' || !reference.trim() || reference.toLowerCase().endsWith('.example'))
        continue
      const raw = data[field.key]
      let status = 'invalid'
      let days = null
      if (raw === undefined || raw === null || raw === '') {
        status = 'unset'
      }
      else if (raw === 'never' && field.allowPermanent) {
        status = 'permanent'
      }
      else if (isValidExpiryDate(raw)) {
        days = calendarDay(Number(raw.slice(0, 4)), Number(raw.slice(5, 7)), Number(raw.slice(8, 10))) - today
        status = days < 0 ? 'expired' : days === 0 ? 'today' : days <= 30 ? 'soon' : 'valid'
      }
      entries.push({
        path,
        kind,
        environment,
        name,
        key: field.key,
        referenceKey: field.expiresFor,
        label: fields.find(item => item.key === field.expiresFor).label,
        value: days !== null || status === 'permanent' ? raw : null,
        status,
        days,
      })
    }
  }
  return entries.sort((a, b) => {
    if (a.days !== null && b.days !== null && a.days !== b.days)
      return a.days - b.days
    if ((a.days === null) !== (b.days === null))
      return a.days === null ? 1 : -1
    return a.path.localeCompare(b.path) || a.key.localeCompare(b.key)
  })
}
