import process from 'node:process'
import { fg, StyledText, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { t } from '../config/i18n.js'
import { layoutMode } from './state.js'
import { COLORS, setTheme } from './view/colors.js'
import { keyHints } from './view/hints.js'
import { detailContent, listContent, navContent, workspaceContent } from './view/panels.js'
import { clipColumns, editingValue, padColumns, wrap } from './view/primitives.js'

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
    show(`${id}Frame`, left, top, width, height, frame, frameColor, background)
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
      { ...content, title: focused ? `[${number}] [${content.title}]` : `[${number}] ${content.title}` },
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
    if (hint.label)
      parts.push({ text: `${hint.label} `, color: COLORS.focus })
    for (const [i, chip] of hint.items.entries()) {
      if (i || hint.label)
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
        COLORS.text,
        COLORS.surface,
      )
    }
    renderer.requestRender()
  }
}
