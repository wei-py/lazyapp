import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Application } from '../src/app/controller.js'
import { newDocument, save } from '../src/app/documents.js'
import { showFiles } from '../src/app/files.js'
import { doctor, operation, start } from '../src/app/operations.js'
import {
  closeModal,
  displayValue,
  editDocument,
  isDirty,
  layoutMode,
  openModal,
} from '../src/app/state.js'
import { defaultInitialization } from '../src/config/initialization.js'
import { initializeWorkspace } from '../src/storage/workspace.js'
import { describe, expect, test } from '../support/node-test.js'
import { applyTextKey } from '../vendor/lazy-kit/keys.js'

const APP = {
  schemaVersion: 1,
  name: 'Example',
  description: '',
  version: '1.0.0',
  platforms: [],
  environments: [],
}
function application() {
  const exits = []
  const app = new Application(
    '/tmp/fictional-lazyapp-ui',
    () => {},
    code => exits.push(code),
  )
  app.state.documents = [{ path: 'app.json', kind: 'app', data: APP, revision: 'original' }]
  app.state.editor = editDocument({
    path: 'app.json',
    kind: 'app',
    data: APP,
    revision: 'original',
  })
  app.state.focus = 'form'
  return { app, exits }
}
async function press(app, name, extra = {}) {
  await app.key({ name, text: name.length === 1 ? name : undefined, ...extra })
  if (app.inFlight)
    await app.inFlight
}

function serviceApplication() {
  const result = application()
  const { app } = result
  const documents = ['alpha', 'beta'].map(name => ({
    path: `services/${name}.json`,
    kind: 'service',
    data: { schemaVersion: 1, name },
    revision: 'original',
  }))
  app.state.documents.push(...documents)
  app.state.editor = null
  app.locateDocument(documents[0])
  app.focusPanel('group3')
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
    await press(app, 'e')
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
    app.state.editor = editDocument({
      path: 'services/push.json',
      kind: 'service',
      data: { schemaVersion: 1, name: 'Push' },
      revision: 'r',
    })
    app.state.editor.index = 1
    await press(app, 'return')
    await press(app, 'q')
    await press(app, 'escape')
    expect(Object.hasOwn(app.state.editor.draft, 'provider')).toBe(false)
    expect(isDirty(app.state.editor)).toBe(false)
    app.state.editor = editDocument({
      path: 'app.json',
      kind: 'app',
      data: { ...APP, environments: [' custom '] },
      revision: 'r',
    })
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
    expect(await save(app)).toBe(false)
    expect(isDirty(app.state.editor)).toBe(true)
    expect(app.state.editor.revision).toBe('original')
    expect(app.state.editor.draft.name).toBe('Retained')
    expect(app.state.status).not.toContain('fictional sensitive error')
    failing = false
    expect(await save(app)).toBe(true)
    expect(isDirty(app.state.editor)).toBe(false)
    expect(app.state.editor.revision).toBe('saved')
    expect(app.state.documents[0].data.name).toBe('Retained')
  })

  test('text input inserts printables, deletes by grapheme, and owns submit/cancel', () => {
    expect(applyTextKey({ name: 'paste', text: 'jq/?' }, '中文', 1)).toEqual({
      value: '中jq/?文',
      cursor: 5,
      submit: false,
      cancel: false,
    })
    expect(applyTextKey({ name: 'backspace' }, 'a😀b', 3)).toEqual({
      value: 'ab',
      cursor: 1,
      submit: false,
      cancel: false,
    })
    expect(applyTextKey({ name: 'u', ctrl: true }, 'text', 4)).toMatchObject({
      value: '',
      cursor: 0,
    })
    expect(applyTextKey({ name: 'enter' }, 'text', 4)).toMatchObject({ submit: true })
    expect(applyTextKey({ name: 'escape' }, 'text', 4)).toMatchObject({ cancel: true })
  })

  test('operations run as background jobs without status churn or input gating', async () => {
    const { app } = application()
    const before = app.state.status
    let during
    const pending = operation(app, 'Checking source file', async () => {
      during = app.state.status
    })
    expect(during).toBe(before)
    expect(app.state.jobs).toHaveLength(1)
    expect(app.state.jobs[0]).toMatchObject({ label: 'Checking source file', state: 'running' })
    expect(await pending).toBe(true)
    expect(app.state.jobs[0].state).toBe('done')
    expect(app.state.busy).toBeUndefined()
    expect(app.state.status).toBe(before)
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

  test('modal focus returns to the remembered navigation group when its editor disappeared', () => {
    const { app } = application()
    openModal(app.state, { type: 'choice', options: ['Cancel'] })
    app.state.editor = null
    closeModal(app.state)
    expect(app.state.focus).toBe('group1')
  })

  test('all secret values remain masked and layout thresholds preserve state', () => {
    expect(displayValue({ type: 'secret' }, 'fictional-secret')).toBe('********')
    expect(layoutMode(100, 24)).toBe('dual')
    expect(layoutMode(99, 24)).toBe('single')
    expect(layoutMode(80, 16)).toBe('single')
    expect(layoutMode(100, 23)).toBe('single')
    expect(layoutMode(59, 40)).toBe('small')
  })
})

test('closing a preview modal restores the editor-free details panel', () => {
  const { app } = serviceApplication()
  app.state.editor = null
  app.state.managedFiles = ['credentials.p12']
  app.state.activeGroup = 4
  app.state.activeTab = 0
  app.state.target = null
  app.focusPanel('form')
  openModal(app.state, { type: 'choice', options: ['Close'] })
  closeModal(app.state)
  expect(app.state.focus).toBe('form')
  expect(app.state.editor).toBeNull()
})

describe('grouped workspace navigation', () => {
  test('focusing other groups preserves the editing target and its dirty draft', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const editor = app.state.editor
    editor.draft.name = 'Unsaved alpha'
    editor.index = 3
    for (const key of ['1', '2', '4', '0', 'tab', 'tab']) {
      await press(app, key)
      expect(app.state.editor).toBe(editor)
      expect(app.activeItem().path).toBe('services/alpha.json')
      expect(app.state.modal).toBeNull()
    }
    await press(app, '3')
    await press(app, 'j')
    expect(app.state.modal.options[app.state.modal.index]).toBe('Cancel')
    await choose(app, 'Cancel')
    expect(editor.draft.name).toBe('Unsaved alpha')
    expect(editor.index).toBe(3)
    expect(app.activeItem().path).toBe('services/alpha.json')
    await press(app, 'j')
    await choose(app, 'Discard')
    expect(app.activeItem().path).toBe('services/beta.json')
    await press(app, 'return')
    expect(app.state.editor.draft.name).toBe('beta')
  })

  test('save before a target change commits only the old document, and failures block the change', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const editor = app.state.editor
    editor.draft.name = 'Changed alpha'
    app.session.save = async () => {
      throw Object.assign(new Error('Denied'), { code: 'EACCES' })
    }
    await press(app, '3')
    await press(app, 'j')
    await choose(app, 'Save')
    expect(app.state.editor).toBe(editor)
    expect(app.activeItem().path).toBe('services/alpha.json')
    expect(editor.revision).toBe('original')
    app.session.save = async (path, data) => ({ data: structuredClone(data), revision: 'saved' })
    await press(app, 'j')
    await choose(app, 'Save')
    expect(app.state.documents.find(doc => doc.path === 'services/alpha.json').data.name).toBe('Changed alpha')
    expect(app.activeItem().path).toBe('services/beta.json')
    await press(app, 'return')
    expect(app.state.editor.draft.name).toBe('beta')
  })

  test('platform expansion does not replace a dirty target, but choosing its document does', async () => {
    const { app } = serviceApplication()
    app.state.documents.push({ path: 'platforms/harmony/config.json', kind: 'harmony', data: null, missing: true, revision: null })
    app.focusPanel('form')
    app.state.editor.draft.name = 'Retained'
    await press(app, '2')
    await press(app, 'return')
    expect(app.state.expanded).toContain('harmony')
    expect(app.state.modal).toBeNull()
    expect(app.activeItem().path).toBe('services/alpha.json')
    await press(app, 'j')
    await choose(app, 'Cancel')
    expect(app.state.editor.draft.name).toBe('Retained')
    await press(app, 'j')
    await choose(app, 'Discard')
    await press(app, 'return')
    expect(app.state.editor.path).toBe('platforms/harmony/config.json')
    expect(isDirty(app.state.editor)).toBe(false)
    await press(app, '2')
    await press(app, 'h')
    await press(app, 'D')
    expect(app.state.modal).toBeNull()
    expect(app.state.editor.path).toBe('platforms/harmony/config.json')
  })

  test('tab selection remembers each list position and cancellation preserves the old tab', async () => {
    const { app } = serviceApplication()
    app.state.documents.push({ path: 'environments/preview.json', kind: 'environment', data: { schemaVersion: 1, name: 'preview' }, revision: 'original' })
    await press(app, 'j')
    expect(app.activeItem().path).toBe('services/beta.json')
    await press(app, ']')
    expect(app.activeItem().path).toBe('environments/preview.json')
    await press(app, '[')
    expect(app.activeItem().path).toBe('services/beta.json')
    await press(app, 'return')
    app.state.editor.draft.name = 'Dirty beta'
    await press(app, '3')
    await press(app, ']')
    await choose(app, 'Cancel')
    expect(app.state.groups[2].tab).toBe(0)
    expect(app.activeItem().path).toBe('services/beta.json')
  })

  test('search cancellation restores the filter without replacing a dirty draft', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const editor = app.state.editor
    editor.draft.name = 'Unsaved'
    await press(app, '3')
    await press(app, '/')
    await press(app, 'paste', { text: 'beta' })
    await press(app, 'return')
    await choose(app, 'Cancel')
    expect(app.state.groups[2].searches[0]).toBe('')
    expect(app.state.editor).toBe(editor)
    await press(app, '/')
    await press(app, 'paste', { text: 'beta' })
    await press(app, 'return')
    await choose(app, 'Discard')
    expect(app.items().map(item => item.path)).toEqual(['services/beta.json'])
    expect(app.activeItem().path).toBe('services/beta.json')
  })

  test('digits, brackets and navigation letters remain literal during field and search input', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    await press(app, 'e')
    for (const character of '01234[]hlnrvdjq/?') await press(app, character)
    expect(app.state.editor.draft.name).toBe('alpha01234[]hlnrvdjq/?')
    await press(app, 'escape')
    await press(app, '3')
    await press(app, '/')
    for (const character of '01234[]hlnrvdjq/?') await press(app, character)
    expect(app.state.modal.value).toBe('01234[]hlnrvdjq/?')
    await press(app, 'escape')
    expect(app.state.focus).toBe('group3')
    expect(app.state.groups[2].searches[0]).toBe('')
  })

  test('creating a new target cannot mutate the previous snapshot', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    const previous = app.state.editor
    previous.draft.name = 'Retained alpha'
    newDocument(app, 'service', { name: 'gamma' })
    await choose(app, 'Cancel')
    expect(app.state.editor).toBe(previous)
    expect(previous.snapshot.name).toBe('alpha')
    newDocument(app, 'service', { name: 'gamma' })
    await choose(app, 'Save')
    expect(app.state.documents.find(doc => doc.path === previous.path).data.name).toBe('Retained alpha')
    expect(app.state.editor.path).toBe('services/gamma.json')
    expect(await save(app)).toBe(true)
    expect(app.activeItem().path).toBe('services/gamma.json')
    expect(isDirty(app.state.editor)).toBe(false)
  })

  test('Enter on the final editor row commits the draft', async () => {
    const { app } = serviceApplication()
    app.focusPanel('form')
    app.state.editor.draft.name = 'Saved from final row'
    await press(app, 'G')
    await press(app, 'return')
    expect(app.state.documents.find(doc => doc.path === 'services/alpha.json').data.name).toBe('Saved from final row')
    expect(isDirty(app.state.editor)).toBe(false)
  })

  test('Doctor loads lazily and ignores stale async results', async () => {
    const { app } = serviceApplication()
    await app.selectCategory(6)
    await app.inFlight
    expect(app.state.doctorLoaded).toBe(true)
    expect(app.state.doctor[0].status).toBe('pass')
    let release
    app.session.list = () => new Promise((resolve) => {
      release = resolve
    })
    const previous = app.state.doctor
    const pending = doctor(app)
    app.generation++
    release([])
    await pending
    expect(app.state.doctor).toBe(previous)
  })
})

async function withWorkspace(action) {
  const project = await fs.mkdtemp(join(tmpdir(), 'lazyapp-presence-'))
  const app = new Application(
    project,
    () => {},
    () => {},
    {
      preferences: { load: async () => ({ language: 'en' }), save: async () => {} },
    },
  )
  try {
    const scaffold = defaultInitialization('Example')
    const session = await initializeWorkspace(project, scaffold.app, {
      examples: scaffold.examples,
    })
    await session.close()
    await start(app)
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
      await app.selectItem(app.items().findIndex(item => item.path === path), 3, 1)
      const examplePath = join(project, '.lazyapp', `${path}.example`)
      const example = await fs.readFile(examplePath, 'utf8')
      expect(app.items()[app.state.selected]).toMatchObject({
        path,
        missing: true,
        data: null,
        revision: null,
      })
      await press(app, 'return')
      expect(app.state.editor.draft).toEqual({ schemaVersion: 1, name: 'development' })
      expect(isDirty(app.state.editor)).toBe(false)
      await press(app, '3')
      await press(app, 'j')
      expect(app.state.modal).toBeNull()
      await app.selectItem(app.items().findIndex(item => item.path === path), 3, 1)
      await press(app, 'return')
      app.state.editor.draft.apiUrl = 'https://example.test'
      await press(app, 's')
      expect(app.state.error).toBe(false)
      expect(app.items().find(item => item.path === path).missing).toBe(false)
      expect(JSON.parse(await fs.readFile(join(project, '.lazyapp', path), 'utf8'))).toEqual({
        schemaVersion: 1,
        name: 'development',
        apiUrl: 'https://example.test',
      })
      expect(await fs.readFile(examplePath, 'utf8')).toBe(example)
      await press(app, '3')
      await press(app, 'D')
      await choose(app, 'Delete file')
      expect(app.items().find(item => item.path === path).missing).toBe(true)
      await expect(fs.stat(join(project, '.lazyapp', path))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await fs.writeFile(
        join(project, '.lazyapp', path),
        JSON.stringify({ schemaVersion: 1, name: 'development' }),
      )
      await press(app, 'r')
      expect(app.items().find(item => item.path === path).missing).toBe(false)
      await press(app, 'return')
      await fs.unlink(join(project, '.lazyapp', path))
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
      await showFiles(app)
      await app.selectItem(app.items().findIndex(item => item.path === path), 4, 0)
      expect(app.items()[app.state.selected].missing).toBe(true)
      const example = await fs.readFile(join(project, '.lazyapp', `${path}.example`), 'utf8')
      await press(app, 'return')
      expect(app.state.modal.title).toBe('Source file: absolute path')
      app.state.modal.value = source
      await press(app, 'return')
      expect(app.state.modal.detail).toContain(path)
      expect(app.state.modal.options[app.state.modal.index]).toBe('Cancel')
      await press(app, 'return')
      await expect(fs.stat(join(project, '.lazyapp', path))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await press(app, 'return')
      app.state.modal.value = source
      await press(app, 'return')
      await choose(app, 'Copy file')
      expect(app.state.error).toBe(false)
      expect(app.items().filter(item => item.path === path)).toHaveLength(1)
      expect(app.items().find(item => item.path === path).missing).toBe(false)
      expect(new Uint8Array(await fs.readFile(join(project, '.lazyapp', path)))).toEqual(bytes)
      expect(await fs.readFile(join(project, '.lazyapp', `${path}.example`), 'utf8')).toBe(example)
      await press(app, 'D')
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
      await fs.writeFile(join(project, '.lazyapp', path), 'Instructions only')
      await showFiles(app)
      await app.selectItem(app.items().findIndex(item => item.path === path.slice(0, -8)), 4, 0)
      expect(app.items()[app.state.selected]).toMatchObject({
        missing: true,
        instructionOnly: true,
      })
      await press(app, 'return')
      expect(app.state.modal.type).toBe('choice')
      expect(app.state.modal.options).toEqual(['Close'])
      expect(app.state.modal.detail).toContain('no typed destination')
      await expect(fs.stat(join(project, '.lazyapp', path.slice(0, -8)))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    })
  })
})
