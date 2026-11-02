import { isAbsolute } from 'node:path'
import { t } from './i18n.js'

/** Supported editor kinds. Platform names are also their directory names. */
export const documentKinds = Object.freeze([
  'app',
  'android',
  'ios',
  'harmony',
  'windows',
  'macos',
  'miniprogram',
  'service',
  'environment',
  'assets',
  'store',
])
export const platformKinds = Object.freeze([
  'android',
  'ios',
  'harmony',
  'windows',
  'macos',
  'miniprogram',
])

function field(key, label, type = 'text', required = false, scope) {
  return Object.freeze({ key, label, type, required, ...(scope ? { scope } : {}) })
}

function expiryField(referenceKey, label, scope = 'signing', allowPermanent = false) {
  return Object.freeze({
    ...field(`${referenceKey}ExpiresOn`, label, 'date', false, scope),
    expiresFor: referenceKey,
    ...(allowPermanent ? { allowPermanent: true } : {}),
  })
}

const FIELDS = {
  app: [
    field('name', 'App name', 'text', true),
    field('description', 'Description'),
    field('version', 'Version'),
    field('platforms', 'Enabled platforms (comma separated)'),
    field('environments', 'Environments (comma separated)'),
  ],
  android: [
    field('applicationId', 'Application ID', 'text', true, 'platform'),
    field('versionCode', 'Version code', 'number', false, 'platform'),
    field('versionName', 'Version name', 'text', false, 'platform'),
    field('keystore', 'Keystore', 'file', true, 'signing'),
    expiryField('keystore', 'Keystore certificate expiry date'),
    field('storePassword', 'Keystore password', 'secret', true, 'signing'),
    field('alias', 'Key alias', 'text', true, 'signing'),
    field('keyPassword', 'Key password', 'secret', true, 'signing'),
    field('serviceAccount', 'Google Play service account JSON', 'file', false, 'platform'),
    field('googleServices', 'Firebase google-services.json', 'file', false, 'platform'),
    field('firebaseAppId', 'Firebase App ID', 'text', false, 'platform'),
    field('fcmCredentials', 'FCM credentials', 'secret', false, 'platform'),
  ],
  ios: [
    field('bundleId', 'Bundle ID', 'text', true, 'platform'),
    field('teamId', 'Team ID', 'text', true, 'platform'),
    field('appleId', 'Apple ID', 'text', false, 'platform'),
    field('capabilities', 'Capabilities', 'text', false, 'platform'),
    field('certificate', 'Certificate (.p12)', 'file', true, 'signing'),
    expiryField('certificate', 'Certificate expiry date'),
    field('certificatePassword', 'Certificate password (may be empty)', 'secret', false, 'signing'),
    field('provisioningProfile', 'Provisioning profile', 'file', true, 'signing'),
    expiryField('provisioningProfile', 'Provisioning profile expiry date'),
    field('issuerId', 'App Store Connect issuer ID', 'text', false, 'platform'),
    field('keyId', 'App Store Connect key ID', 'text', false, 'platform'),
    field('privateKey', 'App Store Connect private key (.p8)', 'file', false, 'platform'),
    field('apnsKey', 'APNs auth key (.p8)', 'file', false, 'platform'),
    field('apnsKeyId', 'APNs key ID', 'text', false, 'platform'),
  ],
  harmony: [
    field('bundleName', 'Bundle name', 'text', true, 'platform'),
    field('bundleType', 'Bundle type', 'text', false, 'platform'),
    field('material', 'Material archive (.zip)', 'file', false, 'platform'),
    field('foreground', 'Harmony icon foreground', 'file', false, 'platform'),
    field('background', 'Harmony icon background', 'file', false, 'platform'),
    field('startWindowBackground', 'Launch background color (#RRGGBB)', 'text', false, 'platform'),
    field('startWindowIcon', 'Launch center icon', 'file', false, 'platform'),
    field('certificate', 'Certificate (.cer)', 'file', true, 'signing'),
    expiryField('certificate', 'Certificate expiry date'),
    field('profile', 'Profile (.p7b)', 'file', true, 'signing'),
    expiryField('profile', 'Profile expiry date'),
    field('keystore', 'Keystore (.p12)', 'file', true, 'signing'),
    field('alias', 'Key alias', 'text', true, 'signing'),
    field('storePassword', 'Keystore password', 'secret', true, 'signing'),
    field('keyPassword', 'Key password', 'secret', true, 'signing'),
  ],
  windows: [
    field('packageIdentity', 'Package identity', 'text', true, 'platform'),
    field('publisher', 'Publisher', 'text', true, 'platform'),
    field('version', 'Version', 'text', false, 'platform'),
    field('certificate', 'Signing certificate (.pfx)', 'file', true, 'signing'),
    expiryField('certificate', 'Certificate expiry date'),
    field('certificatePassword', 'Certificate password', 'secret', false, 'signing'),
  ],
  macos: [
    field('bundleId', 'Bundle ID', 'text', true, 'platform'),
    field('teamId', 'Team ID', 'text', true, 'platform'),
    field('developerId', 'Developer ID', 'text', false, 'platform'),
    field('certificate', 'Signing certificate (.p12)', 'file', true, 'signing'),
    expiryField('certificate', 'Certificate expiry date'),
    field('certificatePassword', 'Certificate password', 'secret', false, 'signing'),
    field('provisioningProfile', 'Provisioning profile', 'file', false, 'signing'),
    expiryField('provisioningProfile', 'Provisioning profile expiry date'),
  ],
  miniprogram: [
    field('provider', 'Provider (WeChat / Alipay / other)', 'text', true, 'platform'),
    field('appId', 'App ID', 'text', true, 'platform'),
    field('appSecret', 'App secret', 'secret', false, 'signing'),
    field('privateKey', 'Upload private key', 'file', false, 'signing'),
    expiryField('privateKey', 'Upload private key expiry date'),
  ],
  service: [
    field('name', 'Service name', 'text', true),
    field('provider', 'Provider'),
    field('category', 'Category (push / maps / payment / other)'),
    field('appId', 'App ID'),
    field('clientId', 'Client ID'),
    field('apiKey', 'API key', 'secret'),
    field('apiSecret', 'API secret', 'secret'),
    field('clientSecret', 'Client secret', 'secret'),
    field('token', 'Token', 'secret'),
    field('endpoint', 'Endpoint'),
    field('credentials', 'Credentials file', 'file'),
    field('privateKey', 'Private key', 'file'),
    field('notes', 'Notes'),
  ],
  environment: [
    field('name', 'Environment name', 'text', true),
    field('apiUrl', 'API URL'),
    field('webUrl', 'Web URL'),
    field('cdnUrl', 'CDN URL'),
    field('downloadUrl', 'Download URL'),
    field('privacyUrl', 'Privacy policy URL'),
    field('termsUrl', 'Terms URL'),
    field('token', 'Token', 'secret'),
    field('variables', 'Additional variables / secrets', 'secret'),
  ],
  assets: [
    field('icon', 'App icon source', 'file'),
    field('splash', 'Splash source', 'file'),
    field('screenshots', 'Screenshots', 'files'),
    field('promotionalImage', 'Promotional image', 'file'),
    field('waiver', 'Waiver letter', 'file'),
    expiryField('waiver', 'Waiver letter expiry date', null, true),
    field('businessLicense', 'Business license', 'file'),
    expiryField('businessLicense', 'Business license expiry date', null, true),
    field('softwareCopyright', 'Software copyright certificate', 'file'),
    field('copyrightSupplement', 'Software copyright supplement', 'file'),
    expiryField('copyrightSupplement', 'Software copyright supplement expiry date', null, true),
  ],
  store: [
    field('name', 'Store name', 'text', true),
    field('appName', 'App name'),
    field('appId', 'Store App ID'),
    field('subtitle', 'Subtitle'),
    field('description', 'Description'),
    field('keywords', 'Keywords'),
    field('privacyUrl', 'Privacy policy URL'),
    field('supportUrl', 'Support URL'),
    field('marketingUrl', 'Marketing URL'),
    field('screenshots', 'Screenshots', 'files'),
    field('promotionalImage', 'Promotional image', 'file'),
    field('consoleUrl', 'Console URL'),
    field('notes', 'Notes'),
  ],
}
for (const fields of Object.values(FIELDS)) Object.freeze(fields)
Object.freeze(FIELDS)
const CHINESE_FIELDS = Object.fromEntries(
  Object.entries(FIELDS).map(([kind, fields]) => [
    kind,
    Object.freeze(fields.map(item => Object.freeze({ ...item, label: t('zh', item.label) }))),
  ]),
)

/** A portable single directory name; never a path. */
export function isSafeName(name) {
  return (
    typeof name === 'string'
    && name.length > 0
    && name.length <= 120
    && name === name.trim()
    && !/[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(name)
    && !name.startsWith('.')
    && !name.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
  )
}

/** Fields are immutable. Scope separates platform identity from per-environment signing. */
export function documentFields(kind, { scope = 'all', language = 'en' } = {}) {
  const fields = (language === 'zh' ? CHINESE_FIELDS : FIELDS)[kind]
  if (!Object.hasOwn(FIELDS, kind))
    throw new Error('Unsupported document kind')
  if (!['all', 'platform', 'signing'].includes(scope))
    throw new Error('Unsupported document scope')
  return scope === 'all' ? fields : fields.filter(item => !item.scope || item.scope === scope)
}

/** Canonical workspace-relative document location. Invalid names are never echoed. */
export function documentPath(kind, { name, environment } = {}) {
  if (!documentKinds.includes(kind))
    throw new Error('Unsupported document kind')
  if (kind === 'app')
    return 'app.json'
  if (kind === 'assets')
    return 'assets/config.json'
  if (platformKinds.includes(kind)) {
    if (environment !== undefined && !isSafeName(environment))
      throw new Error('Environment name must be a safe single directory name')
    return `platforms/${kind}/${environment === undefined ? '' : `${environment}/`}config.json`
  }
  if (!isSafeName(name))
    throw new Error('Document name must be a safe single directory name')
  return `${kind === 'service' ? 'services' : kind === 'environment' ? 'environments' : 'store'}/${name}.json`
}
/** Identify only supported configuration documents, not imported JSON credentials. */
export function identifyDocument(path) {
  if (path === 'app.json')
    return { kind: 'app', scope: 'all' }
  if (path === 'assets/config.json')
    return { kind: 'assets', scope: 'all' }
  const parts = path.split('/')
  if (
    parts[0] === 'platforms'
    && platformKinds.includes(parts[1])
    && parts.at(-1) === 'config.json'
  ) {
    if (parts.length === 3)
      return { kind: parts[1], scope: 'platform' }
    if (parts.length === 4 && isSafeName(parts[2]))
      return { kind: parts[1], scope: 'signing', environment: parts[2] }
  }
  const kinds = { services: 'service', environments: 'environment', store: 'store' }
  if (
    parts.length === 2
    && Object.hasOwn(kinds, parts[0])
    && parts[1].endsWith('.json')
    && isSafeName(parts[1].slice(0, -5))
  ) {
    return { kind: kinds[parts[0]], scope: 'all', name: parts[1].slice(0, -5) }
  }
  return null
}

function validReference(value) {
  return (
    !/[\u0000-\u001F\u007F]/u.test(value)
    && (isAbsolute(value)
      || (!/[\\:]/u.test(value) && value.split('/').every(part => part && !part.startsWith('.'))))
  )
}

/** Strict Gregorian calendar date; avoids Date's rollover and special handling of years 0–99. */
export function isValidExpiryDate(value) {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (year < 1 || month < 1 || month > 12 || day < 1)
    return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/** Validate without mutation; issues contain field labels, never submitted values. */
export function validateDocument(kind, data, options = {}) {
  const fields = documentFields(kind, options)
  const language = options.language || 'en'
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return [{ key: '', message: t(language, 'Configuration must be a JSON object') }]
  const issues = []
  const issue = (key, messageKey, params = {}) => {
    const renderedParams = params.index
      ? { ...params, label: `${t(language, params.label)} #${params.index}` }
      : params
    issues.push({
      key,
      message: t(language, messageKey, renderedParams),
      ...(options.messages ? { messageKey, params } : {}),
    })
  }
  if (data.schemaVersion !== 1)
    issue('schemaVersion', 'Unsupported or missing schema version; expected 1')
  for (const { key, label, type, required, allowPermanent } of fields) {
    const value = data[key]
    if (value === undefined || value === null || value === '') {
      if (required)
        issue(key, '{label} is required', { label })
      continue
    }
    if (kind === 'app' && ['platforms', 'environments'].includes(key))
      continue
    if (type === 'date') {
      if (!(allowPermanent && value === 'never') && !isValidExpiryDate(value)) {
        issue(key, allowPermanent
          ? '{label} must be a valid YYYY-MM-DD date or never'
          : '{label} must be a valid YYYY-MM-DD date', { label })
      }
      continue
    }
    if (type === 'files') {
      if (!Array.isArray(value) && typeof value !== 'string') {
        issue(key, '{label} must be an array of file references', { label })
        continue
      }
      const references = Array.isArray(value) ? value : [value]
      const seen = new Set()
      for (const [index, reference] of references.entries()) {
        const params = { label, index: index + 1 }
        if (typeof reference !== 'string') {
          issue(key, '{label} must be text', params)
        }
        else if (Array.isArray(value) && !reference.trim()) {
          issue(key, '{label} must not be blank', params)
        }
        else if (!validReference(reference)) {
          issue(key, '{label} must be an absolute external path or a workspace-relative path without hidden components, traversal, colons, or backslashes', params)
        }
        else if (reference.toLowerCase().endsWith('.example')) {
          issue(key, '{label} refers to an example placeholder; import a real file before saving', params)
        }
        else if (seen.has(reference)) {
          issue(key, '{label} must not contain duplicate file references', params)
        }
        seen.add(reference)
      }
      continue
    }
    if (type === 'number') {
      if (!Number.isSafeInteger(value) || value < 1)
        issue(key, '{label} must be a positive safe integer', { label })
    }
    else if (typeof value !== 'string') {
      issue(key, '{label} must be text', { label })
    }
    else if (required && !value.trim()) {
      issue(key, '{label} is required', { label })
    }
    else if (type === 'file' && !validReference(value)) {
      issue(
        key,
        '{label} must be an absolute external path or a workspace-relative path without hidden components, traversal, colons, or backslashes',
        { label },
      )
    }
    else if (type === 'file' && value.toLowerCase().endsWith('.example')) {
      issue(key, '{label} refers to an example placeholder; import a real file before saving', {
        label,
      })
    }
  }
  if (kind === 'app') {
    for (const key of ['platforms', 'environments']) {
      const values = data[key]
      if (!Array.isArray(values) || values.some(value => !isSafeName(value))) {
        issue(key, '{label} must be an array of safe names', {
          label: t(language, key === 'platforms' ? 'Platforms' : 'Environments'),
        })
      }
      else if (
        new Set(values.map(value => value.normalize('NFC').toLowerCase())).size !== values.length
      ) {
        issue(key, '{label} must not contain duplicate or case-conflicting names', {
          label: t(language, key === 'platforms' ? 'Platforms' : 'Environments'),
        })
      }
    }
    if (
      Array.isArray(data.platforms)
      && data.platforms.some(value => !platformKinds.includes(value))
    ) {
      issue('platforms', 'Enabled platforms must use supported platform names')
    }
  }
  if (kind === 'environment' && data.name && !isSafeName(data.name))
    issue('name', 'Environment name must be a safe single directory name')
  return issues
}

/** Create only the metadata draft; this function never touches the filesystem. */
export function createApp({
  name,
  description = '',
  version = '1.0.0',
  platforms = [],
  environments = [],
} = {}) {
  const app = {
    schemaVersion: 1,
    name,
    description,
    version,
    platforms: Array.isArray(platforms) ? [...platforms] : platforms,
    environments: Array.isArray(environments) ? [...environments] : environments,
  }
  const issues = validateDocument('app', app)
  if (issues.length) {
    const error = new Error(issues.map(issue => issue.message).join('; '))
    error.code = 'VALIDATION_FAILED'
    error.issues = issues
    throw error
  }
  return app
}
