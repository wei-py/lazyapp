import { loadSettings, saveSettings } from '../../vendor/lazy-kit/settings.js'
import { DEFAULT_THEME, isTheme } from '../../vendor/lazy-kit/themes.js'

const DEFAULTS = { language: 'en', theme: DEFAULT_THEME }

function invalidPreferences() {
  return Object.assign(new Error('Settings are invalid; the existing file was not changed.'), {
    code: 'PREFERENCES_INVALID',
  })
}

/** Read personal UI preferences without creating files or touching App workspaces. */
export async function loadPreferences(options = {}) {
  const settings = loadSettings('lazyapp', DEFAULTS, options.directory)
  return {
    language: settings.language === 'zh' ? 'zh' : 'en',
    theme: isTheme(settings.theme) ? settings.theme : DEFAULT_THEME,
  }
}

/** Atomically persist supported language and theme; unsupported values are rejected. */
export async function savePreferences({ language, theme = DEFAULT_THEME }, options = {}) {
  if (!['en', 'zh'].includes(language) || !isTheme(theme))
    throw invalidPreferences()
  saveSettings('lazyapp', { language, theme }, options.directory)
}
