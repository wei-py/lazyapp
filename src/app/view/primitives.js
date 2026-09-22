import stringWidth from 'string-width'

export const SEGMENTS = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Clip terminal columns, not JavaScript code units, preserving grapheme boundaries. */
export function clipColumns(value, width) {
  let result = ''
  let columns = 0
  for (const { segment } of SEGMENTS.segment(String(value).replace(/[\x00-\x1F\x7F]/g, ' '))) {
    const size = stringWidth(segment)
    if (columns + size > width)
      break
    result += segment
    columns += size
  }
  return result
}

export function wrap(value, width) {
  const lines = []
  for (const paragraph of String(value).split('\n')) {
    let line = ''
    let columns = 0
    for (const { segment } of SEGMENTS.segment(paragraph.replace(/[\x00-\x1F\x7F]/g, ' '))) {
      const size = stringWidth(segment)
      if (columns + size > width) {
        lines.push(line)
        line = ''
        columns = 0
      }
      line += segment
      columns += size
    }
    lines.push(line)
  }
  return lines
}

export function editingValue(value, cursor, secret, width) {
  const chars = Array.from(value)
  const before = secret ? '*'.repeat(cursor) : chars.slice(0, cursor).join('')
  const after = secret ? '*'.repeat(chars.length - cursor) : chars.slice(cursor).join('')
  const segments = Array.from(SEGMENTS.segment(before), item => item.segment)
  let visible = ''
  let columns = 0
  for (let index = segments.length - 1; index >= 0; index--) {
    const size = stringWidth(segments[index])
    if (columns + size > Math.max(1, width - 5))
      break
    visible = segments[index] + visible
    columns += size
  }
  return clipColumns(`${visible}|${after}`, width)
}

/** Frame rows are exactly the panel width so a stale row can never survive a repaint. */
export function padColumns(value, width) {
  const clipped = clipColumns(value, width)
  return `${clipped}${' '.repeat(Math.max(0, width - stringWidth(clipped)))}`
}

export function pathTail(value, width) {
  if (stringWidth(value) <= width)
    return value
  const segments = Array.from(SEGMENTS.segment(value), item => item.segment)
  let tail = ''
  let columns = 1
  for (let index = segments.length - 1; index >= 0; index--) {
    const size = stringWidth(segments[index])
    if (columns + size > width)
      break
    tail = segments[index] + tail
    columns += size
  }
  return `…${tail}`
}

/** Keep the selected row visible and retain its position for the highlight and counter. */
export function windowContent(lines, index, size) {
  const count = Math.max(0, size)
  const start = Math.min(
    Math.max(0, index - Math.floor(count / 2)),
    Math.max(0, lines.length - count),
  )
  return {
    lines: lines.slice(start, start + count),
    start,
    selected: lines.length ? index - start : -1,
    counter: `${lines.length ? index + 1 : 0}/${lines.length}`,
  }
}
