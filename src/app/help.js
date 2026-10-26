import stringWidth from 'string-width'
import { helpSections } from '../config/i18n.js'
import { padColumns, wrap } from './view/primitives.js'

function descriptionLines(value, width) {
  const lines = []
  let line = ''
  for (const word of value.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (stringWidth(next) <= width) {
      line = next
      continue
    }
    if (line)
      lines.push(line)
    const pieces = wrap(word, width)
    lines.push(...pieces.slice(0, -1))
    line = pieces.at(-1)
  }
  lines.push(line)
  return lines
}

/** Shared geometry keeps keyboard paging and rendering in the same terminal-cell viewport. */
export function helpPage(state) {
  const { modal, language } = state
  const sections = helpSections(language)
  const compact = state.width < 60 || state.height < 16
  const width = Math.max(4, compact ? state.width : Math.min(state.width - 4, 88))
  const maxHeight = Math.max(5, compact ? state.height : Math.min(state.height - 2, 28))
  const innerWidth = Math.max(1, width - (compact ? 0 : 2))
  const section = sections[modal.section]
  const tabs = sections.map((entry, index) => index === modal.section ? `[${entry.title}]` : entry.title).join(' · ')
  const hints = language === 'zh'
    ? ['←→ / [ ] 分类 · Esc/Enter 关闭', '↑↓ 滚动 · PgUp/PgDn 翻页']
    : ['←→ / [ ] category · Esc/Enter close', '↑↓ scroll · PgUp/PgDn page']
  const header = wrap(tabs, innerWidth)
  const footer = hints.flatMap(hint => wrap(hint, innerWidth))
  const capacity = Math.max(1, maxHeight - 2 - header.length - footer.length)
  const hasKeys = section.entries.some(entry => entry.key)
  const keyWidth = hasKeys && innerWidth >= 28 ? Math.min(17, Math.floor(innerWidth * 0.35)) : 0
  const descriptionWidth = Math.max(1, innerWidth - (keyWidth ? keyWidth + 2 : 0))
  const lines = section.entries.flatMap((entry) => {
    const descriptions = descriptionLines(entry.description, descriptionWidth)
    if (!hasKeys)
      return [...descriptions, '']
    if (!keyWidth)
      return [...wrap(entry.key, innerWidth), ...descriptions]
    const keys = descriptionLines(entry.key, keyWidth)
    return Array.from({ length: Math.max(keys.length, descriptions.length) }, (_, index) => (
      `${padColumns(keys[index] || '', keyWidth)}  ${descriptions[index] || ''}`
    ))
  })
  if (lines.at(-1) === '')
    lines.pop()
  const rows = Math.min(capacity, Math.max(1, lines.length))
  const height = Math.min(maxHeight, rows + 2 + header.length + footer.length)
  const maxScroll = Math.max(0, lines.length - rows)
  const scroll = Math.min(Math.max(0, modal.scrolls[modal.section]), maxScroll)
  modal.scrolls[modal.section] = scroll
  const position = `${scroll + 1}–${Math.min(scroll + rows, lines.length)}/${lines.length}`
  const body = lines.slice(scroll, scroll + rows)
  const content = [...header, ...body, ...Array.from({ length: rows - body.length }).fill(''), ...footer]
  return { width, height, compact, rows, maxScroll, position, lines: content }
}

/** Only help owns these keys while open; category offsets survive switching and resize. */
export function moveHelp(state, key) {
  const modal = state.modal
  const name = key.name
  const delta = ['right', 'l', ']'].includes(name) ? 1 : ['left', 'h', '['].includes(name) ? -1 : 0
  if (delta) {
    modal.section = (modal.section + delta + modal.scrolls.length) % modal.scrolls.length
    return
  }
  const page = helpPage(state)
  let scroll = modal.scrolls[modal.section]
  if (['down', 'j'].includes(name))
    scroll++
  else if (['up', 'k'].includes(name))
    scroll--
  else if (name === 'pagedown')
    scroll += page.rows
  else if (name === 'pageup')
    scroll -= page.rows
  else if (name === 'home')
    scroll = 0
  else if (name === 'end')
    scroll = page.maxScroll
  modal.scrolls[modal.section] = Math.max(0, Math.min(page.maxScroll, scroll))
}
