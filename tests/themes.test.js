import { expect, test } from '../support/node-test.js'
import { DEFAULT_THEME, themeColors, THEMES } from '../vendor/lazy-kit/themes.js'

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(channel => Number.parseInt(channel, 16) / 255)
  const [red, green, blue] = channels.map(channel => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground, background) {
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

const textKeys = ['text', 'muted', 'focus', 'warning', 'error', 'present', 'aur', 'repo']

for (const mode of ['light', 'dark']) {
  test(`auto ${mode} keeps text and file statuses readable on panels, dialogs, and selected rows`, () => {
    const colors = themeColors(DEFAULT_THEME, mode)
    for (const background of ['background', 'surface', 'selection']) {
      for (const foreground of textKeys)
        expect(contrast(colors[foreground], colors[background])).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(7)
    expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(7)
    expect(contrast(colors.selectionText, colors.selection)).toBeGreaterThanOrEqual(7)
    expect(contrast(colors.border, colors.background)).toBeGreaterThanOrEqual(3)
    expect(contrast(colors.border, colors.surface)).toBeGreaterThanOrEqual(3)
  })
}

test('an existing default preference adapts to both terminal modes', () => {
  expect(luminance(themeColors('default', 'light').background)).toBeGreaterThan(0.8)
  expect(luminance(themeColors('default', 'dark').background)).toBeLessThan(0.1)
})

test('unknown themes follow detected mode and an unknown terminal gets a readable opaque fallback', () => {
  const dark = themeColors(DEFAULT_THEME, 'dark')
  const light = themeColors(DEFAULT_THEME, 'light')
  for (const id of [DEFAULT_THEME, 'removed-theme', undefined, null]) {
    expect(themeColors(id, 'light')).toEqual(light)
    expect(themeColors(id, 'dark')).toEqual(dark)
    expect(themeColors(id)).toEqual(dark)
    expect(themeColors(id, null)).toEqual(dark)
    expect(themeColors(id, 'unknown')).toEqual(dark)
    expect(contrast(themeColors(id).text, themeColors(id).background)).toBeGreaterThanOrEqual(7)
  }
})

test('manual palettes keep their chosen brightness regardless of terminal mode', () => {
  for (const theme of THEMES.filter(theme => theme.id !== DEFAULT_THEME)) {
    const inLightTerminal = themeColors(theme.id, 'light')
    const inDarkTerminal = themeColors(theme.id, 'dark')
    expect(inLightTerminal).toEqual(inDarkTerminal)
    const brightness = luminance(inLightTerminal.background)
    if (theme.id.endsWith('-light'))
      expect(brightness).toBeGreaterThan(0.7)
    else
      expect(brightness).toBeLessThan(0.1)
  }
})
