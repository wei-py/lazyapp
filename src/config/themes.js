/**
 * Terminal palettes. Four popular families (Gruvbox, Catppuccin, Tokyo Night,
 * Solarized), each shipped dark and light, plus the built-in default look.
 * `background: null` paints nothing so the terminal shows through (lazyaur's
 * default look); `surface` fills dialogs so they stay readable over panels.
 * Every palette carries the same semantic keys so the view never branches on theme.
 */
export const THEMES = [
  {
    id: 'default',
    name: 'Default',
    colors: {
      background: null,
      surface: '#1f2438',
      text: '#c0caf5',
      muted: '#6c7390',
      border: '#3c4361',
      focus: '#7aa2f7',
      selection: '#2c3550',
      selectionText: '#c0caf5',
      warning: '#e0af68',
      error: '#f7768e',
      present: '#9ece6a',
    },
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    colors: {
      background: '#282828',
      surface: '#282828',
      text: '#ebdbb2',
      muted: '#a89984',
      border: '#665c54',
      focus: '#8ec07c',
      selection: '#504945',
      selectionText: '#fbf1c7',
      warning: '#fabd2f',
      error: '#fb4934',
      present: '#b8bb26',
    },
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    colors: {
      background: '#fbf1c7',
      surface: '#fbf1c7',
      text: '#3c3836',
      muted: '#7c6f64',
      border: '#bdae93',
      focus: '#076678',
      selection: '#d5c4a1',
      selectionText: '#282828',
      warning: '#b57614',
      error: '#9d0006',
      present: '#79740e',
    },
  },
  {
    id: 'catppuccin-dark',
    name: 'Catppuccin Mocha',
    colors: {
      background: '#1e1e2e',
      surface: '#1e1e2e',
      text: '#cdd6f4',
      muted: '#a6adc8',
      border: '#585b70',
      focus: '#89b4fa',
      selection: '#45475a',
      selectionText: '#cdd6f4',
      warning: '#f9e2af',
      error: '#f38ba8',
      present: '#a6e3a1',
    },
  },
  {
    id: 'catppuccin-light',
    name: 'Catppuccin Latte',
    colors: {
      background: '#eff1f5',
      surface: '#eff1f5',
      text: '#4c4f69',
      muted: '#6c6f85',
      border: '#9ca0b0',
      focus: '#1e66f5',
      selection: '#ccd0da',
      selectionText: '#4c4f69',
      warning: '#df8e1d',
      error: '#d20f39',
      present: '#40a02b',
    },
  },
  {
    id: 'tokyonight-dark',
    name: 'Tokyo Night',
    colors: {
      background: '#1a1b26',
      surface: '#1a1b26',
      text: '#c0caf5',
      muted: '#737aa2',
      border: '#3b4261',
      focus: '#7aa2f7',
      selection: '#414868',
      selectionText: '#c0caf5',
      warning: '#e0af68',
      error: '#f7768e',
      present: '#9ece6a',
    },
  },
  {
    id: 'tokyonight-light',
    name: 'Tokyo Night Day',
    colors: {
      background: '#e1e2e7',
      surface: '#e1e2e7',
      text: '#3760bf',
      muted: '#6172b0',
      border: '#a1a6c5',
      focus: '#2e7de9',
      selection: '#c4c8da',
      selectionText: '#1a1b26',
      warning: '#b15c00',
      error: '#f52a65',
      present: '#587539',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    colors: {
      background: '#002b36',
      surface: '#002b36',
      text: '#839496',
      muted: '#657b83',
      border: '#586e75',
      focus: '#268bd2',
      selection: '#073642',
      selectionText: '#93a1a1',
      warning: '#b58900',
      error: '#dc322f',
      present: '#859900',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    colors: {
      background: '#fdf6e3',
      surface: '#fdf6e3',
      text: '#657b83',
      muted: '#93a1a1',
      border: '#839496',
      focus: '#268bd2',
      selection: '#eee8d5',
      selectionText: '#586e75',
      warning: '#b58900',
      error: '#dc322f',
      present: '#859900',
    },
  },
]

export const DEFAULT_THEME = THEMES[0].id

export function isTheme(id) {
  return THEMES.some(theme => theme.id === id)
}

export function themeColors(id) {
  const colors = THEMES.find(theme => theme.id === id)?.colors ?? THEMES[0].colors
  // `null` means transparent: OpenTUI must receive `undefined` to paint nothing.
  return colors.background === null ? { ...colors, background: undefined } : colors
}

export function themeName(id) {
  return THEMES.find(theme => theme.id === id)?.name ?? THEMES[0].name
}
