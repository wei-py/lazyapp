import { RGBA } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { Application } from '../src/app/controller.js'
import { setTheme } from '../src/app/operations.js'
import { createView } from '../src/app/view.js'
import { expect, test } from '../support/node-test.js'
import { DEFAULT_THEME, themeColors } from '../vendor/lazy-kit/themes.js'

async function fixture(initialMode, run, theme = DEFAULT_THEME) {
  const ui = await createTestRenderer({
    width: 100,
    height: 24,
    exitOnCtrlC: false,
    exitSignals: [],
  })
  let detectedMode = initialMode
  // Simulate the public getter/event contract without private renderer state or stdin parsing.
  Object.defineProperty(ui.renderer, 'themeMode', {
    configurable: true,
    get: () => detectedMode,
  })
  const saved = []
  const view = createView(ui.renderer)
  const app = new Application('/theme-view-project', view, () => {}, {
    preferences: {
      load: async () => ({ language: 'en', theme }),
      save: async value => saved.push(structuredClone(value)),
    },
  })
  app.state.theme = theme
  const emitMode = (mode) => {
    detectedMode = mode
    ui.renderer.emit('theme_mode', mode)
  }
  const press = async (name) => {
    await app.key({ name, text: name.length === 1 ? name : undefined })
    await app.inFlight
  }
  try {
    app.update()
    await ui.renderOnce()
    await run({ ui, app, saved, emitMode, press })
  }
  finally {
    ui.renderer.destroy()
    await app.close()
  }
}

function spanFor(ui, text) {
  const span = ui.captureSpans().lines.flatMap(line => line.spans).find(candidate => candidate.text.includes(text))
  expect(span).toBeDefined()
  return span
}

function expectColor(actual, expected) {
  expect(actual.toInts()).toEqual(RGBA.fromHex(expected).toInts())
}

function expectPalette(ui, palette) {
  const header = spanFor(ui, 'LAZYAPP')
  expectColor(header.fg, palette.focus)
  expectColor(header.bg, palette.background)
  // This column is outside the inset panels, so it verifies the renderer's clear color.
  expectColor(ui.captureSpans().lines[1].spans[0].bg, palette.background)
}

for (const mode of ['light', 'dark', null]) {
  test(`the fixed default stays light in a ${mode ?? 'undetected'} terminal`, async () => {
    await fixture(mode, async ({ ui, app, saved, emitMode, press }) => {
      await press('?')
      await press('pagedown')
      const before = structuredClone(app.state)
      for (const detected of ['light', 'dark', null]) {
        emitMode(detected)
        await ui.renderOnce()
        expectPalette(ui, themeColors(DEFAULT_THEME))
        expect(app.state).toEqual(before)
      }
      expect(app.state.theme).toBe(DEFAULT_THEME)
      expect(saved).toEqual([])
    })
  })
}

test('late theme detection repaints the open modal and semantic status without mutating preferences', async () => {
  await fixture(null, async ({ ui, app, saved, emitMode, press }) => {
    app.state.error = true
    app.state.status = 'Theme status error'
    await press(':')
    await ui.renderOnce()
    expectPalette(ui, themeColors('auto', 'dark'))
    const stateBefore = structuredClone(app.state)

    emitMode('light')
    await ui.renderOnce()

    const palette = themeColors('auto', 'light')
    expectPalette(ui, palette)
    const modalText = spanFor(ui, 'Theme:')
    expectColor(modalText.fg, palette.text)
    expectColor(modalText.bg, palette.surface)
    const selected = spanFor(ui, 'Language:')
    expectColor(selected.fg, palette.selectionText)
    expectColor(selected.bg, palette.selection)
    expectColor(spanFor(ui, 'Error').fg, palette.error)
    expectColor(spanFor(ui, 'Theme status error').fg, palette.error)
    expect(app.state).toEqual(stateBefore)
    expect(saved).toEqual([])

    emitMode('dark')
    await ui.renderOnce()
    const dark = themeColors('auto', 'dark')
    expectPalette(ui, dark)
    expectColor(spanFor(ui, 'Theme:').bg, dark.surface)
    expectColor(spanFor(ui, 'Language:').bg, dark.selection)
    expect(app.state).toEqual(stateBefore)
    expect(saved).toEqual([])
  }, 'auto')
})

test('manual theme stays fixed while detection changes and Auto resumes the latest mode', async () => {
  await fixture('light', async ({ ui, app, saved, emitMode }) => {
    await setTheme(app, 'gruvbox-dark')
    await ui.renderOnce()
    expectPalette(ui, themeColors('gruvbox-dark'))
    const savedBefore = structuredClone(saved)

    emitMode('dark')
    await ui.renderOnce()
    expectPalette(ui, themeColors('gruvbox-dark'))
    expect(saved).toEqual(savedBefore)
    await setTheme(app, 'auto')
    await ui.renderOnce()
    expect(app.state.theme).toBe('auto')
    expectPalette(ui, themeColors('auto', 'dark'))

    await setTheme(app, 'gruvbox-dark')
    emitMode('light')
    await ui.renderOnce()
    expect(app.state.theme).toBe('gruvbox-dark')
    expectPalette(ui, themeColors('gruvbox-dark'))
    await setTheme(app, 'auto')
    await ui.renderOnce()
    expect(app.state.theme).toBe('auto')
    expectPalette(ui, themeColors('auto', 'light'))
    expect(saved).toEqual([
      { language: 'en', theme: 'gruvbox-dark' },
      { language: 'en', theme: 'auto' },
      { language: 'en', theme: 'gruvbox-dark' },
      { language: 'en', theme: 'auto' },
    ])
  })
})

test('selected file rows retain presence colors when focus and terminal mode change', async () => {
  await fixture('light', async ({ ui, app, emitMode }) => {
    const selectedSpan = (path, mode) => {
      const background = RGBA.fromHex(themeColors(DEFAULT_THEME, mode).selection).toInts().join(',')
      const span = ui.captureSpans().lines.flatMap(line => line.spans).find(candidate => candidate.text.includes(path) && candidate.bg.toInts().join(',') === background)
      expect(span).toBeDefined()
      return span
    }
    app.state.documents = [
      { path: 'app.json', kind: 'app', data: { schemaVersion: 1, name: 'Example', platforms: [], environments: [] }, missing: false },
      { path: 'assets/config.json', kind: 'assets', data: null, missing: true },
    ]
    await app.selectItem(1, 1, 0)
    await ui.renderOnce()
    expectColor(selectedSpan('assets/config.json', 'light').fg, themeColors(DEFAULT_THEME, 'light').error)
    app.focusPanel('form')
    emitMode('dark')
    await ui.renderOnce()
    expectColor(selectedSpan('assets/config.json', 'dark').fg, themeColors(DEFAULT_THEME, 'dark').error)
    await app.selectItem(0, 1, 0)
    await ui.renderOnce()
    expectColor(selectedSpan('app.json', 'dark').fg, themeColors(DEFAULT_THEME, 'dark').present)
  })
})
