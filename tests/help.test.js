import stringWidth from 'string-width'
import { Application } from '../src/app/controller.js'
import { helpPage } from '../src/app/help.js'
import { editDocument } from '../src/app/state.js'
import { expect, test } from '../support/node-test.js'

async function press(app, name, extra = {}) {
  await app.key({ name, text: name.length === 1 ? name : undefined, ...extra })
}

function application() {
  const app = new Application('/fictional-help-workspace', () => {}, () => {}, {
    preferences: { load: async () => ({ language: 'en' }), save: async () => {} },
  })
  const document = { path: 'app.json', kind: 'app', data: { schemaVersion: 1, name: 'Original' } }
  app.state.documents = [document]
  app.state.target = document
  app.state.editor = editDocument(document)
  app.state.editor.draft.name = 'Unsaved 中文'
  app.state.focus = 'form'
  return app
}

for (const closing of ['escape', 'return', 'q', 'ctrl+c']) {
  test(`help captures workspace shortcuts and ${closing} restores the unchanged draft and focus`, async () => {
    const app = application()
    try {
      const editor = app.state.editor
      const target = app.activeItem()
      const groups = structuredClone(app.state.groups)
      await press(app, '?')
      expect(app.state.modal.type).toBe('help')
      expect(app.state.modal.section).toBe(0)
      expect(app.state.focus).toBe('modal')
      for (const name of ['a', 'D', 's', 'f', 'r', '/', '1', '0', ':', 'W'])
        await press(app, name)
      expect(app.state.modal.type).toBe('help')
      if (closing === 'ctrl+c')
        await press(app, 'c', { ctrl: true })
      else
        await press(app, closing)
      expect(app.state.modal).toBeNull()
      expect(app.state.focus).toBe('form')
      expect(app.state.editor).toBe(editor)
      expect(editor.draft.name).toBe('Unsaved 中文')
      expect(app.activeItem()).toBe(target)
      expect(app.state.groups).toEqual(groups)
      expect(app.state.jobs).toEqual([])
    }
    finally {
      await app.close()
    }
  })
}

for (const language of ['en', 'zh']) {
  test(`${language} help scrolls each category independently, clamps at edges, and survives resize`, async () => {
    const app = application()
    try {
      Object.assign(app.state, { language, width: 60, height: 16 })
      await press(app, '?')
      const modal = app.state.modal
      await press(app, 'pagedown')
      const navigationOffset = modal.scrolls[0]
      expect(navigationOffset).toBeGreaterThan(0)
      await press(app, 'right')
      expect(modal.section).toBe(1)
      expect(modal.scrolls[1]).toBe(0)
      await press(app, 'down')
      expect(modal.scrolls[1]).toBe(1)
      await press(app, 'left')
      expect(modal.scrolls[0]).toBe(navigationOffset)
      await press(app, '[')
      expect(modal.section).toBe(2)
      await press(app, 'end')
      const last = helpPage(app.state).maxScroll
      expect(modal.scrolls[2]).toBe(last)
      await press(app, 'down')
      expect(modal.scrolls[2]).toBe(last)
      for (const [width, height] of [[120, 40], [80, 24], [60, 16], [43, 12]]) {
        Object.assign(app.state, { width, height })
        const page = helpPage(app.state)
        expect(app.state.modal).toBe(modal)
        expect(modal.section).toBe(2)
        expect(modal.scrolls[2]).toBeLessThanOrEqual(page.maxScroll)
        expect(page.lines.every(line => stringWidth(line) <= page.width - (page.compact ? 0 : 2))).toBe(true)
        expect(page.lines.length).toBeLessThanOrEqual(page.height - (page.compact ? 1 : 2))
      }
      await press(app, 'home')
      await press(app, 'up')
      expect(modal.scrolls[2]).toBe(0)
      await press(app, 'escape')
      await press(app, '?')
      expect(app.state.modal.section).toBe(0)
      expect(app.state.modal.scrolls).toEqual([0, 0, 0])
    }
    finally {
      await app.close()
    }
  })
}

test('typing help and panel shortcuts stays literal, even below the normal layout minimum', async () => {
  const app = application()
  try {
    await press(app, 'e')
    Object.assign(app.state, { width: 40, height: 10 })
    const before = app.state.editor.input
    for (const character of '?123jq/')
      await press(app, character)
    expect(app.state.modal).toBeNull()
    expect(app.state.focus).toBe('form')
    expect(app.state.editor.input).toBe(`${before}?123jq/`)
    await press(app, 'escape')
    await press(app, '?')
    expect(app.state.modal.type).toBe('help')
    await press(app, 'right')
    expect(app.state.modal.section).toBe(1)
    await press(app, 'return')
    expect(app.state.focus).toBe('form')
  }
  finally {
    await app.close()
  }
})
