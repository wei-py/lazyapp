/**
 * Terminal palettes. Gruvbox Light is the fixed default; explicit `auto` follows
 * the terminal mode. Auto palettes are opaque so unknown terminal backgrounds
 * cannot undermine contrast. Every palette has the same semantic keys.
 */
const AUTO_DARK = {
  background: '#151922',
  surface: '#202633',
  text: '#e6edf3',
  muted: '#b0bac8',
  border: '#66768e',
  focus: '#9dc5ff',
  selection: '#303c50',
  selectionText: '#e6edf3',
  warning: '#f3d28a',
  error: '#ff9eaa',
  present: '#a3df9b',
  aur: '#d9b8ff',
  repo: '#9dc5ff',
}

const AUTO_LIGHT = {
  background: '#f8fafc',
  surface: '#f0f4f8',
  text: '#172436',
  muted: '#45566c',
  border: '#68798f',
  focus: '#124fa3',
  selection: '#dbe7f5',
  selectionText: '#172436',
  warning: '#785000',
  error: '#9e1630',
  present: '#1b6537',
  aur: '#653098',
  repo: '#124fa3',
}

export const THEMES = [
  {
    id: 'auto',
    name: 'Auto (terminal)',
    colors: AUTO_DARK,
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
      aur: '#BB9AF7',
      repo: '#8ec07c',
    },
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    colors: {
      background: '#fbf1c7',
      surface: '#fbf1c7',
      text: '#3c3836',
      muted: '#504945',
      border: '#bdae93',
      focus: '#07525f',
      selection: '#d5c4a1',
      selectionText: '#282828',
      warning: '#734600',
      error: '#9d0006',
      present: '#4f5600',
      aur: '#653098',
      repo: '#07525f',
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
      aur: '#BB9AF7',
      repo: '#89b4fa',
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
      aur: '#BB9AF7',
      repo: '#1e66f5',
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
      aur: '#BB9AF7',
      repo: '#7aa2f7',
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
      aur: '#BB9AF7',
      repo: '#2e7de9',
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
      aur: '#BB9AF7',
      repo: '#268bd2',
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
      aur: '#BB9AF7',
      repo: '#268bd2',
    },
  },
]

export const DEFAULT_THEME = 'gruvbox-light'

export function isTheme(id) {
  return THEMES.some(theme => theme.id === id)
}

export function themeColors(id, mode = 'dark') {
  const theme = THEMES.find(theme => theme.id === id)
  if (theme?.id === 'auto')
    return mode === 'light' ? AUTO_LIGHT : AUTO_DARK
  return (theme || THEMES.find(theme => theme.id === DEFAULT_THEME)).colors
}

export function themeName(id) {
  return THEMES.find(theme => theme.id === id)?.name
    ?? THEMES.find(theme => theme.id === DEFAULT_THEME).name
}
