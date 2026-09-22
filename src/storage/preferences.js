import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { DEFAULT_THEME, isTheme } from '../config/themes.js'

function directoryFor(options) {
  if (options.directory)
    return options.directory
  const base = process.env.XDG_CONFIG_HOME
  return join(base && isAbsolute(base) ? base : join(homedir(), '.config'), 'lazyapp')
}

function invalidPreferences() {
  return Object.assign(new Error('Settings are invalid; the existing file was not changed.'), {
    code: 'PREFERENCES_INVALID',
  })
}

async function readSettings(directory) {
  try {
    const root = await fs.lstat(directory)
    if (!root.isDirectory() || root.isSymbolicLink())
      throw invalidPreferences()
    const target = join(directory, 'settings.json')
    const stat = await fs.lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw invalidPreferences()
    let data
    try {
      data = JSON.parse(await fs.readFile(target, 'utf8'))
    }
    catch (error) {
      if (error instanceof SyntaxError)
        throw invalidPreferences()
      throw error
    }
    if (
      !data
      || Array.isArray(data)
      || data.schemaVersion !== 1
      || !['en', 'zh'].includes(data.language)
      || (data.theme !== undefined && !isTheme(data.theme))
    ) {
      throw invalidPreferences()
    }
    return data
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return { schemaVersion: 1, language: 'en', theme: DEFAULT_THEME }
    throw error
  }
}

/** Read personal UI preferences without creating files or touching App workspaces. */
export async function loadPreferences(options = {}) {
  const data = await readSettings(directoryFor(options))
  return { language: data.language, theme: data.theme ?? DEFAULT_THEME }
}

/** Atomically persist supported language and theme; corrupt or unsupported files are never replaced. */
export async function savePreferences({ language, theme = DEFAULT_THEME }, options = {}) {
  if (!['en', 'zh'].includes(language) || !isTheme(theme))
    throw invalidPreferences()
  const directory = directoryFor(options)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const root = await fs.lstat(directory)
  if (!root.isDirectory() || root.isSymbolicLink())
    throw invalidPreferences()
  const lockPath = join(directory, '.settings.lock')
  let lock
  try {
    lock = await fs.open(lockPath, 'wx', 0o600)
  }
  catch (error) {
    if (error.code === 'EEXIST') {
      throw Object.assign(new Error('Settings are being written by another instance.'), {
        code: 'PREFERENCES_BUSY',
      })
    }
    throw error
  }
  const temporary = join(directory, `.settings-${randomUUID()}.tmp`)
  try {
    const data = await readSettings(directory)
    await fs.writeFile(temporary, `${JSON.stringify({ ...data, language, theme }, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    await fs.rename(temporary, join(directory, 'settings.json'))
  }
  finally {
    try {
      await fs.rm(temporary, { force: true })
    }
    finally {
      await lock.close()
      await fs.unlink(lockPath)
    }
  }
}
