import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Application } from '../src/app/controller.js'
import { closeModal, displayValue, editDocument, editText, isDirty, layoutMode, openModal } from '../src/app/state.js'
import { defaultInitialization } from '../src/config/initialization.js'
import { initializeWorkspace } from '../src/storage/workspace.js'

const APP = { schemaVersion: 1, name: 'Example', description: '', version: '1.0.0', platforms: [], environments: [] }
function application() {
  const exits = []
  const app = new Application('/tmp/fictional-lazyapp-ui', () => {}, code => exits.push(code))
  app.state.documents = [{ path: 'app.json', kind: 'app', data: APP, revision: 'original' }]
  app.state.editor = editDocument({ path: 'app.json', kind: 'app', data: APP, revision: 'original' })
  app.state.focus = 'form'
  return { app, exits }
}
const press = (app, name, extra = {}) => app.key({ name, text: name.length === 1 ? name : undefined, ...extra })

function serviceApplication() {
  const result = application()
  const { app } = result
  const documents = ['alpha', 'beta'].map(name => ({ path: `services/${name}.json`, kind: 'service', data: { schemaVersion: 1, name }, revision: 'original' }))
  app.state.documents.push(...documents)
  app.state.category = 3
  app.state.editor = null
  app.state.focus = 'list'
  app.session = {
    list: async () => app.state.documents.map(document => document.path),
    read: async (path) => {
      const document = app.state.documents.find(item => item.path === path)
      return { data: document?.data ?? null, revision: document?.revision ?? null }
    },
    save: async (path, data) => ({ data: structuredClone(data), revision: 'saved' }),
    permissionWarnings: async () => [],
  }
  return result
}

async function choose(app, label) {
  const index = app.state.modal.options.indexOf(label)
  expect(index).toBeGreaterThanOrEqual(0)
  for (let step = 0; step < index; step++) await press(app, 'j')
  await press(app, 'return')
}

describe('input ownership and draft transitions', () => {
  test('jq/? remain text and do not navigate, open help, or quit', async () => {
    const { app, exits } = application()
    await press(app, 'return')
    for (const character of 'jq/?') await press(app, character)
    expect(app.state.editor.draft.name).toBe('Examplejq/?')
    expect(app.state.category).toBe(0)
    expect(app.state.modal).toBeNull()
    expect(exits).toEqual([])
    await press(app, 'escape')
    expect(app.state.editor.draft).toEqual(APP)
    expect(isDirty(app.state.editor)).toBe(false)
  })

  test('canceling absent or non-normalized fields restores the exact snapshot', async () => {
    const { app } = application()
    app.state.editor = editDocument({ path: 'services/push.json', kind: 'service', data: { schemaVersion: 1, name: 'Push' }, revision: 'r' })
    app.state.editor.index = 1
    await press(app, 'return')
    await press(app, 'q')
    await press(app, 'escape')
    expect(Object.hasOwn(app.state.editor.draft, 'provider')).toBe(false)
    expect(isDirty(app.state.editor)).toBe(false)
    app.state.editor = editDocument({ path: 'app.json', kind: 'app', data: { ...APP, environments: [' custom '] }, revision: 'r' })
    app.state.editor.index = 4
    await press(app, 'return')
    await press(app, 'escape')
    expect(app.state.editor.draft.environments).toEqual([' custom '])
    expect(isDirty(app.state.editor)).toBe(false)
  })

  test('dirty quit defaults to cancel, captures modal input, and restores focus', async () => {
    const { app, exits } = application()
    app.state.editor.draft.name = 'Changed'
    await press(app, 'q')
    expect(app.state.modal.index).toBe(0)
    expect(app.state.focus).toBe('modal')
    await press(app, 'q')
    expect(exits).toEqual([])
    await press(app, 'return')
    expect(app.state.modal).toBeNull()
    expect(app.state.focus).toBe('form')
    expect(isDirty(app.state.editor)).toBe(true)
    await press(app, 'q')
    await press(app, 'j')
    await press(app, 'j')
    await press(app, 'return')
    expect(exits).toEqual([0])
  })

  test('failed save preserves draft and revision, successful retry clears dirty', async () => {
    const { app } = application()
    const draft = app.state.editor.draft
    draft.name = 'Retained'
    let failing = true
    app.session = {
      read: async () => ({ data: APP, revision: 'original' }),
      save: async (path, data) => {
        if (failing)
          throw Object.assign(new Error('fictional sensitive error'), { code: 'EACCES' })
        return { data, revision: 'saved' }
      },
    }
    expect(await app.save()).toBe(false)
    expect(isDirty(app.state.editor)).toBe(true)
    expect(app.state.editor.revision).toBe('original')
    expect(app.state.editor.draft.name).toBe('Retained')
    expect(app.state.status).not.toContain('fictional sensitive error')
    failing = false
    expect(await app.save()).toBe(true)
    expect(isDirty(app.state.editor)).toBe(false)
    expect(app.state.editor.revision).toBe('saved')
    expect(app.state.documents[0].data.name).toBe('Retained')
  })

  test('text editing operates on Unicode codepoints, including pasted shortcut characters', () => {
    expect(editText('中文', 1, { name: 'paste', text: 'jq/?' })).toEqual({ value: '中jq/?文', cursor: 5 })
    expect(editText('a😀b', 2, { name: 'backspace' })).toEqual({ value: 'ab', cursor: 1 })
  })

  test('read-only operations leave loading state even without custom success text', async () => {
    const { app } = application()
    let during
    await app.operation('Checking source file', async () => {
      during = app.state.status
    })
    expect(during).toContain('reading')
    expect(during).not.toContain('commit')
    expect(app.state.busy).toBeNull()
    expect(app.state.status).toBe('Checking source file: complete.')
  })

  test('dirty exit confirmation remains operable in a too-small terminal', async () => {
    const { app, exits } = application()
    app.state.width = 40
    app.state.height = 10
    app.state.editor.draft.name = 'Unsaved'
    await press(app, 'q')
    await press(app, 'j')
    await press(app, 'j')
    await press(app, 'return')
    expect(exits).toEqual([0])
  })

  test('modal focus falls back to list if its original editor disappeared', () => {
    const { app } = application()
    openModal(app.state, { type: 'choice', options: ['Cancel'] })
    app.state.editor = null
    closeModal(app.state)
    expect(app.state.focus).toBe('list')
  })

  test('all secret values remain masked and layout thresholds preserve state', () => {
    expect(displayValue({ type: 'secret' }, 'fictional-secret')).toBe('********')
    expect(layoutMode(100, 24)).toBe('dual')
    expect(layoutMode(99, 24)).toBe('single')
    expect(layoutMode(80, 16)).toBe('single')
    expect(layoutMode(100, 23)).toBe('small')
    expect(layoutMode(59, 40)).toBe('small')
  })
})

test('closing a preview modal restores the editor-free details panel', () => {
  const { app } = serviceApplication()
  app.state.editor = null
  app.state.files = ['credentials.p12']
  app.focusPanel('form')
  openModal(app.state, { type: 'choice', options: ['Close'] })
  closeModal(app.state)
  expect(app.state.focus).toBe('form')
  expect(app.state.editor).toBeNull()
})

describe('persistent three-panel navigation', () => {
  test('panel methods cycle in both directions and create the selected editor only once', () => {
    const { app } = serviceApplication()
    app.focusPanel('nav')
    expect(app.state.focus).toBe('nav')
    for (const focus of ['list', 'form', 'nav']) {
      app.cyclePanel(1)
      expect(app.state.focus).toBe(focus)
    }
    const editor = app.state.editor
    expect(editor.path).toBe(app.items()[app.state.selected].path)
    expect(editor.draft).not.toBe(app.items()[app.state.selected].data)
    editor.index = 2
    for (const focus of ['form', 'list', 'nav']) {
      app.cyclePanel(-1)
      expect(app.state.focus).toBe(focus)
    }
    for (const focus of ['list', 'form']) {
      app.focusPanel(focus)
      expect(app.state.focus).toBe(focus)
    }
    expect(app.state.editor).toBe(editor)
    expect(editor.index).toBe(2)
    app.state.editor = null
    app.state.documents = []
    app.focusPanel('form')
    expect(app.state.editor).toBeNull()
  })

  test('Tab, numbered jumps, vim keys, and arrows navigate panels without editing fields', async () => {
    const { app } = serviceApplication()
    for (const [name, extra, focus] of [
      ['tab', {}, 'form'],
      ['tab', {}, 'nav'],
      ['tab', {}, 'list'],
      ['tab', { shift: true }, 'nav'],
      ['tab', { shift: true }, 'form'],
      ['1', {}, 'nav'],
      ['2', {}, 'list'],
      ['3', {}, 'form'],
      ['l', {}, 'nav'],
      ['right', {}, 'list'],
      ['h', {}, 'nav'],
      ['left', {}, 'form'],
    ]) {
      await press(app, name, extra)
      expect(app.state.focus).toBe(focus)
      expect(app.state.modal).toBeNull()
    }
    expect(app.state.editor.index).toBe(0)
    expect(app.state.editor.editing).toBe(false)
  })

  test('Enter moves nav to list to details before it edits a document', async () => {
    const { app } = serviceApplication()
    app.focusPanel('nav')
    await press(app, 'return')
    expect(app.state.focus).toBe('list')
    expect(app.state.editor).toBeNull()
    await press(app, 'return')
    expect(app.state.focus).toBe('form')
    expect(app.state.editor.path).toBe('services/alpha.json')
    expect(app.state.editor.editing).toBe(false)
    await press(app, 'return')
    expect(app.state.editor.editing).toBe(true)
  })

  test('category and list movement immediately replace live targets without Enter', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    app.state.editor.index = 2
    app.focusPanel('list')
    await press(app, 'j')
    expect(app.state.selected).toBe(1)
    expect(app.items()[app.state.selected].path).toBe('services/beta.json')
    expect(app.state.editor).toBeNull()
    await press(app, 'return')
    expect(app.state.editor.path).toBe('services/beta.json')
    expect(app.state.editor.index).toBe(0)
    await press(app, '1')
    await press(app, 'k')
    expect(app.state.focus).toBe('nav')
    expect(app.state.category).toBe(2)
    expect(app.state.selected).toBe(0)
    expect(app.state.editor).toBeNull()
    expect(app.items()).toEqual([])
    await press(app, 'j')
    expect(app.items()[app.state.selected].path).toBe('services/alpha.json')
  })

  test('dirty drafts survive panel changes and cancel; discard applies the pending item only', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const editor = app.state.editor
    editor.draft.name = 'Unsaved alpha'
    editor.index = 3
    await press(app, 'escape')
    expect(app.state.focus).toBe('list')
    expect(app.state.modal).toBeNull()
    await press(app, 'return')
    expect(app.state.editor).toBe(editor)
    expect(editor.index).toBe(3)
    expect(editor.editing).toBe(false)
    await press(app, '2')
    app.state.detailScroll = 8
    await press(app, 'j')
    expect(app.state.modal.options[app.state.modal.index]).toBe('Cancel')
    expect(app.state.selected).toBe(0)
    expect(app.state.editor).toBe(editor)
    await choose(app, 'Cancel')
    expect(app.state.focus).toBe('list')
    expect(editor.draft.name).toBe('Unsaved alpha')
    expect(app.state.detailScroll).toBe(8)
    await press(app, 'j')
    await choose(app, 'Discard')
    expect(app.state.selected).toBe(1)
    expect(app.state.detailScroll).toBe(0)
    expect(app.state.editor).toBeNull()
    await press(app, '3')
    expect(app.state.editor.path).toBe('services/beta.json')
    expect(app.state.editor.draft.name).toBe('beta')
  })

  test('search from the categories panel focuses the list instead of leaving the workflow', async () => {
    const { app } = serviceApplication()
    app.focusPanel('nav')
    expect(app.state.editor).toBeNull()
    await press(app, '/')
    expect(app.state.focus).toBe('modal')
    expect(app.state.modal.title).toBe('Search document paths (secrets excluded)')
    await press(app, 'paste', { text: 'beta' })
    await press(app, 'return')
    expect(app.state.focus).toBe('list')
    expect(app.state.search).toBe('beta')
    expect(app.items().map(item => item.path)).toEqual(['services/beta.json'])
    await press(app, 'escape')
    expect(app.state.focus).toBe('nav')
    expect(app.state.search).toBe('beta')
  })

  test('cancelled category and search changes retain selected target and dirty draft', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const editor = app.state.editor
    editor.draft.name = 'Unsaved'
    await press(app, '1')
    await press(app, 'j')
    expect(app.state.category).toBe(3)
    await choose(app, 'Cancel')
    expect(app.state.category).toBe(3)
    expect(app.state.selected).toBe(0)
    expect(app.state.editor).toBe(editor)
    await press(app, '2')
    await press(app, '/')
    await press(app, 'paste', { text: 'beta' })
    await press(app, 'return')
    expect(app.state.modal.title).toBe('Unsaved changes')
    expect(app.state.search).toBe('')
    await choose(app, 'Cancel')
    expect(app.state.search).toBe('')
    expect(app.state.editor).toBe(editor)
    await press(app, '/')
    await press(app, 'paste', { text: 'beta' })
    await press(app, 'return')
    await choose(app, 'Discard')
    expect(app.state.search).toBe('beta')
    expect(app.items()[app.state.selected].path).toBe('services/beta.json')
    expect(app.state.editor).toBeNull()
  })

  test('confirmed new-document transitions cannot mutate the previous editor snapshot', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const previous = app.state.editor
    previous.draft.name = 'Retained alpha'
    app.newDocument('service', { name: 'gamma' })
    expect(app.state.modal.title).toBe('Unsaved changes')
    expect(previous.snapshot.name).toBe('alpha')
    expect(app.state.editor).toBe(previous)
    await choose(app, 'Cancel')
    expect(app.state.editor).toBe(previous)
    app.newDocument('service', { name: 'gamma' })
    await choose(app, 'Save')
    expect(app.state.documents.find(item => item.path === previous.path).data.name).toBe('Retained alpha')
    expect(app.state.editor.path).toBe('services/gamma.json')
    expect(isDirty(app.state.editor)).toBe(true)
    expect(app.state.selected).toBe(-1)
    expect(await app.save()).toBe(true)
    expect(app.items()[app.state.selected].path).toBe('services/gamma.json')
    expect(isDirty(app.state.editor)).toBe(false)
    expect(app.state.documents.find(item => item.path === previous.path).data.name).toBe('Retained alpha')
  })

  test('Save before changing items commits only the old target and constructs the new editor later', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    app.state.editor.draft.name = 'Changed alpha'
    await press(app, '2')
    await press(app, 'j')
    await choose(app, 'Save')
    expect(app.state.documents.find(item => item.path === 'services/alpha.json').data.name).toBe('Changed alpha')
    expect(app.state.editor).toBeNull()
    expect(app.items()[app.state.selected].path).toBe('services/beta.json')
    await press(app, '3')
    expect(app.state.editor.draft.name).toBe('beta')
  })

  test('digits and panel shortcuts remain literal in text and modal input', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    await press(app, 'return')
    for (const character of '123hlnrvdjq/?') await press(app, character)
    expect(app.state.editor.draft.name).toBe('alpha123hlnrvdjq/?')
    expect(app.state.focus).toBe('form')
    expect(app.state.modal).toBeNull()
    await press(app, 'return')
    await press(app, '2')
    await press(app, '/')
    for (const character of '123hlnrvdjq/?') await press(app, character)
    expect(app.state.modal.value).toBe('123hlnrvdjq/?')
    expect(app.state.focus).toBe('modal')
    await press(app, 'escape')
    expect(app.state.focus).toBe('list')
    expect(app.state.search).toBe('')
  })

  test('j/k clamp form fields, while file and Doctor details scroll independently', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    await press(app, 'k')
    expect(app.state.editor.index).toBe(0)
    await press(app, 'j')
    expect(app.state.editor.index).toBe(1)
    for (let index = 0; index < app.fields().length + 2; index++) await press(app, 'j')
    expect(app.state.editor.index).toBe(app.fields().length)
    expect(app.state.selected).toBe(0)
    app.state.editor = null
    app.state.files = ['credentials.p12', 'images/icon.png']
    await press(app, 'k')
    expect(app.state.detailScroll).toBe(0)
    await press(app, 'j')
    await press(app, 'pagedown')
    expect(app.state.detailScroll).toBe(9)
    expect(app.state.selected).toBe(0)
    await press(app, 'pageup')
    expect(app.state.detailScroll).toBe(1)
    app.focusPanel('list')
    await app.selectItem(1)
    expect(app.state.selected).toBe(1)
    expect(app.state.detailScroll).toBe(0)
    await press(app, 'return')
    expect(app.state.focus).toBe('form')
    expect(app.state.editor).toBeNull()
    expect(app.state.modal).toBeNull()
    await press(app, 'escape')
    await press(app, 'escape')
    expect(app.state.files).toBeNull()
    expect(app.state.selected).toBe(0)
    expect(app.state.focus).toBe('nav')
    app.state.category = 6
    app.state.doctorLoaded = true
    app.state.doctor = [{ status: 'pass', label: 'First' }, { status: 'missing', label: 'Second' }]
    app.state.detailScroll = 8
    await app.selectItem(1)
    expect(app.state.doctorIndex).toBe(1)
    expect(app.state.selected).toBe(0)
    expect(app.state.detailScroll).toBe(0)
    app.focusPanel('list')
    await press(app, 'return')
    expect(app.state.modal).toBeNull()
    await press(app, 'j')
    expect(app.state.detailScroll).toBe(1)
    expect(app.state.doctorIndex).toBe(1)
  })

  test('Escape steps back without discarding and only asks to quit at nav', async () => {
    const { app, exits } = serviceApplication()
    app.focusPanel('form')
    app.state.editor.draft.name = 'Unsaved'
    for (const focus of ['list', 'nav']) {
      await press(app, 'escape')
      expect(app.state.focus).toBe(focus)
      expect(app.state.modal).toBeNull()
      expect(exits).toEqual([])
    }
    await press(app, 'escape')
    expect(app.state.modal.options[app.state.modal.index]).toBe('Cancel')
    await choose(app, 'Cancel')
    expect(app.state.focus).toBe('nav')
    app.state.editor.draft = structuredClone(app.state.editor.snapshot)
    await press(app, 'escape')
    expect(exits).toEqual([0])
  })

  test('Doctor loads lazily once, clamps selection, and ignores stale generations', async () => {
    const { app } = serviceApplication()
    let reads = 0
    app.session.list = async () => {
      reads++
      return ['app.json']
    }
    app.state.doctorIndex = 20
    app.focusPanel('nav')
    await app.selectCategory(6)
    await app.inFlight
    expect(app.state.doctorLoaded).toBe(true)
    expect(app.state.doctorIndex).toBe(0)
    expect(app.state.doctor[0].status).toBe('pass')
    expect(reads).toBe(1)
    app.focusPanel('list')
    app.focusPanel('form')
    await app.selectCategory(5)
    await app.selectCategory(6)
    expect(reads).toBe(1)
    let release
    app.session.list = () => new Promise((resolve) => {
      release = resolve
    })
    const previous = app.state.doctor
    const pending = app.doctor()
    app.generation++
    release([])
    await pending
    expect(app.state.doctor).toBe(previous)
  })

  test('persistent editors do not capture list view, create, or reload actions', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const editor = app.state.editor
    await press(app, '2')
    await press(app, 'v')
    expect(app.state.modal).toBeNull()
    expect(app.state.focus).toBe('list')
    await press(app, 'n')
    expect(app.state.modal.title).toBe('New service name')
    await press(app, 'escape')
    expect(app.state.editor).toBe(editor)
    await press(app, 'r')
    expect(app.state.focus).toBe('list')
    expect(app.state.editor).toBeNull()
    expect(app.items()[app.state.selected].path).toBe('services/alpha.json')
    await press(app, '3')
    await press(app, 'n')
    await press(app, 'd')
    expect(app.state.modal).toBeNull()
    await press(app, 'v')
    expect(app.state.modal.detail).toBe('alpha')
  })

  test('a failed save blocks a pending target change and retains the draft', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const editor = app.state.editor
    editor.draft.name = 'Retain on failure'
    app.session.save = async () => {
      throw Object.assign(new Error('Access denied'), { code: 'EACCES' })
    }
    await press(app, '2')
    await press(app, 'j')
    await choose(app, 'Save')
    expect(app.state.selected).toBe(0)
    expect(app.state.editor).toBe(editor)
    expect(editor.draft.name).toBe('Retain on failure')
    expect(editor.revision).toBe('original')
    expect(app.state.error).toBe(true)
    expect(app.state.focus).toBe('list')
  })
})

async function withWorkspace(action) {
  const project = await fs.mkdtemp(join(tmpdir(), 'lazyapp-presence-'))
  const app = new Application(project, () => {}, () => {}, {
    preferences: { load: async () => ({ language: 'en' }), save: async () => {} },
  })
  try {
    const scaffold = defaultInitialization('Example')
    const session = await initializeWorkspace(project, scaffold.app, { examples: scaffold.examples })
    await session.close()
    await app.start()
    expect(app.state.error).toBe(false)
    await action(app, project)
  }
  finally {
    await app.close()
    await fs.rm(project, { recursive: true, force: true })
  }
}

describe('logical file presence', () => {
  test('missing config opens clean, saves a canonical document, and returns to missing after deletion or reload', async () => {
    await withWorkspace(async (app, project) => {
      expect(app.state.documents.find(item => item.path === 'app.json').missing).toBe(false)
      await app.selectCategory(4)
      const path = 'environments/development.json'
      app.state.selected = app.items().findIndex(item => item.path === path)
      const examplePath = join(project, 'lazyapp', `${path}.example`)
      const example = await fs.readFile(examplePath, 'utf8')
      expect(app.items()[app.state.selected]).toMatchObject({ path, missing: true, data: null, revision: null })
      await press(app, 'return')
      expect(app.state.editor.draft).toEqual({ schemaVersion: 1, name: 'development' })
      expect(isDirty(app.state.editor)).toBe(false)
      await press(app, '2')
      await press(app, 'j')
      expect(app.state.modal).toBeNull()
      app.state.selected = app.items().findIndex(item => item.path === path)
      await press(app, 'return')
      app.state.editor.draft.apiUrl = 'https://example.test'
      await press(app, 's', { ctrl: true })
      expect(app.state.error).toBe(false)
      expect(app.items().find(item => item.path === path).missing).toBe(false)
      expect(JSON.parse(await fs.readFile(join(project, 'lazyapp', path), 'utf8'))).toEqual({ schemaVersion: 1, name: 'development', apiUrl: 'https://example.test' })
      expect(await fs.readFile(examplePath, 'utf8')).toBe(example)
      await press(app, '2')
      await press(app, 'd')
      await choose(app, 'Delete file')
      expect(app.items().find(item => item.path === path).missing).toBe(true)
      await expect(fs.stat(join(project, 'lazyapp', path))).rejects.toMatchObject({ code: 'ENOENT' })
      await fs.writeFile(join(project, 'lazyapp', path), JSON.stringify({ schemaVersion: 1, name: 'development' }))
      await press(app, 'r')
      expect(app.items().find(item => item.path === path).missing).toBe(false)
      await press(app, 'return')
      await fs.unlink(join(project, 'lazyapp', path))
      await press(app, 'r')
      expect(app.state.editor.missing).toBe(true)
      expect(app.state.editor.revision).toBeNull()
      expect(isDirty(app.state.editor)).toBe(false)
      expect(app.items().find(item => item.path === path).missing).toBe(true)
    })
  })

  test('missing resource imports only after confirmation, coalesces its example, and deletion restores missing', async () => {
    await withWorkspace(async (app, project) => {
      const path = 'platforms/ios/development/certificate.p12'
      const source = join(project, 'certificate.p12')
      const bytes = new Uint8Array([0, 255, 11, 42])
      await fs.writeFile(source, bytes)
      await app.showFiles()
      app.state.selected = app.items().findIndex(item => item.path === path)
      expect(app.items()[app.state.selected].missing).toBe(true)
      const example = await fs.readFile(join(project, 'lazyapp', `${path}.example`), 'utf8')
      await press(app, 'return')
      expect(app.state.modal.title).toBe('Source file: absolute path')
      app.state.modal.value = source
      await press(app, 'return')
      expect(app.state.modal.detail).toContain(path)
      expect(app.state.modal.options[app.state.modal.index]).toBe('Cancel')
      await press(app, 'return')
      await expect(fs.stat(join(project, 'lazyapp', path))).rejects.toMatchObject({ code: 'ENOENT' })
      await press(app, 'return')
      app.state.modal.value = source
      await press(app, 'return')
      await choose(app, 'Copy file')
      expect(app.state.error).toBe(false)
      expect(app.items().filter(item => item.path === path)).toHaveLength(1)
      expect(app.items().find(item => item.path === path).missing).toBe(false)
      expect(new Uint8Array(await fs.readFile(join(project, 'lazyapp', path)))).toEqual(bytes)
      expect(await fs.readFile(join(project, 'lazyapp', `${path}.example`), 'utf8')).toBe(example)
      await press(app, 'd')
      await choose(app, 'Delete file')
      expect(app.items().find(item => item.path === path).missing).toBe(true)
      expect(new Uint8Array(await fs.readFile(source))).toEqual(bytes)
      await press(app, 'r')
      expect(app.items().find(item => item.path === path).missing).toBe(true)
    })
  })

  test('legacy generic credential instructions cannot be imported as a typed credential', async () => {
    await withWorkspace(async (app, project) => {
      const path = 'platforms/ios/development/credentials.example'
      await fs.writeFile(join(project, 'lazyapp', path), 'Instructions only')
      await app.showFiles()
      app.state.selected = app.items().findIndex(item => item.path === path.slice(0, -8))
      expect(app.items()[app.state.selected]).toMatchObject({ missing: true, instructionOnly: true })
      await press(app, 'return')
      expect(app.state.modal.type).toBe('choice')
      expect(app.state.modal.options).toEqual(['Close'])
      expect(app.state.modal.detail).toContain('no typed destination')
      await expect(fs.stat(join(project, 'lazyapp', path.slice(0, -8)))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
