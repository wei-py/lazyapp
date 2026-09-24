import process from 'node:process'
import { fg, StyledText, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { JOB_GLYPH } from '../../vendor/lazy-kit/jobs.js'
import { themeName } from '../../vendor/lazy-kit/themes.js'
import { LANGUAGES, t } from '../config/i18n.js'
import { isDirty, layoutMode } from './state.js'
import { COLORS, setTheme } from './view/colors.js'
import { keyHints } from './view/hints.js'
import { detailContent, listContent, navContent } from './view/panels.js'
import { clipColumns, editingValue, padColumns, wrap } from './view/primitives.js'

const PANEL_IDS = ['nav', 'list', 'detail']
const PANEL_FOCUS = { nav: 'nav', list: 'list', detail: 'form' }
const JOB_ROWS = 3
// Modal nodes are created last so an open dialog paints above every panel.
const NODE_IDS = [
  'keys',
  'message',
  'header',
  ...['nav', 'list', 'detail', 'status', 'modal'].flatMap(id => [
    `${id}Frame`,
    `${id}Inner`,
    `${id}Selection`,
  ]),
]

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
          topLeft: '┌',
          topRight: '┐',
          bottomLeft: '└',
          bottomRight: '┘',
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
    background = COLORS.background,
    titleColor = frameColor,
  ) {
    if (width < 4 || height < 2)
      return
    const innerWidth = width - 2
    const innerHeight = height - 2
    const label = clipColumns(` ${content.title} `, innerWidth)
    const counter = content.counter ? clipColumns(` ${content.counter} `, innerWidth) : ''
    const frame = [
      `${border.topLeft}${label}${border.horizontal.repeat(Math.max(0, innerWidth - stringWidth(label)))}${border.topRight}`,
      ...Array.from(
        { length: innerHeight },
        () => `${border.vertical}${' '.repeat(innerWidth)}${border.vertical}`,
      ),
      `${border.bottomLeft}${border.horizontal.repeat(Math.max(0, innerWidth - stringWidth(counter)))}${counter}${border.bottomRight}`,
    ]
    show(
      `${id}Frame`,
      left,
      top,
      width,
      height,
      frame,
      frameColor,
      background,
      [titleColor, ...Array.from({ length: frame.length - 1 }).fill(frameColor)],
    )
    show(
      `${id}Inner`,
      left + 1,
      top + 1,
      innerWidth,
      innerHeight,
      content.lines.map(line => ` ${line}`),
      color,
      background,
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
        COLORS.selectionText,
        COLORS.selection,
      )
    }
  }
  /** `[n] Title (count)`: number follows render order, focus owns title + border color. */
  function panel(id, left, top, width, height, content, s) {
    const focused = PANEL_FOCUS[id] === s.focus
    const number = PANEL_IDS.indexOf(id) + 1
    const innerWidth = width - 2
    const prefix = `[${number}] `
    const suffix = content.count === undefined ? '' : ` (${content.count})`
    const budget = Math.max(1, innerWidth - 2 - stringWidth(prefix) - stringWidth(suffix))
    const title = `${prefix}${clipColumns(content.title, budget)}${suffix}`
    box(
      id,
      left,
      top,
      width,
      height,
      { ...content, title },
      focused ? COLORS.focus : COLORS.border,
      COLORS.text,
      COLORS.background,
      focused ? COLORS.focus : COLORS.muted,
    )
  }
  function renderHeader(s, width) {
    const node = nodes.header
    node.visible = true
    Object.assign(node, { left: 0, top: 0, width, height: 1, fg: COLORS.text, bg: COLORS.background })
    const home = (process.env.HOME ?? '').replace(/\/$/, '')
    const root = s.root
    const abbreviated = home && root.startsWith(home) ? `~${root.slice(home.length)}` : root
    const chipPlain = 'zh en'
    const prefixPlain = ' LAZYAPP │ '
    const pathBudget = Math.max(3, width - prefixPlain.length - chipPlain.length - 1)
    const shownPath
      = stringWidth(abbreviated) > pathBudget
        ? `${clipColumns(abbreviated, pathBudget - 1)}…`
        : abbreviated
    const dirty = isDirty(s.editor) ? ' ●' : ''
    const pad = ' '.repeat(
      Math.max(1, width - prefixPlain.length - stringWidth(shownPath + dirty) - chipPlain.length),
    )
    const segments = [
      { text: ' ', color: COLORS.text },
      { text: 'LAZYAPP', color: COLORS.focus },
      { text: ' │ ', color: COLORS.border },
      { text: shownPath, color: COLORS.repo },
      ...(dirty ? [{ text: dirty, color: COLORS.warning }] : []),
      { text: pad, color: COLORS.text },
      { text: 'zh', color: s.language === 'zh' ? COLORS.focus : COLORS.muted },
      { text: ' ', color: COLORS.border },
      { text: 'en', color: s.language === 'en' ? COLORS.focus : COLORS.muted },
    ]
    node.content = new StyledText(segments.map(segment => fg(segment.color)(segment.text)))
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
    setTheme(s.theme)
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
    const activeJobs = s.jobs.filter(
      job => job.state === 'running' || job.state === 'queued',
    )
    const settledJobs = s.jobs.filter(
      job => job.state !== 'running' && job.state !== 'queued',
    )
    const shownJobs = [
      ...activeJobs,
      ...settledJobs.slice(Math.max(0, settledJobs.length - 1)),
    ].slice(0, JOB_ROWS)
    const statusHeight = 4 + shownJobs.length
    const hiddenJobs = s.jobs.length - shownJobs.length
    const statusActive = activeJobs.length > 0
    const stateText = statusActive
      ? `${t(s.language, '{count} active', { count: activeJobs.length })}${hiddenJobs > 0 ? ` +${hiddenJobs}` : ''}`
      : s.checking
        ? t(s.language, 'checking…')
        : t(s.language, 'idle')
    const logs = app.runner.log()
    const lastLog = logs.length > 0 ? logs[logs.length - 1] : ''
    const jobColor = {
      queued: COLORS.muted,
      running: COLORS.warning,
      done: COLORS.present,
      failed: COLORS.warning,
      canceled: COLORS.muted,
    }
    const jobLines = shownJobs.map((job) => {
      let detail = job.lastLine
      if (job.state === 'queued')
        detail = t(s.language, 'waiting for other jobs')
      if (job.endedAt !== null && job.startedAt !== null) {
        const seconds = `${Math.max(1, Math.round((job.endedAt - job.startedAt) / 1000))}s`
        if (job.state === 'canceled')
          detail = t(s.language, 'canceled · {seconds}', { seconds })
        else if (job.state === 'failed' && job.exitCode === null)
          detail = job.lastLine
        else detail = t(s.language, 'exit {code} · {seconds}', { code: job.exitCode, seconds })
      }
      return `${JOB_GLYPH[job.state]} ${job.label}  ${detail}`
    })
    const logColor = statusActive ? COLORS.warning : COLORS.muted
    const stateColor = statusActive
      ? COLORS.warning
      : s.error
        ? COLORS.error
        : COLORS.muted
    renderHeader(s, width)
    if (mode === 'dual') {
      // 1:2:2 nav:list:detail columns; the nav floor keeps `[1] Title (count)` intact.
      const navWidth = Math.max(23, Math.floor((width - 2) / 5))
      const listWidth = Math.floor((width - navWidth - 2) / 2)
      const detailLeft = navWidth + listWidth + 2
      const detailWidth = width - detailLeft
      const panelHeight = height - statusHeight - 2
      const rows = Math.max(1, panelHeight - 2)
      panel('nav', 1, 1, navWidth, panelHeight, navContent(s, rows), s)
      panel('list', navWidth + 1, 1, listWidth, panelHeight, listContent(s, app, rows), s)
      panel(
        'detail',
        detailLeft,
        1,
        detailWidth,
        panelHeight,
        detailContent(s, app, rows, detailWidth - 3),
        s,
      )
      box(
        'status',
        0,
        height - statusHeight - 1,
        width,
        statusHeight,
        {
          title: t(s.language, !statusActive && s.error ? 'Error' : 'Status'),
          lines: [stateText, ...jobLines, lastLog ? `» ${lastLog}` : ''],
          colors: [
            stateColor,
            ...shownJobs.map(job => jobColor[job.state]),
            logColor,
          ],
        },
        statusActive ? COLORS.warning : COLORS.border,
        COLORS.text,
        COLORS.background,
        statusActive ? COLORS.warning : !s.error ? COLORS.muted : COLORS.error,
      )
    }
    else {
      const panelTop = 1
      const panelHeight = height - 3
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
        panelContent(focusId, s, app, Math.max(1, topHeight - 2), width - 3),
        s,
      )
      panel(
        previewId,
        0,
        panelTop + topHeight,
        width,
        bottomHeight,
        panelContent(previewId, s, app, Math.max(1, bottomHeight - 2), width - 3),
        s,
      )
      show(
        'message',
        0,
        height - 2,
        width,
        1,
        [`${stateText}${lastLog ? ` » ${lastLog}` : ''}`],
        stateColor,
      )
    }
    const keysNode = nodes.keys
    keysNode.visible = true
    Object.assign(keysNode, {
      left: 0,
      top: height - 1,
      width,
      height: 1,
      fg: COLORS.muted,
      bg: COLORS.background,
    })
    const hint = keyHints(s)
    const parts = []
    for (const [i, chip] of hint.entries()) {
      if (i)
        parts.push({ text: '  ·  ', color: COLORS.border })
      parts.push({ text: chip.key, color: COLORS.focus })
      if (chip.desc)
        parts.push({ text: ` ${chip.desc}`, color: COLORS.muted })
    }
    const segments = []
    let used = 0
    for (const part of parts) {
      const size = stringWidth(part.text)
      if (used + size > width) {
        segments.push(fg(part.color)(clipColumns(part.text, Math.max(0, width - used))))
        break
      }
      segments.push(fg(part.color)(part.text))
      used += size
    }
    keysNode.content = new StyledText(segments)
    if (s.modal) {
      const modal = s.modal
      const modalWidth = Math.min(width - 4, 84)
      const detailWidth = modalWidth - 3
      // Dialog nodes are last, including their selection, and never cover the footer.
      const available = height - 3
      const detailText = modal.search
        ? modal.value === ''
          ? t(s.language, 'press / to search')
          : ''
        : modal.detail || ''
      const detail = wrap(detailText, detailWidth)
      const optionLines
        = modal.type === 'input'
          ? [editingValue(modal.value, modal.cursor, false, detailWidth)]
          : modal.type === 'settings'
            ? [
                settingRow(s, 0, detailWidth),
                settingRow(s, 1, detailWidth),
              ]
            : modal.options
      const detailCount = Math.max(0, available - optionLines.length - 4)
      const start = Math.min(modal.scroll || 0, Math.max(0, detail.length - detailCount))
      const content = [
        ...detail.slice(start, start + detailCount),
        ...(detail.length > detailCount ? [t(s.language, '[PgUp/PgDn: more details]')] : []),
        '',
      ]
      const selected
        = modal.type === 'choice'
          ? content.length + modal.index
          : modal.type === 'settings'
            ? content.length + modal.row
            : -1
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
        COLORS.text,
        COLORS.surface,
      )
    }
    renderer.requestRender()
  }
}

/** Settings popup rows: `Language: 中文` and `Theme: <display name>`. */
function settingRow(s, row, width) {
  const label = row === 0 ? t(s.language, 'Language') : t(s.language, 'Theme')
  const value
    = row === 0
      ? LANGUAGES.find(item => item.id === s.language)?.label ?? s.language
      : themeName(s.theme)
  return clipColumns(`${label}: ${value}`, width)
}
