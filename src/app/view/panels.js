import { t } from '../../config/i18n.js'
import { doctorLabel } from '../../features/workspace.js'
import { CATEGORIES, displayValue, isDirty } from '../state.js'
import { COLORS } from './colors.js'
import { editingValue, windowContent, wrap } from './primitives.js'

export function navContent(s, rows) {
  return {
    title: t(s.language, 'Categories'),
    count: CATEGORIES.length,
    ...windowContent(
      CATEGORIES.map(category => t(s.language, category)),
      s.category,
      rows,
    ),
  }
}

export function listTitle(s) {
  if (s.files)
    return 'Managed files'
  if (CATEGORIES[s.category] === 'Doctor')
    return 'Doctor results'
  return '{category} documents'
}

export function listContent(s, app, rows) {
  const items = app.items()
  const doctor = CATEGORIES[s.category] === 'Doctor' && !s.files
  const index = doctor ? s.doctorIndex : s.selected
  const appName = s.documents.find(document => document.path === 'app.json')?.data?.name
  const entries = doctor
    ? s.doctor.map(
        entry =>
          `[${t(s.language, entry.status)}] ${doctorLabel(entry, s.language)}${entry.path ? ` ${entry.path}` : ''}`,
      )
    : items.map(
        item =>
          `[${t(s.language, item.missing ? 'missing' : 'present')}] ${item.path}${
            item.path === 'app.json' && appName && !s.files ? ` — ${appName}` : ''
          }`,
      )
  const prefix = s.search ? [t(s.language, 'Search: {query}', { query: s.search })] : []
  const content = windowContent(entries, index, rows - prefix.length)
  if (!entries.length) {
    if (s.search) {
      content.lines.push(t(s.language, 'no results for "{query}"', { query: s.search }))
    }
    else if (doctor) {
      content.lines.push(
        t(s.language, s.checking ? 'Checking…' : 'No checks yet. Press r to run Doctor.'),
      )
    }
    else if (s.files) {
      content.lines.push(t(s.language, 'No matching files.'))
    }
    else {
      content.lines.push(t(s.language, 'No documents. Press a to create.'))
    }
  }
  const colors = doctor
    ? undefined
    : [
        ...prefix.map(() => COLORS.text),
        ...items
          .slice(content.start, content.start + content.lines.length)
          .map(item => (item.missing ? COLORS.error : COLORS.present)),
      ]
  return {
    title: t(s.language, listTitle(s), { category: t(s.language, CATEGORIES[s.category]) }),
    count: entries.length,
    ...content,
    colors,
    lines: [...prefix, ...content.lines].slice(0, rows),
    selected: content.selected < 0 ? -1 : content.selected + prefix.length,
  }
}

function editorContent(s, app, rows, width) {
  const editor = s.editor
  const fields = app.fields()
  const text = Math.max(1, width - 5)
  const head
    = rows >= 4
      ? [
          editor.path.includes('/production/')
            ? `${editor.path} [${t(s.language, 'PRODUCTION')}]`
            : editor.path,
          '',
        ]
      : []
  const count = fields.length + 1
  const visible = Math.max(1, Math.floor(Math.max(0, rows - head.length) / 2))
  const start = Math.min(
    Math.max(0, editor.index - Math.floor(visible / 2)),
    Math.max(0, count - visible),
  )
  const lines = [...head]
  let selected = -1
  for (let index = start; index < Math.min(count, start + visible); index++) {
    const field = fields[index]
    if (editor.index === index)
      selected = lines.length
    if (!field) {
      lines.push(`[ ${t(s.language, 'Save document')} ]`, '')
      continue
    }
    lines.push(
      `${field.label}${field.required ? ' *' : ''}${field.type === 'file' ? `  ${t(s.language, '[file actions]')}` : ''}`,
    )
    const value
      = editor.index === index && editor.editing
        ? editingValue(editor.input, editor.cursor, field.type === 'secret', text)
        : displayValue(field, editor.draft[field.key], s.language)
    lines.push(`  ${value}`)
  }
  const title = `${t(s.language, '{kind} details', { kind: t(s.language, editor.kind) })}${isDirty(editor) ? ` — ${t(s.language, 'unsaved')}` : ''}${editor.editing ? ` — ${t(s.language, 'editing')}` : ''}`
  return { title, lines, selected, count, counter: `${editor.index + 1}/${count}` }
}

/** Preview text never reads file contents; it only restates state the controller already holds. */
function previewContent(s, app, rows, width) {
  const items = app.items()
  const item = items[s.files || CATEGORIES[s.category] !== 'Doctor' ? s.selected : s.doctorIndex]
  let title = t(s.language, 'Preview')
  let text = []
  if (s.files) {
    title = t(s.language, 'File preview')
    const config = item && s.documents.some(document => document.path === item.path)
    text = item
      ? [
          t(s.language, 'Path: {path}', { path: item.path }),
          '',
          t(
            s.language,
            item.missing
              ? 'Missing — only example instructions exist.'
              : 'Present — existence only; contents and credentials are not validated.',
          ),
          ...(item.missing
            ? [
                t(
                  s.language,
                  item.instructionOnly
                    ? 'Legacy credential instructions have no typed destination. Use a configuration file field to import the correct credential.'
                    : config
                      ? 'Press Enter to edit a clean document. Save creates the real file; example instructions are never copied.'
                      : 'Press Enter to import a real source file.',
                ),
              ]
            : []),
        ]
      : [t(s.language, 'No managed file selected.')]
  }
  else if (CATEGORIES[s.category] === 'Doctor' && !s.files) {
    title = t(s.language, 'Check details')
    const entry = s.doctor[s.doctorIndex]
    const count = status => s.doctor.filter(result => result.status === status).length
    text = entry
      ? [
          `[${t(s.language, entry.status)}] ${doctorLabel(entry, s.language)}`,
          entry.path ? t(s.language, 'Path: {path}', { path: entry.path }) : '',
          '',
          t(
            s.language,
            'Checks: {total} | pass {pass} | missing {missing} | warning {warning} | error {error} | unchecked {unchecked}',
            {
              total: s.doctor.length,
              pass: count('pass'),
              missing: count('missing'),
              warning: count('warning'),
              error: count('error'),
              unchecked: count('unchecked'),
            },
          ),
          '',
          t(s.language, 'File existence is not certificate validity or release readiness.'),
        ]
      : [t(s.language, s.checking ? 'Checking…' : 'No checks yet.')]
  }
  else if (item) {
    title = t(s.language, 'Document preview')
    text = [
      t(s.language, 'Path: {path}', { path: item.path }),
      t(s.language, 'Kind: {kind}', { kind: t(s.language, item.kind) }),
      '',
    ]
    text.push(
      t(
        s.language,
        item.missing
          ? 'Missing — only example instructions exist.'
          : 'Present — existence only; contents and credentials are not validated.',
      ),
    )
    if (item.missing) {
      text.push(
        t(
          s.language,
          'Press Enter to edit a clean document. Save creates the real file; example instructions are never copied.',
        ),
      )
    }
    for (const field of app.fields(item)) {
      text.push(
        `${field.label}${field.required ? ' *' : ''}`,
        `  ${displayValue(field, item.data?.[field.key], s.language)}`,
        '',
      )
    }
  }
  else {
    title = t(s.language, 'Document preview')
    text = [t(s.language, 'Nothing selected.')]
  }
  const wrapped = text.flatMap(line => wrap(line, Math.max(8, width)))
  const start = Math.min(Math.max(0, s.detailScroll), Math.max(0, wrapped.length - rows))
  return {
    title,
    lines: wrapped.slice(start, start + rows),
    count: wrapped.length,
    counter: `${wrapped.length ? start + 1 : 0}/${wrapped.length}`,
  }
}

export function detailContent(s, app, rows, width) {
  if (s.editor)
    return editorContent(s, app, rows, width)
  return previewContent(s, app, rows, width)
}
