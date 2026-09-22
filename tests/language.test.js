import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Application } from '../src/app/controller.js'
import { CATEGORIES, editDocument, isDirty, preferenceItems } from '../src/app/state.js'
import { t } from '../src/config/i18n.js'
import { doctorLabel, runDoctor, safeErrorMessage } from '../src/features/workspace.js'
import { loadPreferences, savePreferences } from '../src/storage/preferences.js'
import { initializeWorkspace } from '../src/storage/workspace.js'

const APP = {
  schemaVersion: 1,
  name: 'English 中文',
  description: 'Cancel',
  platforms: [],
  environments: [],
  version: '1.0.0',
}
function press(app, name, extra = {}) {
  return app.key({ name, text: name.length === 1 ? name : undefined, ...extra })
}
let root
let apps
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'lazyapp-language-'))
  apps = []
})
afterEach(async () => {
  for (const app of apps) await app.close()
  await fs.rm(root, { recursive: true, force: true })
})
function application(preferences) {
  const options = { directory: join(root, 'preferences') }
  const app = new Application(
    join(root, 'project'),
    () => {},
    () => {},
    {
      preferences: preferences || {
        load: () => loadPreferences(options),
        save: value => savePreferences(value, options),
      },
    },
  )
  app.state.documents = [
    { path: 'app.json', kind: 'app', data: structuredClone(APP), revision: 'original' },
  ]
  apps.push(app)
  return app
}

describe('language settings interactions', () => {
  test('Settings Enter persists Chinese and restart loads it; switching back persists English', async () => {
    const app = application()
    await app.selectCategory(CATEGORIES.indexOf('Settings'))
    await press(app, 'return')
    app.state.settingsIndex = 0
    await press(app, 'return')
    expect(app.state.language).toBe('zh')
    expect(await loadPreferences({ directory: join(root, 'preferences') })).toEqual({
      language: 'zh',
      theme: 'default',
    })
    const reopened = application()
    await fs.mkdir(join(root, 'project'))
    const session = await initializeWorkspace(join(root, 'project'), APP)
    await session.close()
    await reopened.start()
    expect(reopened.state.language).toBe('zh')
    expect(reopened.state.modal).toBeNull()
    expect(reopened.state.error).toBe(false)
    expect(reopened.state.status).toMatch(/[\u3400-\u9FFF]/u)
    await app.setLanguage('en')
    expect(app.state.language).toBe('en')
    expect(await loadPreferences({ directory: join(root, 'preferences') })).toEqual({
      language: 'en',
      theme: 'default',
    })
  })

  test('theme rows apply and persist a palette without touching language', async () => {
    const app = application()
    await app.selectCategory(CATEGORIES.indexOf('Settings'))
    app.state.settingsIndex = preferenceItems().findIndex(
      item => item.kind === 'theme' && item.id === 'gruvbox-dark',
    )
    await press(app, 'return')
    expect(app.state.theme).toBe('gruvbox-dark')
    expect(app.state.language).toBe('en')
    expect(await loadPreferences({ directory: join(root, 'preferences') })).toEqual({
      language: 'en',
      theme: 'gruvbox-dark',
    })
  })

  test('missing workspace reports a localized error without an initialization dialog or writes', async () => {
    const app = application({ load: async () => ({ language: 'zh' }), save: async () => {} })
    await fs.mkdir(join(root, 'project'))
    await app.start()
    expect(app.state.modal).toBeNull()
    expect(app.state.error).toBe(true)
    expect(app.state.status).toContain('工作区不存在')
    expect(await fs.readdir(join(root, 'project'))).toEqual([])
    expect(t('en', 'No lazyapp workspace found. Create one? (y/N): ')).toBe(
      'No lazyapp workspace found. Create one? (y/N): ',
    )
    expect(t('zh', 'No lazyapp workspace found. Create one? (y/N): ')).toContain('创建')
  })

  test('language changes preserve draft identity, user text, paths, and field keys', async () => {
    const app = application()
    const editor = editDocument(app.state.documents[0])
    editor.draft.name = 'Save 取消 / English'
    app.state.editor = editor
    app.state.focus = 'form'
    const keys = app.fields().map(field => field.key)
    const english = app.fields().map(field => field.label)
    await app.setLanguage('zh')
    expect(app.state.editor).toBe(editor)
    expect(editor.draft.name).toBe('Save 取消 / English')
    expect(editor.draft.description).toBe('Cancel')
    expect(editor.path).toBe('app.json')
    expect(isDirty(editor)).toBe(true)
    expect(app.fields().map(field => field.key)).toEqual(keys)
    expect(app.fields().map(field => field.label)).not.toEqual(english)
    await app.setLanguage('en')
    expect(app.fields().map(field => field.label)).toEqual(english)
  })

  test('write failure leaves language and dirty draft intact and redacts raw errors', async () => {
    const app = application({
      load: async () => ({ language: 'en' }),
      save: async () => {
        throw Object.assign(new Error('fictional-private-secret'), { code: 'EACCES' })
      },
    })
    const editor = editDocument(app.state.documents[0])
    editor.draft.name = 'Unsaved'
    app.state.editor = editor
    await app.setLanguage('zh')
    expect(app.state.language).toBe('en')
    expect(app.state.error).toBe(true)
    expect(app.state.editor).toBe(editor)
    expect(isDirty(editor)).toBe(true)
    expect(app.state.status).not.toContain('fictional-private-secret')
  })

  test('preference failure does not hide a simultaneous workspace failure', async () => {
    const app = application({
      load: async () => {
        throw Object.assign(new Error('bad preferences'), { code: 'PREFERENCES_INVALID' })
      },
      save: async () => {},
    })
    await fs.mkdir(join(root, 'project', '.lazyapp'), { recursive: true })
    await fs.writeFile(join(root, 'project', '.lazyapp', 'app.json'), '{broken')
    await app.start()
    expect(app.state.error).toBe(true)
    expect(app.state.status).toContain('malformed JSON')
    expect(app.state.status).not.toContain('bad preferences')
  })

  test('canceling dirty transition to Settings keeps category and draft unchanged', async () => {
    const app = application()
    app.state.editor = editDocument(app.state.documents[0])
    app.state.editor.draft.name = 'Unsaved'
    await app.selectCategory(CATEGORIES.indexOf('Settings'))
    expect(app.state.modal).not.toBeNull()
    expect(app.state.modal.index).toBe(0)
    await press(app, 'escape')
    expect(app.state.category).toBe(0)
    expect(app.state.editor.draft.name).toBe('Unsaved')
    expect(app.state.language).toBe('en')
  })

  test('Settings blocks workspace creation and deletion shortcuts', async () => {
    const app = application()
    await app.selectCategory(CATEGORIES.indexOf('Settings'))
    await press(app, 'return')
    for (const name of ['n', 'd', '/', 'f', 'r']) {
      await press(app, name)
      expect(app.state.modal).toBeNull()
      expect(app.state.editor).toBeNull()
      expect(app.state.category).toBe(CATEGORIES.indexOf('Settings'))
    }
  })

  test('Doctor labels can change language without another read or leaking credential values', async () => {
    let reads = 0
    const documents = {
      'app.json': APP,
      'services/push.json': { schemaVersion: 1, name: 'Cancel', token: 'fictional-private-token' },
    }
    const report = await runDoctor({
      list: async () => Object.keys(documents),
      read: async (path) => {
        reads++
        return { data: documents[path], revision: 'original' }
      },
      permissionWarnings: async () => [],
    })
    const previousReads = reads
    const chinese = report.map(item => doctorLabel(item, 'zh'))
    expect(chinese.some(label => /[\u3400-\u9FFF]/u.test(label))).toBe(true)
    expect(JSON.stringify(chinese)).not.toContain('fictional-private-token')
    expect(report.map(item => doctorLabel(item, 'en'))).toEqual(report.map(item => item.label))
    expect(reads).toBe(previousReads)
    expect(report.some(item => item.status === 'unchecked')).toBe(true)
  })

  test('template parameters remain literal and unknown exception text never becomes translated UI', () => {
    expect(t('zh', 'Path: {path}', { path: 'services/Cancel-{label}.json' })).toBe(
      '路径：services/Cancel-{label}.json',
    )
    const error = Object.assign(new Error('fictional-private-token'), { code: 'UNKNOWN' })
    expect(safeErrorMessage(error, 'zh')).toMatch(/[\u3400-\u9FFF]/u)
    expect(safeErrorMessage(error, 'zh')).not.toContain('fictional-private-token')
  })
})
