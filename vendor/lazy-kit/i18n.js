/**
 * Translate one template key from a `{ language: { key: text } }` catalog.
 * A missing key — or a missing language — falls back to the key itself, and
 * `{param}` placeholders are replaced with `String(param)`.
 */
export function translate(catalog, language, key, params) {
  const dict = catalog[language] ?? catalog.en
  let text = dict?.[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/**
 * Structured hint chips for one id: an array of `[key, desc]` tuples from
 * `hints[language][id]`, falling back to English and then to an empty list.
 */
export function hintSegments(hints, language, id) {
  return hints[language]?.[id] ?? hints.en?.[id] ?? []
}
