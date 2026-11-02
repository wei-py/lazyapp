import { collectExpiries } from '../src/features/expiry.js'
import { describe, expect, test } from '../support/node-test.js'

function ios(environment, value, extra = {}) {
  return {
    path: `platforms/ios/${environment}/config.json`,
    kind: 'ios',
    scope: 'signing',
    environment,
    data: { schemaVersion: 1, certificate: 'signing/certificate.p12', certificateExpiresOn: value, ...extra },
  }
}

describe('entered credential expiries', () => {
  test('uses local calendar days for expired, today, 30-day and 31-day boundaries and sorts dates first', () => {
    const entries = collectExpiries([
      ios('later', '2026-04-01'),
      ios('unknown', undefined),
      ios('soon', '2026-03-31'),
      ios('today', '2026-03-01'),
      ios('expired', '2026-02-28'),
    ], { now: new Date(2026, 2, 1, 23, 59) })
    expect(entries.map(({ environment, status, days }) => [environment, status, days])).toEqual([
      ['expired', 'expired', -1],
      ['today', 'today', 0],
      ['soon', 'soon', 30],
      ['later', 'valid', 31],
      ['unknown', 'unset', null],
    ])
  })

  test('crosses DST without turning a one-day reminder into a fractional or zero-day interval', () => {
    const previous = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      expect(collectExpiries([ios('spring', '2026-03-09')], { now: new Date(2026, 2, 8, 23, 30) })[0].days).toBe(1)
      expect(collectExpiries([ios('autumn', '2026-11-02')], { now: new Date(2026, 10, 1, 0, 30) })[0].days).toBe(1)
    }
    finally {
      if (previous === undefined)
        delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  test('keeps environments isolated and emits localized file labels, never references or secrets', () => {
    const documents = [ios('production', '2028-02-29', { certificatePassword: 'SECRET-SENTINEL', certificate: '/private/SECRET-FILE.p12' }), ios('preview', '2027-02-29')]
    const before = structuredClone(documents)
    const entries = collectExpiries(documents, { now: new Date(2026, 0, 1), language: 'zh' })
    expect(entries.map(entry => entry.status)).toEqual(['valid', 'invalid'])
    expect(entries[0]).toEqual({ path: 'platforms/ios/production/config.json', kind: 'ios', environment: 'production', name: undefined, key: 'certificateExpiresOn', referenceKey: 'certificate', label: '证书 (.p12)', value: '2028-02-29', status: 'valid', days: 789 })
    expect(JSON.stringify(entries)).not.toContain('SECRET')
    expect(documents).toEqual(before)
  })

  test('derives signing scope and environment from the saved document path and redacts invalid date text', () => {
    const data = { schemaVersion: 1, certificate: 'signing/certificate.p12', certificateExpiresOn: 'SECRET-SENTINEL' }
    const entries = collectExpiries([
      { path: 'platforms/ios/production/config.json', kind: 'ios', data, revision: 'saved' },
      { path: 'platforms/ios/preview/config.json', kind: 'ios', environment: 'wrong', scope: 'platform', data },
      { path: 'platforms/ios/config.json', kind: 'ios', scope: 'signing', data },
    ])
    expect(entries.map(({ environment, status, value }) => [environment, status, value])).toEqual([
      ['preview', 'invalid', null],
      ['production', 'invalid', null],
    ])
    expect(JSON.stringify(entries)).not.toContain('SECRET')
  })

  test('includes only actual supported documents and real references, with permanent validity restricted to materials', () => {
    const assets = { path: 'assets/config.json', kind: 'assets', data: { schemaVersion: 1, waiver: 'assets/waiver.pdf', waiverExpiresOn: 'never', businessLicense: 'license.pdf', businessLicenseExpiresOn: null, softwareCopyright: 'copyright.pdf' } }
    const entries = collectExpiries([
      { ...ios('missing', '2026-01-01'), missing: true },
      { ...ios('error', '2026-01-01'), error: new Error('secret') },
      { ...ios('schema', '2026-01-01'), data: { schemaVersion: 2, certificate: 'certificate.p12' } },
      { ...ios('example', '2026-01-01'), path: 'platforms/ios/example/config.json.example' },
      ios('placeholder', '2026-01-01', { certificate: 'certificate.p12.EXAMPLE' }),
      ios('blank', '2026-01-01', { certificate: '  ' }),
      ios('permanent-invalid', 'never'),
      assets,
    ], { now: new Date(2026, 0, 1) })
    expect(entries.map(({ key, status, value }) => [key, status, value])).toEqual([
      ['businessLicenseExpiresOn', 'unset', null],
      ['waiverExpiresOn', 'permanent', 'never'],
      ['certificateExpiresOn', 'invalid', null],
    ])
    expect(collectExpiries([ios('old', undefined)])[0].status).toBe('unset')
    expect(collectExpiries([ios('bad-value', { password: 'SECRET-SENTINEL' })])[0].value).toBe(null)
  })
})
