import { describe, expect, test } from 'bun:test'
import { Application } from '../src/app/controller.js'
import { closeModal, displayValue, editDocument, editText, isDirty, layoutMode, openModal } from '../src/app/state.js'

const APP = { schemaVersion: 1, name: 'Example', description: '', version: '1.0.0', platforms: [], environments: [] }
function application() {
  const exits = []
  const app = new Application('/tmp/fictional-lazyapp-ui', () => {}, code => exits.push(code))
  app.state.editor = editDocument({ path: 'app.json', kind: 'app', data: APP, revision: 'original' })
  app.state.focus = 'form'
  return { app, exits }
}
const press = (app, name, extra = {}) => app.key({ name, text: name.length === 1 ? name : undefined, ...extra })

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

  test('wizard stays in memory through final confirmation and cancellation', async () => {
    const { app, exits } = application()
    app.state.editor = null
    app.startWizard()
    expect(app.session).toBeUndefined()
    app.nextWizard()
    expect(app.state.editor.kind).toBe('assets')
    app.nextWizard()
    expect(app.state.modal.title).toContain('Final confirmation')
    expect(app.state.modal.options[app.state.modal.index]).toBe('Cancel')
    await press(app, 'return')
    expect(app.session).toBeUndefined()
    expect(app.state.wizard).not.toBeNull()
    app.requestQuit()
    await press(app, 'j')
    await press(app, 'return')
    expect(exits).toEqual([0])
    expect(app.session).toBeUndefined()
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
