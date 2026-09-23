import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { defaultInitialization, initializationExamples } from '../src/config/initialization.js'
import { createApp, platformKinds, validateDocument } from '../src/config/model.js'
import { loadDocuments, runDoctor } from '../src/features/workspace.js'
import { initializeWorkspace } from '../src/storage/workspace.js'

let project
let sessions
beforeEach(async () => {
  project = await fs.mkdtemp(join(tmpdir(), 'lazyapp-examples-'))
  sessions = []
})
afterEach(async () => {
  for (const session of sessions) await session.close()
  await fs.rm(project, { recursive: true, force: true })
})
function metadata() {
  return createApp({ name: '示例应用', platforms: ['ios', 'android'], environments: ['preview'] })
}

describe('example-first initialization', () => {
  test('generates only selected platform/environment templates without modifying metadata', () => {
    const app = metadata()
    const original = structuredClone(app)
    const examples = initializationExamples(app)
    const paths = examples.map(item => item.path)
    expect(app).toEqual(original)
    expect(initializationExamples(app)).toEqual(examples)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every(path => path.endsWith('.example'))).toBe(true)
    expect(paths).toContain('assets/config.json.example')
    expect(paths).toContain('services/service.json.example')
    expect(paths).toContain('store/store.json.example')
    expect(paths).toContain('platforms/ios/config.json.example')
    expect(paths).toContain('platforms/ios/preview/config.json.example')
    expect(paths).toContain('environments/preview.json.example')
    expect(paths.some(path => path.includes('/production/') || path.includes('/harmony/'))).toBe(
      false,
    )
    const signing = examples.find(
      item => item.path === 'platforms/ios/preview/config.json.example',
    ).data
    expect(signing).toHaveProperty('certificate')
    expect(signing).not.toHaveProperty('bundleId')
    expect(signing.certificatePassword).toBe('')
  })

  test('publishes all examples privately but loads only real App metadata', async () => {
    const app = metadata()
    const examples = initializationExamples(app)
    const session = await initializeWorkspace(project, app, { examples })
    sessions.push(session)
    expect(await session.list()).toEqual(['app.json', ...examples.map(item => item.path)].sort())
    expect((await loadDocuments(session)).map(document => document.path)).toEqual(['app.json'])
    expect(await fs.readFile(join(session.root, '.gitignore'), 'utf8')).toBe('*\n')
    for (const example of examples) {
      const file = join(session.root, example.path)
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(example.data)
      // POSIX permission bits are not enforced on Windows.
      if (process.platform !== 'win32') {
        expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
        expect((await fs.stat(join(file, '..'))).mode & 0o777).toBe(0o700)
      }
    }
    const report = await runDoctor(session)
    expect(
      report.some(item => item.status === 'missing' && item.path === 'platforms/ios/config.json'),
    ).toBe(true)
    expect(
      report.some(item => item.status === 'missing' && item.path === 'environments/preview.json'),
    ).toBe(true)
    expect(report.some(item => item.path.endsWith('.example'))).toBe(false)
    expect(
      report.some(item => item.status === 'pass' && item.label.includes('file exists')),
    ).toBe(false)
  })

  test('rejects unsafe example paths and real-file destinations without publishing a workspace', async () => {
    for (const path of [
      '../escape.example',
      'platforms/ios/config.json',
      'assets/../outside.example',
    ]) {
      await expect(
        initializeWorkspace(project, metadata(), {
          examples: [{ path, data: { schemaVersion: 1 } }],
        }),
      ).rejects.toThrow()
      expect(await fs.readdir(project)).toEqual([])
    }
    expect(initializationExamples(createApp({ name: 'Example' }))).toBeArray()
    expect(() => initializationExamples({ ...metadata(), environments: ['../escape'] })).toThrow()
  })

  test('duplicate examples and failed staged imports leave no partial scaffold', async () => {
    const example = { path: 'services/service.json.example', data: { schemaVersion: 1 } }
    await expect(
      initializeWorkspace(project, metadata(), { examples: [example, example] }),
    ).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    expect(await fs.readdir(project)).toEqual([])
    await expect(
      initializeWorkspace(project, metadata(), {
        examples: [example],
        imports: [{ source: join(project, 'absent'), destination: 'assets/real.png' }],
      }),
    ).rejects.toThrow()
    expect(await fs.readdir(project)).toEqual([])
  })

  test('existing workspace is never supplemented or overwritten by reinitialization', async () => {
    const app = metadata()
    const session = await initializeWorkspace(project, app)
    sessions.push(session)
    await expect(
      initializeWorkspace(project, app, { examples: initializationExamples(app) }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    expect(await session.list()).toEqual(['app.json'])
    expect((await session.read('app.json')).data).toEqual(app)
  })

  test('an existing example credential cannot count as a usable file reference', async () => {
    const example = {
      path: 'platforms/ios/preview/certificate.p12.example',
      data: { schemaVersion: 1, note: 'Not a certificate' },
    }
    const document = {
      path: 'platforms/ios/preview/config.json',
      data: { schemaVersion: 1, certificate: example.path, provisioningProfile: example.path },
    }
    const session = await initializeWorkspace(project, metadata(), {
      examples: [example],
      documents: [document],
    })
    sessions.push(session)
    const issues = validateDocument('ios', document.data, { scope: 'signing', language: 'zh' })
    expect(
      issues.some(issue => issue.key === 'certificate' && issue.message.includes('占位')),
    ).toBe(true)
    const report = await runDoctor(session)
    const results = report.filter(item => item.path === document.path)
    expect(
      results.some(item => item.status === 'error' && item.label.includes('example placeholder')),
    ).toBe(true)
    expect(results.some(item => item.status === 'pass')).toBe(false)
  })

  test('default scaffold covers supported platforms without enabling them or creating files', async () => {
    const { app, examples } = defaultInitialization('My App')
    expect(app.name).toBe('My App')
    expect(app.platforms).toEqual([])
    expect(app.environments).toEqual([])
    for (const kind of platformKinds) {
      expect(examples.some(item => item.path === `platforms/${kind}/config.json.example`)).toBe(
        true,
      )
      expect(
        examples.some(item => item.path === `platforms/${kind}/development/config.json.example`),
      ).toBe(true)
    }
    expect(
      examples.some(item => item.path === 'platforms/ios/development/certificate.p12.example'),
    ).toBe(true)
    expect(
      examples.some(
        item => item.path === 'platforms/android/production/signing.keystore.example',
      ),
    ).toBe(true)
    expect(
      examples.some(
        item => item.path.includes('undefined') || item.path.endsWith('/credentials.example'),
      ),
    ).toBe(false)
    expect(await fs.readdir(project)).toEqual([])
  })
})
