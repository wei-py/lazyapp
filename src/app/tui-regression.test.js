import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { expect, test } from 'bun:test'
import stringWidth from 'string-width'
import { hintSegments } from '../config/i18n.js'
import { normalizeKey } from '../main.js'
import { Application } from './controller.js'
import { operation } from './operations.js'
import { editDocument } from './state.js'
import { createView } from './view.js'

// Fake clipboard helper: captures whatever `y` copies so tests stay deterministic. Windows has no
// POSIX shell to write the payload with, so there the payload assertion is skipped.
const clipHelper
  = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'linux' ? 'wl-copy' : null
const clipBin = mkdtempSync(join(tmpdir(), 'lazyapp-clip-bin-'))
const clipFile = join(clipBin, 'clip-out')
if (clipHelper) {
  writeFileSync(join(clipBin, clipHelper), `#!/bin/sh\ncat > '${clipFile}'\n`)
  chmodSync(join(clipBin, clipHelper), 0o755)
  process.env.PATH = [clipBin, process.env.PATH].join(delimiter)
}

const APP = {
  schemaVersion: 1,
  name: 'Demo',
  description: '',
  version: '1.0.0',
  platforms: [],
  environments: [],
}

function documents() {
  return [
    { path: 'app.json', kind: 'app', data: structuredClone(APP), revision: 'original' },
    ...['alpha', 'beta'].map(name => ({
      path: `services/${name}.json`,
      kind: 'service',
      data: { schemaVersion: 1, name },
      revision: 'original',
    })),
  ]
}

async function fixture(run, width = 100, height = 24) {
  const previousXdg = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), 'lazyapp-regression-'))
  process.env.XDG_CONFIG_HOME = dir
  const ui = await createTestRenderer({
    width,
    height,
    kittyKeyboard: true,
    exitOnCtrlC: false,
    exitSignals: [],
  })
  const exits = []
  const app = new Application(join(dir, 'project'), createView(ui.renderer), code =>
    exits.push(code))
  app.state.documents = documents()
  app.session = {
    list: async () => app.state.documents.map(document => document.path),
    read: async (path) => {
      const document = app.state.documents.find(item => item.path === path)
      return { data: document?.data ?? null, revision: document?.revision ?? null }
    },
    save: async (path, data) => ({ data: structuredClone(data), revision: 'saved' }),
    removeFile: async () => {},
    permissionWarnings: async () => [],
    close: async () => {},
  }
  ui.renderer.keyInput.on('keypress', (key) => {
    if (key.eventType === 'release')
      return
    key.preventDefault()
    key.stopPropagation()
    void app.key(normalizeKey(key)).catch((error) => {
      throw error
    })
  })
  const press = (name) => {
    if (name === 'escape')
      return ui.mockInput.pressEscape()
    if (name === 'enter')
      return ui.mockInput.pressEnter()
    if (name === 'tab')
      return ui.mockInput.pressTab()
    return ui.mockInput.pressKey(name)
  }
  const frame = async () => {
    app.update()
    await ui.renderOnce()
    return ui.captureCharFrame()
  }
  try {
    await run({
      app,
      ui,
      press,
      frame,
      exits,
      dir,
      settingsPath: join(dir, 'lazyapp', 'settings.json'),
    })
  }
  finally {
    await app.close()
    ui.renderer.destroy()
    if (previousXdg === undefined)
      delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousXdg
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Exact first-line span color for a token, as `r,g,b` — null when absent. */
function headerSpan(ui, token) {
  const line = ui.captureSpans().lines[0]
  const span = line.spans.find(candidate => candidate.text.trim() === token)
  return span ? [...span.fg.buffer].slice(0, 3).join(',') : null
}

/** Panel-title span color, as `r,g,b` — null when absent. */
function titleSpan(ui, token) {
  for (const line of ui.captureSpans().lines) {
    const span = line.spans.find(candidate => candidate.text.includes(token))
    if (span)
      return [...span.fg.buffer].slice(0, 3).join(',')
  }
  return null
}

const FOCUS = '122,162,247'
const MUTED = '108,115,144'

test('header shows the workspace root with a right-aligned zh/en chip and dirty marker', async () => {
  await fixture(
    async ({ app, frame, ui }) => {
      // macOS TMPDIR roots overflow a 100-column header, so widen until the root fits verbatim.
      ui.resize(stringWidth(app.state.root) + 40, 24)
      const header = (await frame()).split('\n')[0]
      expect(header).toContain(' LAZYAPP │ ')
      expect(header).toContain(app.state.root)
      expect(header.trimEnd().endsWith('zh en')).toBe(true)
      expect(header).not.toContain('●')
      expect(headerSpan(ui, 'LAZYAPP')).toBe(FOCUS)
      expect(headerSpan(ui, 'en')).toBe(FOCUS)
      expect(headerSpan(ui, 'zh')).toBe(MUTED)
      // Dirty drafts add the marker to the header only.
      app.focusPanel('form')
      app.state.editor.draft.name = 'Changed'
      expect((await frame()).split('\n')[0]).toContain(' ●')
    },
    100,
    24,
  )
  await fixture(
    async ({ frame }) => {
      const lines = (await frame()).split('\n')
      expect(lines[0]).toContain(' LAZYAPP │ ')
      expect(lines[0].trimEnd().endsWith('zh en')).toBe(true)
      const keysRow = lines.findIndex(line => line.includes('h/l panel'))
      expect(keysRow).toBeGreaterThan(0)
      expect(lines[keysRow - 1]).toContain('idle')
    },
    70,
    18,
  )
})

test('1/2/3 jump between panels with [n] Title (count) chrome and focus colors', async () => {
  await fixture(async ({ app, press, frame, ui }) => {
    expect(app.state.focus).toBe('list')
    press('1')
    expect(app.state.focus).toBe('nav')
    let out = await frame()
    expect(out).toContain('[1] Categories (7)')
    expect(titleSpan(ui, '[1] Categories')).toBe(FOCUS)
    expect(titleSpan(ui, '[2] App documents')).toBe(MUTED)
    press('2')
    expect(app.state.focus).toBe('list')
    out = await frame()
    expect(out).toContain('[2] App documents (1)')
    expect(titleSpan(ui, '[2] App documents')).toBe(FOCUS)
    press('3')
    expect(app.state.focus).toBe('form')
    expect(await frame()).toContain('[3] ')
    press('tab')
    expect(app.state.focus).toBe('nav')
  })
})

test('s enqueues a save job that streams into the status box', async () => {
  await fixture(async ({ app, press, frame }) => {
    app.focusPanel('form')
    app.state.editor.draft.name = 'Renamed'
    press('s')
    expect(app.state.jobs).toHaveLength(1)
    expect(app.state.jobs[0]).toMatchObject({ label: 'Saving app.json' })
    expect(['queued', 'running']).toContain(app.state.jobs[0].state)
    await app.inFlight
    expect(app.state.jobs[0].state).toBe('done')
    const out = await frame()
    expect(out).toContain('✓ Saving app.json')
    expect(out).toContain('exit 0')
    expect(out).toContain('idle')
    expect(app.state.documents.find(item => item.path === 'app.json').data.name).toBe('Renamed')
  })
})

test('a creates a new document for the focused category', async () => {
  await fixture(async ({ app, press, frame }) => {
    app.state.category = 3
    press('a')
    expect(app.state.modal).not.toBeNull()
    expect(app.state.modal.title).toBe('New service name')
    expect(await frame()).toContain('New service name')
    press('escape')
    expect(app.state.modal).toBeNull()
    expect(app.state.documents).toHaveLength(3)
  })
})

test('D opens the y/n delete confirmation and y/n drive it', async () => {
  await fixture(async ({ app, press, frame }) => {
    app.state.category = 3
    press('2')
    press('D')
    expect(app.state.modal).toMatchObject({ type: 'choice', yn: true })
    expect(app.state.modal.options).toEqual(['Cancel', 'Delete file'])
    expect(await frame()).toContain('Delete this one workspace file?')
    press('n')
    expect(app.state.modal).toBeNull()
    press('D')
    press('y')
    expect(app.state.modal).toBeNull()
    await app.inFlight
    expect(app.state.jobs.at(-1).label).toBe('Deleting services/alpha.json')
    expect(app.state.jobs.at(-1).state).toBe('done')
  })
})

test('a slow background job never drops j/k and x aborts it', async () => {
  await fixture(async ({ app, press, frame }) => {
    app.state.category = 3
    let release
    const pending = operation(
      app,
      'Slow task',
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    expect(app.state.jobs.at(-1)).toMatchObject({ state: 'running' })
    // Keys keep flowing while the job runs: the old busy gate would drop these.
    press('j')
    expect(app.state.selected).toBe(1)
    press('k')
    expect(app.state.selected).toBe(0)
    const out = await frame()
    expect(out).toContain('▶ Slow task')
    expect(out).toContain('1 active')
    press('x')
    expect(app.state.jobs.at(-1).state).toBe('canceled')
    expect(await frame()).toContain('⊘ Slow task')
    release()
    expect(await pending).toBe(false)
  })
})

test('q with active jobs asks y/n first; ctrl+c inside the flow cancels it', async () => {
  await fixture(async ({ app, press, ui, frame, exits }) => {
    let release
    const pending = operation(
      app,
      'Slow task',
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    press('q')
    expect(app.state.modal).toMatchObject({ type: 'choice', yn: true })
    expect(app.state.modal.title).toBe('Quit?')
    expect(await frame()).toContain('jobs still running: 1')
    ui.mockInput.pressCtrlC()
    expect(app.state.modal).toBeNull()
    expect(exits).toEqual([])
    press('q')
    press('y')
    expect(exits).toEqual([0])
    release()
    expect(await pending).toBe(true)
  })
})

test(': opens the two-row Settings popup, switches to Chinese, and persists', async () => {
  await fixture(async ({ app, press, frame, settingsPath }) => {
    press(':')
    expect(app.state.modal).toMatchObject({ type: 'settings', row: 0 })
    const english = await frame()
    expect(english).toContain('Settings')
    expect(english).toContain('Language: English')
    expect(english).toContain('Theme: Default')
    press('j')
    expect(app.state.modal.row).toBe(1)
    press('k')
    press('enter')
    await app.inFlight
    expect(app.state.language).toBe('zh')
    expect(existsSync(settingsPath)).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).language).toBe('zh')
    expect(await frame()).toContain('语言: 中文')
    press('escape')
    expect(app.state.modal).toBeNull()
    const chinese = await frame()
    expect(chinese).toContain('[1] 分类 (7)')
    expect(chinese).toContain('✓ Saving language preference')
    expect(chinese.split('\n')[0].trimEnd().endsWith('zh en')).toBe(true)
  })
})

test('L toggles the language instantly and persists it', async () => {
  await fixture(async ({ app, press, frame, settingsPath }) => {
    press('L')
    await app.inFlight
    expect(app.state.language).toBe('zh')
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).language).toBe('zh')
    expect(await frame()).toContain('[1] 分类 (7)')
    press('L')
    await app.inFlight
    expect(app.state.language).toBe('en')
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).language).toBe('en')
  })
})

test('every hint set ends with the settings and language chips in key-table order', () => {
  for (const language of ['en', 'zh']) {
    for (const id of [
      'nav',
      'list',
      'files',
      'doctor',
      'editor',
      'preview',
      'dialog-input',
      'dialog-choice',
      'dialog-confirm',
      'text-input',
      'settings',
    ]) {
      const chips = hintSegments(language, id)
      expect(chips.at(-2)).toEqual({
        key: ':',
        desc: language === 'zh' ? '设置' : 'settings',
      })
      expect(chips.at(-1)).toEqual({
        key: 'L',
        desc: language === 'zh' ? '语言' : 'language',
      })
    }
  }
  const list = hintSegments('en', 'list')
  expect(list.some(chip => chip.key === '1 2 3' && chip.desc === 'panels')).toBe(true)
  expect(
    hintSegments('zh', 'list').some(chip => chip.key === '1 2 3' && chip.desc === '面板'),
  ).toBe(true)
  const order = [
    'j/k',
    'h/l',
    'tab',
    '1 2 3',
    'g/G',
    'PgUp/PgDn',
    'enter',
    'esc',
    '/',
    '?',
    'r',
    'x',
    '[ ]',
  ]
  const positions = order.map(key => list.findIndex(chip => chip.key === key))
  expect(positions.every(index => index >= 0)).toBe(true)
  expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  const actions = ['a', 'D', 's', 'f', 'q']
  const actionPositions = actions.map(key => list.findIndex(chip => chip.key === key))
  expect(actionPositions.every(index => index > positions.at(-1))).toBe(true)
})

test.skipIf(!clipHelper)('y copies the focused field value through the platform clipboard', async () => {
  await fixture(async ({ app, press, frame }) => {
    app.state.category = 0
    app.state.selected = 0
    app.state.focus = 'form'
    app.state.editor = editDocument(app.state.documents[0])
    await frame()
    press('y')
    for (let attempt = 0; attempt < 50 && !existsSync(clipFile); attempt++)
      await new Promise(resolve => setTimeout(resolve, 20))
    expect(readFileSync(clipFile, 'utf8')).toBe('Demo')
    expect(app.state.error).toBe(false)
    expect(app.state.status).toContain('Copied')
    expect(app.state.status).toContain('App name')
  })
}, 30000)

test('a clipboard helper that cannot run is reported as a failure, not a silent success', async () => {
  const emptyBin = mkdtempSync(join(tmpdir(), 'lazyapp-empty-bin-'))
  const previousPath = process.env.PATH
  process.env.PATH = emptyBin
  try {
    await fixture(async ({ app, press, frame }) => {
      app.state.category = 0
      app.state.selected = 0
      app.state.focus = 'form'
      app.state.editor = editDocument(app.state.documents[0])
      await frame()
      press('y')
      for (let attempt = 0; attempt < 50 && !app.state.error; attempt++)
        await new Promise(resolve => setTimeout(resolve, 20))
      expect(app.state.error).toBe(true)
      expect(app.state.status).toContain('Clipboard copy failed')
      expect(app.state.editor.draft.name).toBe('Demo')
    })
  }
  finally {
    process.env.PATH = previousPath
    rmSync(emptyBin, { recursive: true, force: true })
  }
})
