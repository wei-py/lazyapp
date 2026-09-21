import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { initializeWorkspace, inspectExternalReference, openWorkspace } from '../src/storage/workspace.js'

const APP = { schemaVersion: 1, name: 'Example', description: '', version: '1.0.0', platforms: ['ios'], environments: ['preview'] }

let project
let sessions

beforeEach(async () => {
  project = await fs.mkdtemp(path.join(tmpdir(), 'lazyapp-storage-'))
  sessions = []
})

afterEach(async () => {
  try {
    for (const session of sessions)
      await session.close()
  }
  finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

async function initialize(options) {
  const session = await initializeWorkspace(project, APP, options)
  sessions.push(session)
  return session
}

async function open(directory = project) {
  const session = await openWorkspace(directory)
  sessions.push(session)
  return session
}

describe('workspace persistence and initialization', () => {
  test('discovery and canceled initialization never create files or scan parents', async () => {
    await expect(openWorkspace(project)).rejects.toMatchObject({ code: 'WORKSPACE_MISSING' })
    expect(await fs.readdir(project)).toEqual([])
    const parent = await initialize()
    await fs.mkdir(path.join(project, 'nested'))
    await expect(openWorkspace(path.join(project, 'nested'))).rejects.toMatchObject({ code: 'WORKSPACE_MISSING' })
    expect(await fs.readdir(path.join(project, 'nested'))).toEqual([])
    expect((await parent.read('app.json')).data).toEqual(APP)
  })

  test('stages all wizard documents and file imports, persists unknown fields and releases locks', async () => {
    const source = path.join(project, 'original.p12')
    await fs.writeFile(source, 'fictional certificate')
    const session = await initialize({
      documents: [{ path: 'platforms/ios/preview/config.json', data: { schemaVersion: 1, certificate: 'platforms/ios/preview/certificate.p12' } }],
      imports: [{ source, destination: 'platforms/ios/preview/certificate.p12' }],
    })
    const snapshot = await session.read('app.json')
    const data = { ...snapshot.data, name: 'Updated', futureField: { keep: true } }
    const saved = await session.save('app.json', data, snapshot.revision)
    expect(saved.revision).not.toBe(snapshot.revision)
    expect(await fs.readFile(path.join(session.root, 'app.json'), 'utf8')).toBe(`${JSON.stringify(data, null, 2)}\n`)
    expect(await fs.readFile(path.join(session.root, '.gitignore'), 'utf8')).toBe('*\n')
    expect(await session.list()).toEqual(['app.json', 'platforms/ios/preview/certificate.p12', 'platforms/ios/preview/config.json'])
    expect(await fs.readFile(source, 'utf8')).toBe('fictional certificate')
    await session.close()
    await session.close()
    const reopened = await open()
    expect(await reopened.read('app.json')).toEqual(saved)
    expect(await reopened.read('services/missing.json')).toEqual({ data: null, revision: null })
  })

  test('failed staged imports leave no workspace or staging debris', async () => {
    await expect(initializeWorkspace(project, APP, {
      documents: [{ path: 'services/example.json', data: { schemaVersion: 1, token: 'fictional-token' } }],
      imports: [{ source: path.join(project, 'missing.p12'), destination: 'assets/missing.p12' }],
    })).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readdir(project)).toEqual([])
  })

  test('existing directories and duplicate staged destinations are never overwritten', async () => {
    await expect(initializeWorkspace(project, APP, {
      documents: [{ path: 'app.json', data: APP }],
    })).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    expect(await fs.readdir(project)).toEqual([])
    await fs.mkdir(path.join(project, '.lazyapp'))
    await fs.writeFile(path.join(project, '.lazyapp', 'keep.txt'), 'keep')
    await expect(openWorkspace(project)).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    await expect(initializeWorkspace(project, APP)).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    expect(await fs.readFile(path.join(project, '.lazyapp', 'keep.txt'), 'utf8')).toBe('keep')
  })

  test('corrupt JSON and unsupported versions cannot be overwritten or treated as missing', async () => {
    const session = await initialize()
    const documentPath = path.join(session.root, 'app.json')
    const initial = await session.read('app.json')
    await fs.writeFile(documentPath, '{"fictionalSecret":"do not echo",')
    await expect(session.read('app.json')).rejects.toMatchObject({ code: 'INVALID_JSON' })
    await expect(session.save('app.json', APP, initial.revision)).rejects.toMatchObject({ code: 'INVALID_JSON' })
    expect(await fs.readFile(documentPath, 'utf8')).toBe('{"fictionalSecret":"do not echo",')
    const future = JSON.stringify({ ...APP, schemaVersion: 99 })
    await fs.writeFile(documentPath, future)
    await expect(session.read('app.json')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' })
    await expect(session.save('app.json', APP, initial.revision)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' })
    await expect(session.save('other.json', { schemaVersion: 2 }, null)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' })
    expect(await fs.readFile(documentPath, 'utf8')).toBe(future)
    await session.close()
    await expect(openWorkspace(project)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' })
    expect(await fs.readdir(session.root)).not.toContain('.lazyapp.lock')
  })

  test('new directories, files, locks, and imported credentials have private POSIX permissions', async () => {
    if (process.platform === 'win32')
      return
    const source = path.join(project, 'source.key')
    await fs.writeFile(source, 'fictional-key', { mode: 0o644 })
    await fs.chmod(source, 0o644)
    const session = await initialize({ imports: [{ source, destination: 'assets/keys/file.key' }] })
    for (const directory of [session.root, path.join(session.root, 'assets'), path.join(session.root, 'assets/keys')])
      expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
    for (const relative of ['app.json', '.gitignore', '.lazyapp.lock', 'assets/keys/file.key'])
      expect((await fs.stat(path.join(session.root, relative))).mode & 0o777).toBe(0o600)
    expect((await fs.stat(source)).mode & 0o777).toBe(0o644)
    expect(await session.permissionWarnings()).toEqual([])
    await fs.chmod(path.join(session.root, 'app.json'), 0o644)
    expect(await session.permissionWarnings()).toEqual([expect.objectContaining({ path: 'app.json' })])
  })
})

describe('serialized commits, locks, and external edits', () => {
  test('refuses another instance with owner information and refuses stale locks without removing them', async () => {
    const session = await initialize()
    try {
      await openWorkspace(project)
      throw new Error('Expected an exclusive lock conflict')
    }
    catch (error) {
      expect(error.code).toBe('WORKSPACE_LOCKED')
      expect(error.owner.pid).toBe(process.pid)
      expect(error.message).toContain('verify the owner')
    }
    await session.close()
    const stale = JSON.stringify({ pid: 2147483647, hostname: 'fictional-host', startedAt: '2000-01-01T00:00:00Z', token: 'old' })
    await fs.writeFile(path.join(session.root, '.lazyapp.lock'), stale)
    await expect(openWorkspace(project)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED', owner: { pid: 2147483647 } })
    expect(await fs.readFile(path.join(session.root, '.lazyapp.lock'), 'utf8')).toBe(stale)
  })

  test('external edits conflict without changing originals and queued writes compare revisions at commit', async () => {
    const session = await initialize()
    const initial = await session.read('app.json')
    const changed = `${JSON.stringify({ ...APP, name: 'External editor' })}\n`
    await fs.writeFile(path.join(session.root, 'app.json'), changed)
    await expect(session.save('app.json', { ...APP, name: 'Draft' }, initial.revision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await fs.readFile(path.join(session.root, 'app.json'), 'utf8')).toBe(changed)
    const reloaded = await session.read('app.json')
    const results = await Promise.allSettled([
      session.save('app.json', { ...APP, name: 'First' }, reloaded.revision),
      session.save('app.json', { ...APP, name: 'Second' }, reloaded.revision),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'REVISION_CONFLICT' } })
    expect((await session.read('app.json')).data.name).toBe('First')
    expect((await fs.readdir(session.root)).filter(name => name.startsWith('.lazyapp-tmp-'))).toEqual([])
    const valid = await session.read('app.json')
    expect((await session.save('app.json', APP, valid.revision)).data).toEqual(APP)
  })

  test('serialization errors leave originals unchanged and close drains pending writes', async () => {
    const session = await initialize()
    const snapshot = await session.read('app.json')
    const cyclic = { ...APP }
    cyclic.self = cyclic
    await expect(session.save('app.json', cyclic, snapshot.revision)).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    expect(await session.read('app.json')).toEqual(snapshot)
    const saving = session.save('app.json', { ...APP, name: 'Before close' }, snapshot.revision)
    const closing = session.close()
    await expect(saving).resolves.toMatchObject({ data: { name: 'Before close' } })
    await closing
    await expect(session.read('app.json')).rejects.toMatchObject({ code: 'SESSION_CLOSED' })
    expect((await (await open()).read('app.json')).data.name).toBe('Before close')
  })
})

describe('file boundaries and external read-only references', () => {
  test('rejects traversal, absolute destinations, hidden paths, and symlink parents and leaves external files unchanged', async () => {
    const session = await initialize()
    const external = path.join(project, 'outside.key')
    await fs.writeFile(external, 'original')
    for (const relative of ['../outside.key', '/tmp/escape', 'assets/../escape', 'assets//escape', 'assets\\escape', 'C:escape', '.lazyapp.lock', 'assets/.hidden']) {
      await expect(session.save(relative, { schemaVersion: 1 }, null)).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
      await expect(session.removeFile(relative)).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    }
    await fs.symlink(project, path.join(session.root, 'linked'))
    await expect(session.read('linked/outside.key')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(session.importFile(external, 'linked/other.key')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(session.removeFile('linked/outside.key')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(session.list()).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await fs.symlink(external, path.join(session.root, 'file.key'))
    await expect(session.inspectReference('file.key')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(session.importFile(external, 'file.key', { overwrite: true })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    expect(await fs.readFile(external, 'utf8')).toBe('original')
    expect(await fs.readdir(project)).toEqual(expect.arrayContaining(['.lazyapp', 'outside.key']))
  })

  test('refuses symlink workspace roots without adopting their destination', async () => {
    const outside = path.join(project, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'app.json'), JSON.stringify(APP))
    await fs.symlink(outside, path.join(project, '.lazyapp'))
    await expect(openWorkspace(project)).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    await expect(initializeWorkspace(project, APP)).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    expect(await fs.readdir(outside)).toEqual(['app.json'])
  })

  test('imports multiple buffers and empty files without leaking handles or changing bytes', async () => {
    const session = await initialize()
    const source = path.join(project, 'binary.key')
    const content = 'fictional\0二进制\n'.repeat(20000)
    await fs.writeFile(source, content)
    await session.importFile(source, 'assets/binary.key')
    expect(await fs.readFile(path.join(session.root, 'assets/binary.key'), 'utf8')).toBe(content)
    expect(await fs.readFile(source, 'utf8')).toBe(content)
    await fs.writeFile(source, '')
    await session.importFile(source, 'assets/empty.key')
    expect((await fs.stat(path.join(session.root, 'assets/empty.key'))).size).toBe(0)
  })

  test('copy import requires explicit overwrite, preserves source, and deletes only internal regular files', async () => {
    const session = await initialize()
    const source = path.join(project, 'external.key')
    await fs.writeFile(source, 'original')
    expect(await inspectExternalReference(source)).toMatchObject({ external: true, exists: true, regular: true })
    expect(await session.inspectReference(source)).toMatchObject({ external: true, exists: true, regular: true })
    expect(await session.inspectReference('assets/missing.key')).toMatchObject({ external: false, exists: false })
    expect(await inspectExternalReference(path.join(project, 'missing'))).toMatchObject({ exists: false })
    await expect(inspectExternalReference('relative.key')).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(inspectExternalReference(project)).rejects.toMatchObject({ code: 'INVALID_FILE' })
    expect(await session.importFile(source, 'assets/key.key')).toBe('assets/key.key')
    await fs.writeFile(source, 'updated source')
    await expect(session.importFile(source, 'assets/key.key')).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    expect(await fs.readFile(path.join(session.root, 'assets/key.key'), 'utf8')).toBe('original')
    await session.importFile(source, 'assets/key.key', { overwrite: true })
    expect(await fs.readFile(path.join(session.root, 'assets/key.key'), 'utf8')).toBe('updated source')
    await expect(session.importFile(path.join(session.root, 'assets/key.key'), 'assets/key.key', { overwrite: true })).rejects.toMatchObject({ code: 'INVALID_FILE' })
    await expect(session.removeFile(source)).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(session.removeFile('assets')).rejects.toMatchObject({ code: 'INVALID_FILE' })
    await expect(session.removeFile('app.json')).rejects.toMatchObject({ code: 'INVALID_FILE' })
    await session.removeFile('assets/key.key')
    expect(await session.inspectReference('assets/key.key')).toMatchObject({ exists: false })
    expect(await fs.readFile(source, 'utf8')).toBe('updated source')
  })
})
