import { TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { CATEGORIES, displayValue, isDirty, layoutMode } from './state.js'

const COLORS = { text: '#e4e4e7', muted: '#a1a1aa', accent: '#38bdf8', success: '#4ade80', warning: '#facc15', error: '#fb7185', border: '#52525b', focus: '#bae6fd', background: '#18181b' }
const SEGMENTS = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

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

function wrap(value, width) {
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

function editingValue(value, cursor, secret, width) {
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

/** Stable native renderables; only visible rows are constructed on each state change. */
export function createView(renderer) {
  const nodes = {}
  for (const id of ['header', 'nav', 'body', 'status', 'keys', 'modal']) {
    nodes[id] = new TextRenderable(renderer, { id, position: 'absolute', left: 0, top: 0, width: 1, height: 1, content: '', fg: COLORS.text, bg: COLORS.background, wrapMode: 'none', selectable: false })
    renderer.root.add(nodes[id])
  }
  function show(id, left, top, width, height, lines, color = COLORS.text) {
    const node = nodes[id]
    node.visible = width > 0 && height > 0
    if (!node.visible)
      return
    Object.assign(node, { left, top, width, height, fg: color })
    node.content = lines.slice(0, height).map(line => clipColumns(line, width)).join('\n')
  }
  return (s, app) => {
    s.width = renderer.width
    s.height = renderer.height
    const { width, height } = s
    const mode = layoutMode(width, height)
    if (mode === 'small') {
      for (const node of Object.values(nodes)) node.visible = false
      show('body', 0, 0, width, height, ['Terminal too small.', 'Need 60 columns x 16 rows.', 'Resize, q or Ctrl+c to quit.'])
      if (s.modal)
        show('body', 0, 0, width, height, [s.modal.title, s.modal.type === 'choice' ? `> ${s.modal.options[s.modal.index]}` : 'Resize to edit this input.', 'Arrows choose; Enter confirms.', 'Esc cancels; SIGTERM exits.'])
      return
    }
    show('header', 0, 0, width, 2, [`lazyapp | ${s.root}`, `${s.wizard ? 'INITIALIZATION — no disk writes before Create' : CATEGORIES[s.category]} | ${mode} | focus: ${s.focus}${isDirty(s.editor) ? ' | UNSAVED' : ''}`], COLORS.accent)
    const navWidth = mode === 'dual' && !s.wizard ? 23 : 0
    const contentTop = 3
    const contentHeight = height - 7
    const navShown = !s.wizard && (mode === 'dual' || s.focus === 'nav')
    show('nav', 0, contentTop, navShown ? (navWidth || width) : 0, contentHeight, ['NAVIGATION', '', ...CATEGORIES.map((name, index) => `${index === s.category ? (s.focus === 'nav' ? '> ' : '* ') : '  '}${name}`), '', 'Enter: open category'], s.focus === 'nav' ? COLORS.focus : COLORS.muted)
    const left = navWidth ? navWidth + 1 : 0
    const bodyWidth = width - left
    const bodyShown = s.wizard || mode === 'dual' || s.focus !== 'nav'
    let lines = []
    if (s.editor) {
      const editor = s.editor
      const fields = app.fields()
      const count = fields.length + 1
      const visible = Math.max(1, Math.floor((contentHeight - 3) / 2))
      const start = Math.min(Math.max(0, editor.index - visible + 1), Math.max(0, count - visible))
      lines = [editor.path, `${editor.editing ? 'TEXT INPUT — Enter accepts / Esc restores field' : 'FORM — Enter edits / Tab selects next / v full value'}${editor.path.includes('/production/') ? ' [PRODUCTION]' : ''}`, '']
      for (let index = start; index < Math.min(count, start + visible); index++) {
        const field = fields[index]
        const selected = editor.index === index
        if (!field) {
          lines.push(`${selected ? '> ' : '  '}[ ${s.wizard ? 'Continue / final confirmation' : 'Save document'} ]`, '')
          continue
        }
        lines.push(`${selected ? '> ' : '  '}${field.label}${field.required ? ' *' : ''}${field.type === 'file' ? ' [file actions]' : ''}`)
        const value = selected && editor.editing ? editingValue(editor.input, editor.cursor, field.type === 'secret', bodyWidth - 4) : displayValue(field, editor.draft[field.key])
        lines.push(`    ${value}`)
      }
    }
    else if (CATEGORIES[s.category] === 'Doctor' && !s.files) {
      const start = Math.max(0, s.doctorIndex - contentHeight + 4)
      lines = ['DOCTOR — read-only; r reruns', 'Existence does not establish validity.', '', ...s.doctor.slice(start, start + contentHeight - 3).map((item, index) => `${start + index === s.doctorIndex ? '> ' : '  '}[${item.status}] ${item.label} ${item.path || ''}`)]
      if (!s.doctor.length)
        lines.push(s.busy ? 'Checking…' : 'No checks yet. Press r.')
    }
    else {
      const items = app.items()
      const start = Math.max(0, s.selected - contentHeight + 4)
      lines = [s.files ? 'MANAGED FILES — d deletes one selected file' : `${CATEGORIES[s.category]} — n creates a configuration`, s.search ? `Search: ${s.search} (/ to change)` : 'Enter opens; / searches paths only', '', ...items.slice(start, start + contentHeight - 3).map((item, index) => `${start + index === s.selected ? '> ' : '  '}${item.path}`)]
      if (!items.length)
        lines.push(s.files ? 'No managed files match. Use / to change the filter.' : 'Not configured. Press n to add, or Enter to start.')
    }
    show('body', left, contentTop, bodyShown ? bodyWidth : 0, contentHeight, lines)
    show('status', 0, height - 3, width, 2, wrap(s.status, width), s.error ? COLORS.error : s.busy ? COLORS.warning : COLORS.success)
    let keys
    if (s.modal?.type === 'input')
      keys = 'TEXT DIALOG: Enter submit | Esc cancel | arrows move cursor'
    else if (s.modal)
      keys = 'DIALOG: Enter confirms | Esc cancels | arrows/Tab choose | PgUp/PgDn details'
    else if (s.editor?.editing)
      keys = 'TEXT INPUT: Enter accept | Esc restore | Ctrl+s save | shortcuts type normally'
    else if (s.wizard)
      keys = 'Enter edit/continue | Tab next | Esc previous | Ctrl+w cancel wizard | ? help'
    else if (s.editor)
      keys = 'Enter edit | Tab next | Ctrl+s save | Esc back | ? help | q quit'
    else if (s.focus === 'nav')
      keys = 'j/k move | Enter category | Tab details | f files | ? help | q quit'
    else if (s.files)
      keys = 'j/k move | d delete | Enter path | / search | r refresh | Esc back | q quit'
    else if (CATEGORIES[s.category] === 'Doctor')
      keys = 'j/k move | Enter details | r rerun | f files | Esc back | ? help | q quit'
    else
      keys = 'j/k move | Enter open | n new | / search | f files | r refresh | ? help | q quit'
    show('keys', 0, height - 1, width, 1, [keys], COLORS.muted)
    nodes.modal.visible = Boolean(s.modal)
    if (s.modal) {
      const modal = s.modal
      const modalWidth = Math.min(width - 4, 84)
      const detailWidth = modalWidth - 4
      const available = height - 8
      const detail = wrap(modal.detail || '', detailWidth)
      const optionLines = modal.type === 'input' ? [editingValue(modal.value, modal.cursor, false, detailWidth), '', 'Enter submits | Esc cancels'] : modal.options.map((option, index) => `${index === modal.index ? '> ' : '  '}${option}`)
      const detailCount = Math.max(0, available - optionLines.length - 4)
      const start = Math.min(modal.scroll || 0, Math.max(0, detail.length - detailCount))
      const content = [modal.title, '', ...detail.slice(start, start + detailCount), ...(detail.length > detailCount ? ['[PgUp/PgDn: more details]'] : []), '', ...optionLines]
      const border = `+${'-'.repeat(modalWidth - 2)}+`
      const bordered = [border, ...content.map(line => `| ${clipColumns(line, detailWidth).padEnd(detailWidth + clipColumns(line, detailWidth).length - stringWidth(clipColumns(line, detailWidth)))} |`), border]
      show('modal', Math.floor((width - modalWidth) / 2), 3, modalWidth, Math.min(height - 4, bordered.length), bordered, COLORS.focus)
    }
    renderer.requestRender()
  }
}
