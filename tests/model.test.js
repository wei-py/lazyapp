import { describe, expect, test } from 'bun:test'
import { createApp, documentFields, documentKinds, documentPath, isSafeName, validateDocument } from '../src/config/model.js'

describe('document model', () => {
  test('custom environment names remain ordered, isolated arrays', () => {
    const environments = ['本地', 'customer-preview']
    const app = createApp({ name: 'Example', platforms: ['android'], environments })
    environments.push('later')
    expect(app.environments).toEqual(['本地', 'customer-preview'])
    expect(validateDocument('app', app)).toEqual([])
    expect(documentPath('android', { environment: 'customer-preview' })).toBe('platforms/android/customer-preview/config.json')
  })

  test('safe names reject traversal, reserved names, separators, and case conflicts', () => {
    for (const name of ['', '.', '..', '.preview', '../production', 'a/b', 'a\\b', 'a\u0000b', 'CON', 'production.', ' production']) {
      expect(isSafeName(name)).toBe(false)
      expect(() => documentPath('environment', { name })).toThrow()
    }
    expect(() => createApp({ name: 'Example', environments: ['Production', 'production'] })).toThrow('case-conflicting')
  })

  test('all editor categories expose centralized field types and sensitive values are never in errors', () => {
    expect(documentKinds).toEqual(['app', 'android', 'ios', 'harmony', 'windows', 'macos', 'miniprogram', 'service', 'environment', 'assets', 'store'])
    for (const kind of documentKinds) {
      expect(documentFields(kind).length).toBeGreaterThan(0)
      for (const field of documentFields(kind)) expect(['text', 'secret', 'file', 'number']).toContain(field.type)
    }
    const sentinel = { secret: 'fictional-token-DO-NOT-PRINT' }
    const issues = validateDocument('service', { schemaVersion: 1, name: 'Push', token: sentinel })
    expect(issues).toEqual([{ key: 'token', message: 'Token must be text' }])
    expect(JSON.stringify(issues)).not.toContain(sentinel.secret)
  })

  test('identity and signing requirements are scoped and optional certificate password may be empty', () => {
    expect(validateDocument('android', { schemaVersion: 1, applicationId: 'com.example.app' }, { scope: 'platform' })).toEqual([])
    const ios = { schemaVersion: 1, certificate: 'platforms/ios/release/certificate.p12', certificatePassword: '', provisioningProfile: '/tmp/fictional.mobileprovision' }
    expect(validateDocument('ios', ios, { scope: 'signing' })).toEqual([])
    expect(validateDocument('ios', { ...ios, certificate: '' }, { scope: 'signing' })).toEqual([{ key: 'certificate', message: 'Certificate (.p12) is required' }])
  })

  test('internal file references match managed storage paths while external paths remain explicit', () => {
    for (const icon of ['.token.json', 'assets/.private/icon.png', 'assets/icon:prod.png', 'assets//icon.png', 'assets/./icon.png', 'assets/../icon.png', 'assets\\icon.png']) {
      expect(validateDocument('assets', { schemaVersion: 1, icon }).map(issue => issue.key)).toEqual(['icon'])
    }
    for (const icon of ['assets/icon/source.png', 'assets/图标/icon.prod.png', '/tmp/.token.json', '/tmp/icon:prod.png']) {
      expect(validateDocument('assets', { schemaVersion: 1, icon })).toEqual([])
    }
  })

  test('unknown schema, wrong types and unsafe relative references are rejected without changing input', () => {
    const document = { schemaVersion: 2, applicationId: 'com.example', versionCode: 1.5, serviceAccount: '../outside.json', custom: { preserved: true } }
    const before = structuredClone(document)
    expect(validateDocument('android', document, { scope: 'platform' }).map(issue => issue.key)).toEqual(['schemaVersion', 'versionCode', 'serviceAccount'])
    expect(document).toEqual(before)
    expect(validateDocument('app', { schemaVersion: 1, name: 'Example', platforms: 'android', environments: [] }).some(issue => issue.key === 'platforms')).toBe(true)
  })
})
