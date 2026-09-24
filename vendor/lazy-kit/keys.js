/**
 * Feed one key into a text input (search box, single-line editor, password
 * field). Returns the next `value`/`cursor` plus `submit` (enter) and `cancel`
 * (escape) flags; keys the input does not own come back unchanged so the
 * caller can route them elsewhere (panel keys, scope switching).
 *
 * The key is `{ name, text?, sequence?, ctrl?, meta? }`: printable characters
 * come from `text`, falling back to a single printable `sequence`.
 */

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('en', { granularity: 'grapheme' })
  : null

function keyText(key) {
  if (typeof key.text === 'string')
    return key.text
  const sequence = key.sequence
  if (
    key.ctrl
    || key.meta
    || typeof sequence !== 'string'
    || sequence.length !== 1
    || sequence < ' '
  ) {
    return ''
  }
  return sequence
}

/** Start offset of the grapheme before `cursor` (code points without Intl.Segmenter). */
function graphemeStart(text, cursor) {
  if (cursor <= 0)
    return 0
  if (segmenter) {
    let start = 0
    for (const { index } of segmenter.segment(text)) {
      if (index >= cursor)
        break
      start = index
    }
    return start
  }
  const units = Array.from(text.slice(0, cursor))
  units.pop()
  return units.join('').length
}

export function applyTextKey(key, value, cursor) {
  const at = Math.max(0, Math.min(cursor, value.length))
  if (key.name === 'enter' || key.name === 'return')
    return { value, cursor: at, submit: true, cancel: false }
  if (key.name === 'escape')
    return { value, cursor: at, submit: false, cancel: true }
  if (key.ctrl && !key.meta && (key.name === 'u' || key.name === 'U'))
    return { value: '', cursor: 0, submit: false, cancel: false }
  if (key.name === 'backspace' || key.name === 'delete') {
    const start = graphemeStart(value, at)
    if (start === at)
      return { value, cursor: at, submit: false, cancel: false }
    return {
      value: value.slice(0, start) + value.slice(at),
      cursor: start,
      submit: false,
      cancel: false,
    }
  }
  const text = keyText(key)
  if (text === '')
    return { value, cursor: at, submit: false, cancel: false }
  return {
    value: value.slice(0, at) + text + value.slice(at),
    cursor: at + text.length,
    submit: false,
    cancel: false,
  }
}
