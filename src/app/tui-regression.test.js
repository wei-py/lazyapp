import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { expect, test } from '../../support/node-test.js'
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
    expect(out).toContain('Saved app.json')
    expect(app.state.documents.find(item => item.path === 'app.json').data.name).toBe('Renamed')
  })
})

test('a creates a new document for the focused category', async () => {
  await fixture(async ({ app, press, frame }) => {
    app.selectCategory(3)
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
    app.selectCategory(3)
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
    app.selectCategory(3)
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
    press('return')
    expect(app.state.modal).toBeNull()
    expect(exits).toEqual([])
    expect(app.state.jobs.at(-1).state).toBe('running')
    press('q')
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
    expect(chinese).toContain('✓ Saving language preference')
  })
})

test('L toggles the language instantly and persists it', async () => {
  await fixture(async ({ app, press, settingsPath }) => {
    press('L')
    await app.inFlight
    expect(app.state.language).toBe('zh')
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).language).toBe('zh')
    press('L')
    await app.inFlight
    expect(app.state.language).toBe('en')
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).language).toBe('en')
  })
})

test('y copies the focused field value through the platform clipboard', { skip: !clipHelper, timeout: 30000 }, async () => {
  await fixture(async ({ app, press, frame }) => {
    app.state.category = 0
    app.state.selected = 0
    app.state.focus = 'form'
    app.state.editor = editDocument(app.state.documents[0])
    await frame()
    press('y')
    let copied = false
    for (let attempt = 0; attempt < 250; attempt++) {
      copied = existsSync(clipFile) && readFileSync(clipFile, 'utf8') === 'Demo'
      if (copied)
        break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(copied).toBe(true)
    expect(app.state.error).toBe(false)
    expect(app.state.status).toContain('Copied')
    expect(app.state.status).toContain('App name')
  })
})

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
