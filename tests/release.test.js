import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'
import { installRelease } from '../src/storage/release.js'
import { afterEach, beforeEach, describe, expect, test } from '../support/node-test.js'

const webFiles = ['index.html', 'app.js', 'style.css']
let root
let release
let installation
let executable

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'lazyapp-release-'))
  release = join(root, 'download', 'bin')
  installation = join(root, 'installation')
  executable = join(installation, 'lazyapp')
  await fs.mkdir(join(release, 'web'), { recursive: true })
  await fs.mkdir(join(installation, 'web'), { recursive: true })
  await fs.writeFile(join(release, 'lazyapp'), 'new binary')
  await fs.writeFile(executable, 'old binary')
  for (const name of webFiles) {
    await fs.writeFile(join(release, 'web', name), `new ${name}`)
    await fs.writeFile(join(installation, 'web', name), `old ${name}`)
  }
  await fs.writeFile(join(installation, 'web', 'obsolete.js'), 'old obsolete')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function expectOldInstallation() {
  expect(await fs.readFile(executable, 'utf8')).toBe('old binary')
  for (const name of webFiles)
    expect(await fs.readFile(join(installation, 'web', name), 'utf8')).toBe(`old ${name}`)
  expect(await fs.readFile(join(installation, 'web', 'obsolete.js'), 'utf8')).toBe('old obsolete')
  expect((await fs.readdir(installation)).sort()).toEqual(['lazyapp', 'web'])
}

async function expectNewInstallation() {
  expect(await fs.readFile(executable, 'utf8')).toBe('new binary')
  for (const name of webFiles)
    expect(await fs.readFile(join(installation, 'web', name), 'utf8')).toBe(`new ${name}`)
  expect((await fs.readdir(join(installation, 'web'))).sort()).toEqual([...webFiles].sort())
}

describe('release installation transaction', () => {
  test('installs matching binary and Web assets using only target-filesystem renames', async (t) => {
    const rename = fs.rename
    t.mock.method(fs, 'rename', async (source, destination) => {
      // A direct rename from the download directory would fail across filesystems.
      if (!source.startsWith(`${installation}${sep}`) || !destination.startsWith(`${installation}${sep}`))
        throw Object.assign(new Error('cross-device rename'), { code: 'EXDEV' })
      return rename(source, destination)
    })
    await installRelease(release, executable)
    await expectNewInstallation()
    expect((await fs.readdir(installation)).sort()).toEqual(process.platform === 'win32' ? ['lazyapp', 'lazyapp.old', 'web'] : ['lazyapp', 'web'])
    if (process.platform !== 'win32')
      expect((await fs.stat(executable)).mode & 0o777).toBe(0o755)
  })

  test('adds Web assets when the previous installation has no sidecar', async () => {
    await fs.rm(join(installation, 'web'), { recursive: true })
    await installRelease(release, executable)
    await expectNewInstallation()
    expect((await fs.readdir(installation)).sort()).toEqual(process.platform === 'win32' ? ['lazyapp', 'lazyapp.old', 'web'] : ['lazyapp', 'web'])
  })

  for (const name of ['lazyapp', 'web', ...webFiles.map(name => `web/${name}`)]) {
    test(`rejects a release missing ${name} before replacing anything`, async () => {
      await fs.rm(join(release, name), { recursive: true })
      await expect(installRelease(release, executable)).rejects.toThrow('not found in release archive')
      await expectOldInstallation()
    })
  }

  test('rejects non-file Web assets before replacing anything', async () => {
    await fs.rm(join(release, 'web', 'app.js'))
    await fs.mkdir(join(release, 'web', 'app.js'))
    await expect(installRelease(release, executable)).rejects.toThrow('Web file app.js not found')
    await expectOldInstallation()
  })

  test('staging failure leaves the old installation untouched', async (t) => {
    t.mock.method(fs, 'cp', async () => {
      throw new Error('staging copy failed')
    })
    await expect(installRelease(release, executable)).rejects.toThrow('staging copy failed')
    await expectOldInstallation()
  })

  for (const failAt of [1, 2, 3, 4]) {
    test(`restores both old components when commit rename ${failAt} fails`, async (t) => {
      const rename = fs.rename
      let calls = 0
      t.mock.method(fs, 'rename', async (source, destination) => {
        if (++calls === failAt)
          throw new Error(`commit rename ${failAt} failed`)
        return rename(source, destination)
      })
      await expect(installRelease(release, executable)).rejects.toThrow(`commit rename ${failAt} failed`)
      await expectOldInstallation()
    })
  }

  test('removes newly added Web assets on rollback when no sidecar previously existed', async (t) => {
    await fs.rm(join(installation, 'web'), { recursive: true })
    const rename = fs.rename
    let calls = 0
    t.mock.method(fs, 'rename', async (source, destination) => {
      if (++calls === 3)
        throw new Error('binary commit failed')
      return rename(source, destination)
    })
    await expect(installRelease(release, executable)).rejects.toThrow('binary commit failed')
    expect(await fs.readFile(executable, 'utf8')).toBe('old binary')
    expect(await fs.readdir(installation)).toEqual(['lazyapp'])
  })

  test('Windows renames the running binary aside and retains it until exit', { skip: process.platform !== 'win32' }, async () => {
    await fs.writeFile(`${executable}.old`, 'stale backup')
    await installRelease(release, executable)
    await expectNewInstallation()
    expect(await fs.readFile(`${executable}.old`, 'utf8')).toBe('old binary')
    expect((await fs.readdir(installation)).sort()).toEqual(['lazyapp', 'lazyapp.old', 'web'])
  })

  test('Windows restores the renamed running executable after a failed commit', { skip: process.platform !== 'win32' }, async (t) => {
    const rename = fs.rename
    let calls = 0
    t.mock.method(fs, 'rename', async (source, destination) => {
      if (++calls === 4)
        throw new Error('Windows binary commit failed')
      return rename(source, destination)
    })
    await expect(installRelease(release, executable)).rejects.toThrow('Windows binary commit failed')
    await expectOldInstallation()
  })

  test('retains recovery files and reports rollback failures rather than deleting backups', async (t) => {
    const rename = fs.rename
    t.mock.method(fs, 'rename', async (source, destination) => {
      if (destination === executable)
        throw new Error('executable path unavailable')
      return rename(source, destination)
    })
    await expect(installRelease(release, executable)).rejects.toThrow('rollback failed. Recovery files retained at')
    const entries = await fs.readdir(installation)
    const recovery = entries.find(name => name.startsWith('.lazyapp-update-'))
    expect(recovery).toBeDefined()
    const backup = process.platform === 'win32' ? `${executable}.old` : join(installation, recovery, 'previous-binary')
    expect(await fs.readFile(backup, 'utf8')).toBe('old binary')
    expect(await fs.readFile(join(installation, 'web', 'index.html'), 'utf8')).toBe('old index.html')
  })
})
