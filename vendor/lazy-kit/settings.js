import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'

/**
 * Personal UI settings (`{ language, theme }`) stored at
 * `$XDG_CONFIG_HOME/<appName>/settings.json` (default `~/.config`). An
 * explicit `directory` overrides the whole path. Reads never throw: a
 * missing, unreadable, or corrupt file yields `defaults` with every missing
 * field filled in. Writes are atomic — a 0600 temp file renamed over the
 * target — and preserve neither locks nor unknown fields.
 */

function settingsPath(appName, directory) {
  if (directory)
    return join(directory, 'settings.json')
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config')
  return join(base, appName, 'settings.json')
}

export function loadSettings(appName, defaults, directory) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(settingsPath(appName, directory), 'utf8'))
  }
  catch {
    return { ...defaults }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return { ...defaults }
  const settings = { ...defaults }
  for (const key of Object.keys(defaults)) {
    if (parsed[key] !== undefined && parsed[key] !== null)
      settings[key] = parsed[key]
  }
  return settings
}

export function saveSettings(appName, settings, directory) {
  const target = settingsPath(appName, directory)
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  try {
    renameSync(temporary, target)
  }
  catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
