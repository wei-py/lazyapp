import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadPreferences, savePreferences } from '../src/storage/preferences.js'

let root
let options
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'lazyapp-preferences-'))
  options = { directory: join(root, 'settings') }
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('personal language preferences', () => {
  test('missing settings default to English without creating any files', async () => {
    expect(await loadPreferences(options)).toEqual({ language: 'en' })
    expect(await fs.readdir(root)).toEqual([])
  })

  test('language persists across reads with private permissions and unknown fields preserved', async () => {
    await savePreferences({ language: 'zh' }, options)
    expect(await loadPreferences(options)).toEqual({ language: 'zh' })
    const file = join(options.directory, 'settings.json')
    expect((await fs.stat(options.directory)).mode & 0o777).toBe(0o700)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, language: 'zh', future: { keep: true } }))
    await savePreferences({ language: 'en' }, options)
    expect(await loadPreferences(options)).toEqual({ language: 'en' })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ schemaVersion: 1, language: 'en', future: { keep: true } })
    expect(await fs.readdir(options.directory)).toEqual(['settings.json'])
  })

  test('corruption, unknown schema, and unsupported languages remain untouched', async () => {
    await fs.mkdir(options.directory)
    const file = join(options.directory, 'settings.json')
    for (const bytes of ['{broken', '{"schemaVersion":2,"language":"zh"}', '{"schemaVersion":1,"language":"fr"}', 'null']) {
      await fs.writeFile(file, bytes)
      await expect(loadPreferences(options)).rejects.toMatchObject({ code: 'PREFERENCES_INVALID' })
      await expect(savePreferences({ language: 'zh' }, options)).rejects.toMatchObject({ code: 'PREFERENCES_INVALID' })
      expect(await fs.readFile(file, 'utf8')).toBe(bytes)
      expect(await fs.readdir(options.directory)).toEqual(['settings.json'])
    }
  })

  test('unsupported requested language writes nothing', async () => {
    await expect(savePreferences({ language: 'fr' }, options)).rejects.toMatchObject({ code: 'PREFERENCES_INVALID' })
    expect(await fs.readdir(root)).toEqual([])
  })

  test('settings lock rejects a competing writer without altering saved choice', async () => {
    await savePreferences({ language: 'en' }, options)
    await fs.writeFile(join(options.directory, '.settings.lock'), 'other writer')
    await expect(savePreferences({ language: 'zh' }, options)).rejects.toMatchObject({ code: 'PREFERENCES_BUSY' })
    expect(await loadPreferences(options)).toEqual({ language: 'en' })
    expect(await fs.readFile(join(options.directory, '.settings.lock'), 'utf8')).toBe('other writer')
  })

  test('symbolic settings files do not replace their external targets', async () => {
    const external = join(root, 'external.json')
    const bytes = '{"schemaVersion":1,"language":"en"}'
    await fs.writeFile(external, bytes)
    await fs.mkdir(options.directory)
    await fs.symlink(external, join(options.directory, 'settings.json'))
    await expect(loadPreferences(options)).rejects.toMatchObject({ code: 'PREFERENCES_INVALID' })
    await expect(savePreferences({ language: 'zh' }, options)).rejects.toMatchObject({ code: 'PREFERENCES_INVALID' })
    expect(await fs.readFile(external, 'utf8')).toBe(bytes)
  })
})
