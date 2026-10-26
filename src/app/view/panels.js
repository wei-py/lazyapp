import { t } from '../../config/i18n.js'
import { doctorLabel } from '../../features/workspace.js'
import { displayValue, GROUP_TABS, isDirty } from '../state.js'
import { COLORS } from './colors.js'
import { editingValue, windowContent, wrap } from './primitives.js'

export function groupContent(s, app, group, rows) {
  const navigation = s.groups[group - 1]
  const tab = navigation.tab
  const items = app.groupItems(group)
  const index = navigation.indices[tab]
  const title = group < 3
    ? GROUP_TABS[group - 1].map(label => t(s.language, label)).join(' / ')
    : GROUP_TABS[group - 1].map((label, i) => `${i === tab ? '•' : ''}${t(s.language, label)}`).join(' / ')
  const labels = items.map((item) => {
    if (item.node)
      return `${s.expanded.includes(item.kind) ? '▾' : '▸'} ${item.kind}`
    if (item.doctor)
      return `[${t(s.language, item.status)}] ${doctorLabel(item, s.language)}`
    const active = s.activeGroup === group && (s.activeTab ?? 0) === tab && app.activeItem()?.path === item.path
    let label = item.path
    if (group === 2) {
      const parts = item.path.split('/')
      label = parts.length === 3 ? t(s.language, 'Identity / root') : `${parts[2]} / ${parts.at(-1)}`
      label = `  ${label}`
    }
    else if (group === 3) {
      label = item.path.split('/').slice(1).join('/')
    }
    return `${active ? '›' : ' '} ${item.missing ? '○' : '●'} ${label}`
  })
  const content = windowContent(labels, index, rows)
  if (!labels.length)
    content.lines = [t(s.language, navigation.searches[tab] ? 'No matching files.' : group === 4 && tab === 1 ? 'No checks yet. Press r to run Doctor.' : 'No documents. Press a to create.')]
  return {
    title,
    count: items.length,
    ...content,
    colors: items.slice(content.start, content.start + content.lines.length).map(item => item.node || item.doctor ? COLORS.text : item.missing ? COLORS.error : COLORS.present),
  }
}

function editorContent(s, app, rows, width) {
  const editor = s.editor
  const fields = app.fields()
  const text = Math.max(1, width - 3)
  const lines = []
  const positions = []
  let section
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    const nextSection = field.type === 'file' ? 'File references' : field.type === 'secret' || editor.scope === 'signing' || editor.path.split('/').length === 4 ? 'Credentials' : 'Basic information'
    if (section !== nextSection) {
      if (lines.length)
        lines.push('')
      lines.push(`─ ${t(s.language, nextSection)} ─`)
      section = nextSection
    }
    positions.push(lines.length)
    lines.push(`${field.label}${field.required ? ' *' : ''}${field.type === 'file' ? ` ${t(s.language, '[file actions]')}` : ''}`)
    const value = editor.index === index && editor.editing
      ? editingValue(editor.input, editor.cursor, field.type === 'secret', text)
      : displayValue(field, editor.draft[field.key], s.language)
    lines.push(`  ${value}`)
  }
  positions.push(lines.length)
  lines.push(`[ ${t(s.language, 'Save document')} ]`)
  const selectedRow = positions[Math.min(editor.index, fields.length)]
  const start = Math.min(Math.max(0, selectedRow - Math.floor(rows / 2)), Math.max(0, lines.length - rows))
  const title = `${isDirty(editor) ? '* ' : ''}${editor.path}${editor.editing ? ` · ${t(s.language, 'editing')}` : ''}`
  return { title, lines: lines.slice(start, start + rows), selected: selectedRow - start, counter: `${editor.index + 1}/${fields.length + 1}` }
}

export function detailContent(s, app, rows, width) {
  if (s.editor)
    return editorContent(s, app, rows, width)
  const item = app.activeItem()
  let title = t(s.language, 'Preview')
  let text = [t(s.language, 'Nothing selected.')]
  if (app.isDoctor()) {
    title = t(s.language, 'Check details')
    text = item ? [`[${t(s.language, item.status)}] ${doctorLabel(item, s.language)}`, item.path || '', t(s.language, 'File existence is not certificate validity or release readiness.')] : [t(s.language, s.checking ? 'Checking…' : 'No checks yet.')]
  }
  else if (item && !item.node) {
    title = item.path
    text = [t(s.language, item.missing ? 'missing' : 'present')]
    if (!item.file) {
      for (const field of app.fields(item))
        text.push(`${field.label}: ${displayValue(field, item.data?.[field.key], s.language)}`)
    }
    else if (item.missing) {
      text.push(t(s.language, 'Press Enter to import a real source file.'))
    }
  }
  const wrapped = text.flatMap(line => wrap(line, Math.max(8, width)))
  const start = Math.min(Math.max(0, s.detailScroll), Math.max(0, wrapped.length - rows))
  return { title, lines: wrapped.slice(start, start + rows), counter: `${wrapped.length ? start + 1 : 0}/${wrapped.length}` }
}
