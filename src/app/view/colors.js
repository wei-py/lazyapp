import { DEFAULT_THEME, themeColors } from '../../config/themes.js'

// One view per process; render swaps the palette in place before drawing.
export const COLORS = { ...themeColors(DEFAULT_THEME) }

export function setTheme(id) {
  Object.assign(COLORS, themeColors(id))
}
