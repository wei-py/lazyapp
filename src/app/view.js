import process from 'node:process'
import { fg, StyledText, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { LANGUAGES, t } from '../config/i18n.js'
import { DEFAULT_THEME, themeColors, themeName } from '../config/themes.js'
import { doctorLabel } from '../features/workspace.js'
import { CATEGORIES, displayValue, isDirty, layoutMode, preferenceItems } from './state.js'

// One view per process; each render swaps in the palette before drawing.
let COLORS = themeColors(DEFAULT_THEME)
const SEGMENTS = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const PANEL_IDS = ['nav', 'list', 'detail']
const PANEL_FOCUS = { nav: 'nav', list: 'list', detail: 'form' }
// Modal nodes are created last so an open dialog paints above every panel.
const NODE_IDS = [
  'keys',
  'message',
  ...['workspace', ...PANEL_IDS, 'status', 'modal'].flatMap(id => [
    `${id}Frame`,
    `${id}Inner`,
    `${id}Selection`,
  ]),
]

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

/** Frame rows are exactly the panel width so a stale row can never survive a repaint. */
function padColumns(value, width) {
  const clipped = clipColumns(value, width)
  return `${clipped}${' '.repeat(Math.max(0, width - stringWidth(clipped)))}`
}

function pathTail(value, width) {
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

function workspaceContent(s, width, compact = false) {
  const name
    = s.documents.find(document => document.path === 'app.json')?.data?.name
      || t(s.language, 'Workspace')
  const label = `${name}${isDirty(s.editor) ? ` · ${t(s.language, 'unsaved')}` : ''}`
  return {
    title: 'lazyapp',
    lines: compact
      ? [
          `${clipColumns(label, Math.floor(width / 2))} · ${pathTail(s.root, width - Math.min(stringWidth(label), Math.floor(width / 2)) - 3)}`,
        ]
      : [label, pathTail(s.root, width)],
  }
}

/** Keep the selected row visible and retain its position for the highlight and counter. */
function windowContent(lines, index, size) {
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

function navContent(s, rows) {
  return {
    title: t(s.language, 'Categories'),
    ...windowContent(
      CATEGORIES.map(category =>
        category === 'Settings' ? 'Settings / 设置' : t(s.language, category),
      ),
      s.category,
      rows,
    ),
  }
}

function listTitle(s) {
  if (s.files)
    return t(s.language, 'Managed files')
  if (CATEGORIES[s.category] === 'Doctor')
    return t(s.language, 'Doctor results')
  return t(s.language, '{category} documents', { category: t(s.language, CATEGORIES[s.category]) })
}

function listContent(s, app, rows) {
  if (CATEGORIES[s.category] === 'Settings') {
    const active = item => (item.kind === 'theme' ? item.id === s.theme : item.id === s.language)
    const entries = preferenceItems().map(item => `${active(item) ? '●' : '○'} ${item.name}`)
    return { title: 'Settings / 设置', ...windowContent(entries, s.settingsIndex, rows) }
  }
  const items = app.items()
  const doctor = CATEGORIES[s.category] === 'Doctor' && !s.files
  const index = doctor ? s.doctorIndex : s.selected
  const entries = doctor
    ? s.doctor.map(
        entry =>
          `[${t(s.language, entry.status)}] ${doctorLabel(entry, s.language)}${entry.path ? ` ${entry.path}` : ''}`,
      )
    : items.map(item => `[${t(s.language, item.missing ? 'missing' : 'present')}] ${item.path}`)
  const prefix = s.search ? [t(s.language, 'Search: {query}', { query: s.search })] : []
  const content = windowContent(entries, index, rows - prefix.length)
  if (!entries.length) {
    const empty = doctor
      ? s.busy
        ? 'Checking…'
        : 'No checks yet. Press r to run Doctor.'
      : s.files
        ? 'No matching files.'
        : 'No documents. Press n to create.'
    content.lines.push(t(s.language, empty))
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
    title: listTitle(s),
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
  return { title, lines, selected, counter: `${editor.index + 1}/${count}` }
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
      : [t(s.language, s.busy ? 'Checking…' : 'No checks yet.')]
  }
  else if (CATEGORIES[s.category] === 'Settings') {
    title = 'Settings / 设置'
    text = [
      t(s.language, 'Current language: {language}', {
        language: LANGUAGES.find(item => item.id === s.language).label,
      }),
      t(s.language, 'Current theme: {theme}', { theme: themeName(s.theme) }),
      '',
      t(s.language, 'Press Enter to apply and save the selected setting.'),
      t(s.language, 'Only interface language and colors change. Your workspace data is untouched.'),
    ]
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
    counter: `${wrapped.length ? start + 1 : 0}/${wrapped.length}`,
  }
}

function detailContent(s, app, rows, width) {
  if (s.editor)
    return editorContent(s, app, rows, width)
  return previewContent(s, app, rows, width)
}

function keyHints(s) {
  if (s.modal?.type === 'input')
    return t(s.language, 'TEXT DIALOG: Enter submit | Esc cancel | arrows move cursor')
  if (s.modal) {
    return t(
      s.language,
      'DIALOG: Enter confirms | Esc cancels | arrows/Tab choose | PgUp/PgDn details',
    )
  }
  if (s.editor?.editing) {
    return t(
      s.language,
      'TEXT INPUT: Enter accept | Esc restore | Ctrl+s save | shortcuts type normally',
    )
  }
  if (CATEGORIES[s.category] === 'Settings') {
    return s.focus === 'nav'
      ? t(s.language, 'j/k category | Enter to list | Tab/1/2/3 panel | ? help | q quit')
      : t(s.language, 'j/k setting | Enter apply | Tab/1/2/3 panel | Esc back | ? help | q quit')
  }
  if (s.focus === 'form' && s.editor) {
    return t(
      s.language,
      'Enter edit field | j/k field | Ctrl+s save | v full value | Esc to list | ? help | q quit',
    )
  }
  if (s.focus === 'form') {
    return t(
      s.language,
      'j/k scroll preview | Enter open | Esc to list | r refresh | ? help | q quit',
    )
  }
  if (s.focus === 'nav') {
    return t(
      s.language,
      'j/k category | Enter to list | Tab/1/2/3 panel | n new | / search | f files | ? help | q quit',
    )
  }
  if (s.files) {
    return t(
      s.language,
      'j/k move | Enter open/import | d delete | / search | r refresh | Esc to categories | q quit',
    )
  }
  if (CATEGORIES[s.category] === 'Doctor') {
    return t(
      s.language,
      'j/k result | Enter details | r rerun | f files | Esc to categories | ? help | q quit',
    )
  }
  return t(
    s.language,
    'j/k move | Enter details | n new | / search | f files | r refresh | ? help | q quit',
  )
}

/** Stable native renderables; only visible rows are constructed on each state change. */
export function createView(renderer) {
  const nodes = {}
  const border
    = process.env.TERM === 'dumb'
      ? {
          topLeft: '+',
          topRight: '+',
          bottomLeft: '+',
          bottomRight: '+',
          horizontal: '-',
          vertical: '|',
        }
      : {
          topLeft: '╭',
          topRight: '╮',
          bottomLeft: '╰',
          bottomRight: '╯',
          horizontal: '─',
          vertical: '│',
        }
  for (const id of NODE_IDS) {
    nodes[id] = new TextRenderable(renderer, {
      id,
      position: 'absolute',
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      content: '',
      fg: COLORS.text,
      bg: COLORS.background,
      wrapMode: 'none',
      selectable: false,
    })
    renderer.root.add(nodes[id])
  }
  function show(
    id,
    left,
    top,
    width,
    height,
    lines,
    color = COLORS.text,
    background = COLORS.background,
    colors,
  ) {
    const node = nodes[id]
    node.visible = width > 0 && height > 0
    if (!node.visible)
      return
    Object.assign(node, { left, top, width, height, fg: color, bg: background })
    const visible = lines.slice(0, height).map(line => clipColumns(line, width))
    node.content = colors
      ? new StyledText(
          visible.map((line, index) => fg(colors[index] || color)(`${index ? '\n' : ''}${line}`)),
        )
      : visible.join('\n')
  }
  function box(
    id,
    left,
    top,
    width,
    height,
    content,
    frameColor = COLORS.border,
    color = COLORS.text,
  ) {
    if (width < 4 || height < 2)
      return
    const innerWidth = width - 2
    const innerHeight = height - 2
    const label = clipColumns(` ${content.title} `, innerWidth)
    const counter = content.counter ? clipColumns(` ${content.counter} `, innerWidth) : ''
    const frame = [
      `${border.topLeft}${label}${border.horizontal.repeat(innerWidth - stringWidth(label))}${border.topRight}`,
      ...Array.from(
        { length: innerHeight },
        () => `${border.vertical}${' '.repeat(innerWidth)}${border.vertical}`,
      ),
      `${border.bottomLeft}${border.horizontal.repeat(innerWidth - stringWidth(counter))}${counter}${border.bottomRight}`,
    ]
    show(`${id}Frame`, left, top, width, height, frame, frameColor)
    show(
      `${id}Inner`,
      left + 1,
      top + 1,
      innerWidth,
      innerHeight,
      content.lines.map(line => ` ${line}`),
      color,
      COLORS.background,
      content.colors,
    )
    if (
      content.selected >= 0
      && content.selected < innerHeight
      && content.selected < content.lines.length
    ) {
      show(
        `${id}Selection`,
        left + 1,
        top + 1 + content.selected,
        innerWidth,
        1,
        [padColumns(` ${content.lines[content.selected]}`, innerWidth)],
        content.colors?.[content.selected] || COLORS.selectionText,
        COLORS.selection,
      )
    }
  }
  function panel(id, left, top, width, height, content, s) {
    const focused = PANEL_FOCUS[id] === s.focus
    const number = PANEL_IDS.indexOf(id) + 1
    box(
      id,
      left,
      top,
      width,
      height,
      { ...content, title: `[${number}] ${content.title}` },
      focused ? COLORS.focus : COLORS.border,
    )
  }
  function panelContent(id, s, app, rows, width) {
    if (id === 'nav')
      return navContent(s, rows)
    if (id === 'list')
      return listContent(s, app, rows)
    return detailContent(s, app, rows, width)
  }
  return (s, app) => {
    s.width = renderer.width
    s.height = renderer.height
    const { width, height } = s
    COLORS = themeColors(s.theme)
    const mode = layoutMode(width, height)
    for (const node of Object.values(nodes)) node.visible = false
    if (mode === 'small') {
      const content = s.modal
        ? [
            s.modal.title,
            ...(s.modal.type === 'choice'
              ? [`> ${s.modal.options[s.modal.index]}`]
              : [t(s.language, 'Too small to edit this input.')]),
            t(s.language, 'Arrows choose; Enter confirms; Esc cancels.'),
          ]
        : [
            t(s.language, 'Terminal too small.'),
            t(s.language, 'Need 60 columns x 16 rows.'),
            t(s.language, 'Resize, or q / Ctrl+c to quit.'),
          ]
      show('message', 0, 0, width, height, content, s.modal ? COLORS.focus : COLORS.warning)
      renderer.requestRender()
      return
    }
    if (mode === 'dual') {
      // 1:2:2 nav:list:detail columns, matching lazymise's dual geometry.
      const navWidth = Math.floor((width - 2) / 5)
      const listWidth = Math.floor((width - navWidth - 2) / 2)
      const detailLeft = navWidth + listWidth + 2
      const detailWidth = width - detailLeft
      const panelHeight = height - 9
      const rows = panelHeight - 2
      box('workspace', 0, 0, width, 4, workspaceContent(s, width - 3))
      panel('nav', 1, 4, navWidth, panelHeight, navContent(s, rows), s)
      panel('list', navWidth + 1, 4, listWidth, panelHeight, listContent(s, app, rows), s)
      panel(
        'detail',
        detailLeft,
        4,
        detailWidth,
        panelHeight,
        detailContent(s, app, rows, detailWidth - 3),
        s,
      )
      box(
        'status',
        0,
        height - 5,
        width,
        4,
        {
          title: t(s.language, s.error ? 'Error' : s.busy ? 'Working' : 'Status'),
          lines: wrap(s.status, width - 3),
        },
        COLORS.border,
        s.error ? COLORS.error : s.busy ? COLORS.warning : COLORS.muted,
      )
    }
    else {
      const panelTop = 3
      const panelHeight = height - 5
      box('workspace', 0, 0, width, panelTop, workspaceContent(s, width - 3, true))
      const focus = s.modal?.returnFocus || s.focus
      const focusId = PANEL_IDS.find(id => PANEL_FOCUS[id] === focus) || 'detail'
      const previewId = focusId === 'detail' ? 'list' : 'detail'
      const topHeight = Math.max(
        4,
        Math.min(
          panelHeight - 4,
          focus === 'form' ? Math.floor(panelHeight * 0.66) : Math.floor(panelHeight * 0.55),
        ),
      )
      const bottomHeight = panelHeight - topHeight
      panel(
        focusId,
        0,
        panelTop,
        width,
        topHeight,
        panelContent(focusId, s, app, topHeight - 2, width - 3),
        s,
      )
      panel(
        previewId,
        0,
        panelTop + topHeight,
        width,
        bottomHeight,
        panelContent(previewId, s, app, bottomHeight - 2, width - 3),
        s,
      )
      show(
        'message',
        0,
        height - 2,
        width,
        1,
        [s.status],
        s.error ? COLORS.error : s.busy ? COLORS.warning : COLORS.muted,
      )
    }
    show('keys', 0, height - 1, width, 1, [keyHints(s)], COLORS.muted)
    if (s.modal) {
      const modal = s.modal
      const modalWidth = Math.min(width - 4, 84)
      const detailWidth = modalWidth - 3
      // Dialog nodes are last, including their selection, and never cover the footer.
      const available = height - 3
      const detail = wrap(modal.detail || '', detailWidth)
      const optionLines
        = modal.type === 'input'
          ? [editingValue(modal.value, modal.cursor, false, detailWidth)]
          : modal.options
      const detailCount = Math.max(0, available - optionLines.length - 4)
      const start = Math.min(modal.scroll || 0, Math.max(0, detail.length - detailCount))
      const content = [
        ...detail.slice(start, start + detailCount),
        ...(detail.length > detailCount ? [t(s.language, '[PgUp/PgDn: more details]')] : []),
        '',
      ]
      const selected = modal.type === 'choice' ? content.length + modal.index : -1
      content.push(...optionLines)
      const modalHeight = Math.min(available, content.length + 2)
      box(
        'modal',
        Math.floor((width - modalWidth) / 2),
        Math.max(1, Math.floor((height - 1 - modalHeight) / 2)),
        modalWidth,
        modalHeight,
        { title: modal.title, lines: content, selected },
        COLORS.focus,
      )
    }
    renderer.requestRender()
  }
}
