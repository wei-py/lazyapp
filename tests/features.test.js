import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/config/model.js'
import { identifyDocument, loadDocuments, runDoctor, safeErrorMessage, saveDocument } from '../src/features/workspace.js'

function memorySession(initial, references = {}) {
  const records = new Map(Object.entries(initial).map(([path, data]) => [path, { data: structuredClone(data), revision: `original:${path}` }]))
  let writes = 0
  return {
    records,
    get writes() { return writes },
    async list() { return [...records.keys()] },
    async read(path) {
      const entry = records.get(path)
      if (entry?.data instanceof Error)
        throw entry.data
      return entry ? structuredClone(entry) : { data: null, revision: null }
    },
    async save(path, data, revision) {
      if ((records.get(path)?.revision ?? null) !== revision)
        throw new Error('Unexpected test revision')
      const entry = { data: structuredClone(data), revision: `saved:${++writes}` }
      records.set(path, entry)
      return structuredClone(entry)
    },
    async inspectReference(path) {
      return { path, external: path.startsWith('/'), exists: Boolean(references[path]), regular: Boolean(references[path]), permissionsWarning: false }
    },
    async permissionWarnings() { return [] },
  }
}

describe('workspace features', () => {
  test('loads actual documents with revision metadata, never imported credential JSON', async () => {
    const session = memorySession({
      'services/push.json': { schemaVersion: 1, name: 'Push', token: 'fictional' },
      'app.json': createApp({ name: 'Example' }),
      'platforms/android/config.json': { schemaVersion: 1, applicationId: 'com.example' },
      'platforms/android/account.json': { private_key: 'fictional-private-key' },
      'services/files/credentials.json': { token: 'fictional' },
      'store/play.json': { schemaVersion: 1, name: 'Play' },
    })
    const documents = await loadDocuments(session)
    expect(documents.map(document => document.path)).toEqual(['app.json', 'platforms/android/config.json', 'services/push.json', 'store/play.json'])
    expect(documents[0].revision).toBe('original:app.json')
    expect(identifyDocument('platforms/ios/preview/config.json')).toEqual({ kind: 'ios', scope: 'signing', environment: 'preview' })
    expect(identifyDocument('environments/../production.json')).toBeNull()
  })

  test('save retains unknown fields and validates without mutating draft or writing on errors', async () => {
    const original = { schemaVersion: 1, name: 'Push', token: 'fictional-secret', custom: { keep: [1, 2] } }
    const session = memorySession({ 'services/push.json': original })
    const draft = { name: 'Renamed' }
    const saved = await saveDocument(session, 'services/push.json', 'service', draft, 'original:services/push.json')
    expect(saved.data).toEqual({ ...original, name: 'Renamed' })
    expect(draft).toEqual({ name: 'Renamed' })
    await expect(saveDocument(session, 'services/push.json', 'service', { name: '' }, saved.revision)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(session.writes).toBe(1)
    expect(session.records.get('services/push.json')).toEqual(saved)
  })

  test('external revision conflicts and unsupported schemas never write', async () => {
    const session = memorySession({ 'app.json': createApp({ name: 'Example' }) })
    await expect(saveDocument(session, 'app.json', 'app', { name: 'Changed' }, 'stale')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(saveDocument(session, 'app.json', 'app', { schemaVersion: 2 }, 'original:app.json')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(saveDocument(session, 'services/other.json', 'app', createApp({ name: 'Wrong category' }), null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(session.writes).toBe(0)
  })

  test('save failures retain the submitted draft and corrupt loads do not become empty data', async () => {
    const session = memorySession({ 'app.json': createApp({ name: 'Example' }) })
    const draft = { name: 'Unsaved' }
    session.save = async () => {
      throw Object.assign(new Error('disk unavailable'), { code: 'EACCES' })
    }
    await expect(saveDocument(session, 'app.json', 'app', draft, 'original:app.json')).rejects.toMatchObject({ code: 'EACCES' })
    expect(draft).toEqual({ name: 'Unsaved' })
    expect(session.records.get('app.json').data.name).toBe('Example')
    session.read = async () => {
      throw new Error('malformed fictional secret')
    }
    await expect(loadDocuments(session)).rejects.toThrow()
    expect(await runDoctor(session)).toEqual([{ status: 'error', label: 'Configuration cannot be read; check JSON, schema version, and permissions', path: 'app.json' }])
  })

  test('Doctor is read-only and separates missing files, existence, and unparsed credentials', async () => {
    const session = memorySession({
      'app.json': createApp({ name: 'Example', platforms: ['ios'], environments: ['preview'] }),
      'platforms/ios/config.json': { schemaVersion: 1, bundleId: 'com.example', teamId: 'TEAM' },
      'platforms/ios/preview/config.json': { schemaVersion: 1, certificate: 'platforms/ios/preview/cert.p12', certificatePassword: 'fictional-NEVER-OUTPUT', provisioningProfile: '/tmp/fictional-profile' },
      'environments/preview.json': { schemaVersion: 1, name: 'preview' },
    }, { 'platforms/ios/preview/cert.p12': true })
    const report = await runDoctor(session)
    expect(report.some(item => item.status === 'pass' && item.label.includes('file exists (existence only)'))).toBe(true)
    expect(report.some(item => item.status === 'unchecked' && item.label.includes('validity, expiry'))).toBe(true)
    expect(report.some(item => item.status === 'missing' && item.label.includes('Provisioning profile'))).toBe(true)
    expect(report.some(item => item.status === 'warning' && item.label.includes('external read-only'))).toBe(true)
    expect(JSON.stringify(report)).not.toContain('fictional-NEVER-OUTPUT')
    expect(JSON.stringify(report)).not.toContain('/tmp/fictional-profile')
    expect(session.writes).toBe(0)
  })

  test('disabled platforms have no missing errors and environments are not forced into every platform', async () => {
    const session = memorySession({
      'app.json': createApp({ name: 'Example', platforms: ['android'], environments: ['preview', 'production'] }),
      'platforms/android/config.json': { schemaVersion: 1, applicationId: 'com.example' },
      'platforms/android/production/config.json': { schemaVersion: 1, keystore: 'platforms/android/production/signing.keystore', storePassword: 'fake', alias: 'app', keyPassword: 'fake' },
      'platforms/ios/config.json': { schemaVersion: 1 },
      'platforms/ios/preview/config.json': { schemaVersion: 1, certificate: 'missing.p12' },
      'environments/preview.json': { schemaVersion: 1, name: 'preview' },
      'environments/production.json': { schemaVersion: 1, name: 'production' },
    }, { 'platforms/android/production/signing.keystore': true })
    const report = await runDoctor(session)
    expect(report.filter(item => item.status === 'missing')).toEqual([])
    expect(report.some(item => item.path === 'platforms/android/preview/config.json')).toBe(false)
  })

  test('Doctor reports name inconsistency and broad permissions without inspecting credentials as valid', async () => {
    const session = memorySession({ 'app.json': createApp({ name: 'Example', environments: ['preview'] }), 'environments/preview.json': { schemaVersion: 1, name: 'production' } })
    session.permissionWarnings = async () => [{ path: 'app.json', label: 'Permissions allow access by other users' }]
    const report = await runDoctor(session)
    expect(report).toContainEqual({ status: 'error', label: 'Environment name does not match its document filename', path: 'environments/preview.json' })
    expect(report).toContainEqual({ status: 'warning', label: 'Permissions allow access by other users', path: 'app.json' })
    expect(safeErrorMessage(new Error('fictional secret token'))).not.toContain('fictional secret')
  })
})
