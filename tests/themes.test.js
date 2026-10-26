import { expect, test } from '../support/node-test.js'
import { DEFAULT_THEME, isTheme, themeColors, themeName, THEMES } from '../vendor/lazy-kit/themes.js'

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
    const colors = themeColors('auto', mode)
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

test('Gruvbox Light is the fixed fallback and old generic preferences are not active aliases', () => {
  expect(DEFAULT_THEME).toBe('gruvbox-light')
  expect(isTheme('default')).toBe(false)
  expect(isTheme('auto')).toBe(true)
  const palette = themeColors(DEFAULT_THEME)
  for (const id of [DEFAULT_THEME, 'default', 'removed-theme', undefined, null]) {
    for (const mode of ['light', 'dark', 'unknown', null, undefined]) {
      expect(themeColors(id, mode)).toEqual(palette)
      expect(themeName(id)).toBe(themeName(DEFAULT_THEME))
    }
  }
  for (const background of ['background', 'surface', 'selection']) {
    for (const foreground of [...textKeys, 'selectionText'])
      expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5)
  }
})

test('explicit auto follows detected mode and uses opaque dark for unknown terminals', () => {
  expect(luminance(themeColors('auto', 'light').background)).toBeGreaterThan(0.8)
  expect(luminance(themeColors('auto', 'dark').background)).toBeLessThan(0.1)
  expect(themeColors('auto', 'unknown')).toEqual(themeColors('auto', 'dark'))
  expect(themeColors('auto', null)).toEqual(themeColors('auto', 'dark'))
})

test('manual palettes keep their chosen brightness regardless of terminal mode', () => {
  for (const theme of THEMES.filter(theme => theme.id !== 'auto')) {
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
