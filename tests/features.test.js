import { createApp, identifyDocument } from '../src/config/model.js'
import {
  loadDocuments,
  runDoctor,
  safeErrorMessage,
  saveDocument,
} from '../src/features/workspace.js'
import { describe, expect, test } from '../support/node-test.js'

function memorySession(initial, references = {}) {
  const records = new Map(
    Object.entries(initial).map(([path, data]) => [
      path,
      { data: structuredClone(data), revision: `original:${path}` },
    ]),
  )
  let writes = 0
  return {
    records,
    get writes() {
      return writes
    },
    async list() {
      return [...records.keys()]
    },
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
      return {
        path,
        external: path.startsWith('/'),
        exists: Boolean(references[path]),
        regular: Boolean(references[path]),
        permissionsWarning: false,
      }
    },
    async permissionWarnings() {
      return []
    },
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
    expect(documents.map(document => document.path)).toEqual([
      'app.json',
      'platforms/android/config.json',
      'services/push.json',
      'store/play.json',
    ])
    expect(documents[0].revision).toBe('original:app.json')
    expect(identifyDocument('platforms/ios/preview/config.json')).toEqual({
      kind: 'ios',
      scope: 'signing',
      environment: 'preview',
    })
    expect(identifyDocument('environments/../production.json')).toBeNull()
  })

  test('save retains unknown fields and validates without mutating draft or writing on errors', async () => {
    const original = {
      schemaVersion: 1,
      name: 'Push',
      token: 'fictional-secret',
      custom: { keep: [1, 2] },
    }
    const session = memorySession({ 'services/push.json': original })
    const draft = { name: 'Renamed' }
    const saved = await saveDocument(
      session,
      'services/push.json',
      'service',
      draft,
      'original:services/push.json',
    )
    expect(saved.data).toEqual({ ...original, name: 'Renamed' })
    expect(draft).toEqual({ name: 'Renamed' })
    await expect(
      saveDocument(session, 'services/push.json', 'service', { name: '' }, saved.revision),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(session.writes).toBe(1)
    expect(session.records.get('services/push.json')).toEqual(saved)
  })

  test('screenshot lists preserve order on save and reopen while legacy references canonicalize only on save', async () => {
    for (const [kind, path] of [['assets', 'assets/config.json'], ['store', 'store/play.json']]) {
      const initial = { schemaVersion: 1, ...(kind === 'store' ? { name: 'Play' } : {}), screenshots: 'assets/legacy.png' }
      const session = memorySession({ [path]: initial })
      expect((await loadDocuments(session))[0].data.screenshots).toBe('assets/legacy.png')
      expect(session.writes).toBe(0)
      const legacy = await saveDocument(session, path, kind, {}, `original:${path}`)
      expect(legacy.data.screenshots).toEqual(['assets/legacy.png'])
      const draft = { screenshots: ['assets/second.png', 'assets/first.png', '/tmp/external.png'] }
      const saved = await saveDocument(session, path, kind, draft, legacy.revision)
      expect(saved.data.screenshots).toEqual(['assets/second.png', 'assets/first.png', '/tmp/external.png'])
      expect((await loadDocuments(session))[0].data.screenshots).toEqual(saved.data.screenshots)
      expect(draft).toEqual({ screenshots: ['assets/second.png', 'assets/first.png', '/tmp/external.png'] })
      const cleared = await saveDocument(session, path, kind, { screenshots: '' }, saved.revision)
      expect(cleared.data.screenshots).toEqual([])
      expect((await session.read(path)).data.screenshots).toEqual([])
    }
  })

  test('invalid screenshot arrays never save and Doctor inspects valid items independently with ordinal labels', async () => {
    const screenshots = ['assets/first.png', 'assets/missing.png', '/tmp/external.png']
    const session = memorySession({
      'app.json': createApp({ name: 'Example' }),
      'assets/config.json': { schemaVersion: 1, screenshots },
    }, { 'assets/first.png': true, '/tmp/external.png': true })
    for (const invalid of [
      ['../escape.png'],
      ['assets/example.png.example'],
      [null],
      [''],
      ['   '],
      ['assets/first.png', 'assets/first.png'],
      { path: 'assets/first.png' },
    ]) {
      await expect(saveDocument(session, 'assets/config.json', 'assets', { screenshots: invalid }, 'original:assets/config.json'))
        .rejects
        .toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(session.writes).toBe(0)
    const results = (await runDoctor(session)).filter(item => item.path === 'assets/config.json')
    expect(results).toContainEqual(expect.objectContaining({
      status: 'missing',
      label: 'Screenshots #2: referenced file is missing',
    }))
    expect(results.filter(item => item.status === 'unchecked').map(item => item.label)).toEqual([
      'Screenshots #1: content, validity, expiry, and compatibility have not been checked',
      'Screenshots #3: content, validity, expiry, and compatibility have not been checked',
    ])
    expect(results).toContainEqual(expect.objectContaining({
      status: 'warning',
      label: 'Screenshots #3: external read-only reference is not portable with this workspace',
    }))
    session.records.get('assets/config.json').data.screenshots = ['../escape.png', 'assets/first.png']
    const partial = (await runDoctor(session)).filter(item => item.path === 'assets/config.json')
    expect(partial).toContainEqual(expect.objectContaining({ status: 'error', message: expect.objectContaining({ params: { label: 'Screenshots', index: 1 } }) }))
    expect(partial).toContainEqual(expect.objectContaining({ status: 'pass', label: 'Screenshots #2: file exists (existence only)' }))
    expect(session.writes).toBe(0)
  })

  test('qualification attachments reject unsafe references and Doctor distinguishes missing from unchecked originals', async () => {
    const assets = {
      schemaVersion: 1,
      waiver: 'assets/materials/免责函.jpg',
      businessLicense: 'assets/materials/营业执照.jpg',
      softwareCopyright: 'assets/materials/软著.png',
      copyrightSupplement: 'assets/materials/软著补充.jpg',
    }
    const session = memorySession({
      'app.json': createApp({ name: 'Example' }),
      'assets/config.json': assets,
    }, { [assets.businessLicense]: true, [assets.softwareCopyright]: true })
    for (const key of ['waiver', 'businessLicense', 'softwareCopyright', 'copyrightSupplement']) {
      for (const reference of ['../escape.jpg', `${assets[key]}.example`]) {
        await expect(saveDocument(session, 'assets/config.json', 'assets', { [key]: reference }, 'original:assets/config.json'))
          .rejects
          .toMatchObject({ code: 'VALIDATION_FAILED', issues: [{ key }] })
      }
    }
    expect(session.writes).toBe(0)
    const results = (await runDoctor(session)).filter(item => item.path === 'assets/config.json')
    expect(results.filter(item => item.status === 'missing').map(item => item.message.params.label).sort())
      .toEqual(['Software copyright supplement', 'Waiver letter'])
    expect(results.filter(item => item.status === 'unchecked').map(item => item.message.params.label).sort())
      .toEqual(['Business license', 'Software copyright certificate'])
  })

  test('external revision conflicts and unsupported schemas never write', async () => {
    const session = memorySession({ 'app.json': createApp({ name: 'Example' }) })
    await expect(
      saveDocument(session, 'app.json', 'app', { name: 'Changed' }, 'stale'),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(
      saveDocument(session, 'app.json', 'app', { schemaVersion: 2 }, 'original:app.json'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      saveDocument(
        session,
        'services/other.json',
        'app',
        createApp({ name: 'Wrong category' }),
        null,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(session.writes).toBe(0)
  })

  test('save failures retain the submitted draft and corrupt loads do not become empty data', async () => {
    const session = memorySession({ 'app.json': createApp({ name: 'Example' }) })
    const draft = { name: 'Unsaved' }
    session.save = async () => {
      throw Object.assign(new Error('disk unavailable'), { code: 'EACCES' })
    }
    await expect(
      saveDocument(session, 'app.json', 'app', draft, 'original:app.json'),
    ).rejects.toMatchObject({ code: 'EACCES' })
    expect(draft).toEqual({ name: 'Unsaved' })
    expect(session.records.get('app.json').data.name).toBe('Example')
    session.read = async () => {
      throw new Error('malformed fictional secret')
    }
    await expect(loadDocuments(session)).rejects.toThrow()
    expect(await runDoctor(session)).toMatchObject([
      {
        status: 'error',
        label: 'Configuration cannot be read; check JSON, schema version, and permissions',
        path: 'app.json',
      },
    ])
  })

  test('Doctor is read-only and separates missing files, existence, and unparsed credentials', async () => {
    const session = memorySession(
      {
        'app.json': createApp({ name: 'Example', platforms: ['ios'], environments: ['preview'] }),
        'platforms/ios/config.json': { schemaVersion: 1, bundleId: 'com.example', teamId: 'TEAM' },
        'platforms/ios/preview/config.json': {
          schemaVersion: 1,
          certificate: 'platforms/ios/preview/cert.p12',
          certificatePassword: 'fictional-NEVER-OUTPUT',
          provisioningProfile: '/tmp/fictional-profile',
        },
        'environments/preview.json': { schemaVersion: 1, name: 'preview' },
      },
      { 'platforms/ios/preview/cert.p12': true },
    )
    const report = await runDoctor(session)
    expect(
      report.some(
        item => item.status === 'pass' && item.label.includes('file exists (existence only)'),
      ),
    ).toBe(true)
    expect(
      report.some(item => item.status === 'unchecked' && item.label.includes('validity, expiry')),
    ).toBe(true)
    expect(
      report.some(
        item => item.status === 'missing' && item.label.includes('Provisioning profile'),
      ),
    ).toBe(true)
    expect(
      report.some(item => item.status === 'warning' && item.label.includes('external read-only')),
    ).toBe(true)
    expect(JSON.stringify(report)).not.toContain('fictional-NEVER-OUTPUT')
    expect(JSON.stringify(report)).not.toContain('/tmp/fictional-profile')
    expect(session.writes).toBe(0)
  })

  test('disabled platforms have no missing errors and environments are not forced into every platform', async () => {
    const session = memorySession(
      {
        'app.json': createApp({
          name: 'Example',
          platforms: ['android'],
          environments: ['preview', 'production'],
        }),
        'platforms/android/config.json': { schemaVersion: 1, applicationId: 'com.example' },
        'platforms/android/production/config.json': {
          schemaVersion: 1,
          keystore: 'platforms/android/production/signing.keystore',
          storePassword: 'fake',
          alias: 'app',
          keyPassword: 'fake',
        },
        'platforms/ios/config.json': { schemaVersion: 1 },
        'platforms/ios/preview/config.json': { schemaVersion: 1, certificate: 'missing.p12' },
        'environments/preview.json': { schemaVersion: 1, name: 'preview' },
        'environments/production.json': { schemaVersion: 1, name: 'production' },
      },
      { 'platforms/android/production/signing.keystore': true },
    )
    const report = await runDoctor(session)
    expect(report.filter(item => item.status === 'missing')).toEqual([])
    expect(report.some(item => item.path === 'platforms/android/preview/config.json')).toBe(
      false,
    )
  })

  test('Doctor reports name inconsistency and broad permissions without inspecting credentials as valid', async () => {
    const session = memorySession({
      'app.json': createApp({ name: 'Example', environments: ['preview'] }),
      'environments/preview.json': { schemaVersion: 1, name: 'production' },
    })
    session.permissionWarnings = async () => [
      { path: 'app.json', label: 'Permissions allow access by other users' },
    ]
    const report = await runDoctor(session)
    expect(report).toContainEqual(
      expect.objectContaining({
        status: 'error',
        label: 'Environment name does not match its document filename',
        path: 'environments/preview.json',
      }),
    )
    expect(report).toContainEqual(
      expect.objectContaining({
        status: 'warning',
        label: 'Permissions allow access by other users',
        path: 'app.json',
      }),
    )
    expect(safeErrorMessage(new Error('fictional secret token'))).not.toContain('fictional secret')
  })

  test('UI projects missing config counterparts without parsing example contents or changing Doctor inputs', async () => {
    const session = memorySession({
      'app.json': createApp({ name: 'Example' }),
      'services/push.json.example': new Error('malformed example, never active'),
      'assets/icon/source.png.example': new Error('not an image'),
    })
    const actual = await loadDocuments(session)
    expect(actual.map(item => item.path)).toEqual(['app.json'])
    const visible = await loadDocuments(session, { includeExamples: true })
    const missing = visible.find(item => item.path === 'services/push.json')
    expect(missing).toMatchObject({
      kind: 'service',
      missing: true,
      examplePath: 'services/push.json.example',
      revision: null,
    })
    expect(missing.data).toBeNull()
    expect(visible.some(item => item.path.endsWith('.png'))).toBe(false)
    expect(session.writes).toBe(0)
    const doctor = await runDoctor(session)
    expect(
      doctor.some(item => item.path === 'services/push.json' || item.path.endsWith('.example')),
    ).toBe(false)
  })

  test('actual config wins over placeholder and deletion restores its missing UI row', async () => {
    const session = memorySession({
      'app.json': createApp({ name: 'Example' }),
      'services/push.json.example': {
        schemaVersion: 1,
        instruction: 'Never copy this into real config',
        token: 'fictional-example-token',
      },
    })
    await saveDocument(
      session,
      'services/push.json',
      'service',
      { schemaVersion: 1, name: 'Real service' },
      null,
    )
    const present = (await loadDocuments(session, { includeExamples: true })).filter(
      item => item.path === 'services/push.json',
    )
    expect(present).toHaveLength(1)
    expect(present[0].missing).not.toBe(true)
    expect(present[0].data).toEqual({ schemaVersion: 1, name: 'Real service' })
    session.records.delete('services/push.json')
    const missing = (await loadDocuments(session, { includeExamples: true })).find(
      item => item.path === 'services/push.json',
    )
    expect(missing.missing).toBe(true)
    expect(missing.revision).toBeNull()
  })
})
