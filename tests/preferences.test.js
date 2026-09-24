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
    expect(await loadPreferences(options)).toEqual({ language: 'en', theme: 'default' })
    expect(await fs.readdir(root)).toEqual([])
  })

  test('language and theme persist across reads with private permissions', async () => {
    await savePreferences({ language: 'zh', theme: 'gruvbox-dark' }, options)
    expect(await loadPreferences(options)).toEqual({ language: 'zh', theme: 'gruvbox-dark' })
    const file = join(options.directory, 'settings.json')
    expect((await fs.stat(options.directory)).mode & 0o777).toBe(0o700)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        language: 'zh',
        theme: 'gruvbox-dark',
        future: { keep: true },
      }),
    )
    await savePreferences({ language: 'en', theme: 'gruvbox-light' }, options)
    expect(await loadPreferences(options)).toEqual({ language: 'en', theme: 'gruvbox-light' })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      language: 'en',
      theme: 'gruvbox-light',
    })
    expect(await fs.readdir(options.directory)).toEqual(['settings.json'])
  })

  test('a settings file written before themes defaults to the built-in palette', async () => {
    await fs.mkdir(options.directory)
    await fs.writeFile(
      join(options.directory, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, language: 'zh' }),
    )
    expect(await loadPreferences(options)).toEqual({ language: 'zh', theme: 'default' })
  })

  test('corrupt, unknown-schema, and unsupported stored values fall back to defaults on read', async () => {
    await fs.mkdir(options.directory)
    const file = join(options.directory, 'settings.json')
    const expectations = new Map([
      ['{broken', { language: 'en', theme: 'default' }],
      ['{"schemaVersion":2,"language":"zh"}', { language: 'zh', theme: 'default' }],
      ['{"schemaVersion":1,"language":"fr"}', { language: 'en', theme: 'default' }],
      [
        '{"schemaVersion":1,"language":"zh","theme":"gruvbox-brutal"}',
        { language: 'zh', theme: 'default' },
      ],
      ['null', { language: 'en', theme: 'default' }],
    ])
    for (const [bytes, expected] of expectations) {
      await fs.writeFile(file, bytes)
      expect(await loadPreferences(options)).toEqual(expected)
      expect(await fs.readFile(file, 'utf8')).toBe(bytes)
    }
  })

  test('a valid save atomically replaces corrupt content', async () => {
    await fs.mkdir(options.directory)
    const file = join(options.directory, 'settings.json')
    await fs.writeFile(file, '{broken')
    await savePreferences({ language: 'zh' }, options)
    expect(await loadPreferences(options)).toEqual({ language: 'zh', theme: 'default' })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect(await fs.readdir(options.directory)).toEqual(['settings.json'])
  })

  test('unsupported requested language or theme writes nothing', async () => {
    await expect(savePreferences({ language: 'fr' }, options)).rejects.toMatchObject({
      code: 'PREFERENCES_INVALID',
    })
    await expect(
      savePreferences({ language: 'en', theme: 'gruvbox-brutal' }, options),
    ).rejects.toMatchObject({ code: 'PREFERENCES_INVALID' })
    expect(await fs.readdir(root)).toEqual([])
  })

  test('symbolic settings files never write through to their external targets', async () => {
    const external = join(root, 'external.json')
    const bytes = '{"schemaVersion":1,"language":"en"}'
    await fs.writeFile(external, bytes)
    await fs.mkdir(options.directory)
    await fs.symlink(external, join(options.directory, 'settings.json'))
    expect(await loadPreferences(options)).toEqual({ language: 'en', theme: 'default' })
    await savePreferences({ language: 'zh' }, options)
    expect(await fs.readFile(external, 'utf8')).toBe(bytes)
    expect((await fs.lstat(join(options.directory, 'settings.json'))).isSymbolicLink()).toBe(false)
    expect(await loadPreferences(options)).toEqual({ language: 'zh', theme: 'default' })
  })
})
