import { isAbsolute } from 'node:path'
import { t } from './i18n.js'

/** Supported editor kinds. Platform names are also their directory names. */
export const documentKinds = Object.freeze(['app', 'android', 'ios', 'harmony', 'windows', 'macos', 'miniprogram', 'service', 'environment', 'assets', 'store'])
export const platformKinds = Object.freeze(['android', 'ios', 'harmony', 'windows', 'macos', 'miniprogram'])

function field(key, label, type = 'text', required = false, scope) {
  return Object.freeze({ key, label, type, required, ...(scope ? { scope } : {}) })
}

const FIELDS = {
  app: [field('name', 'App name', 'text', true), field('description', 'Description'), field('version', 'Version'), field('platforms', 'Enabled platforms (comma separated)'), field('environments', 'Environments (comma separated)')],
  android: [
    field('applicationId', 'Application ID', 'text', true, 'platform'),
    field('versionCode', 'Version code', 'number', false, 'platform'),
    field('versionName', 'Version name', 'text', false, 'platform'),
    field('keystore', 'Keystore', 'file', true, 'signing'),
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
    field('certificatePassword', 'Certificate password (may be empty)', 'secret', false, 'signing'),
    field('provisioningProfile', 'Provisioning profile', 'file', true, 'signing'),
    field('issuerId', 'App Store Connect issuer ID', 'text', false, 'platform'),
    field('keyId', 'App Store Connect key ID', 'text', false, 'platform'),
    field('privateKey', 'App Store Connect private key (.p8)', 'file', false, 'platform'),
    field('apnsKey', 'APNs auth key (.p8)', 'file', false, 'platform'),
    field('apnsKeyId', 'APNs key ID', 'text', false, 'platform'),
  ],
  harmony: [
    field('bundleName', 'Bundle name', 'text', true, 'platform'),
    field('bundleType', 'Bundle type', 'text', false, 'platform'),
    field('certificate', 'Certificate (.cer)', 'file', true, 'signing'),
    field('profile', 'Profile (.p7b)', 'file', true, 'signing'),
    field('keystore', 'Keystore (.p12)', 'file', true, 'signing'),
    field('alias', 'Key alias', 'text', true, 'signing'),
    field('storePassword', 'Keystore password', 'secret', true, 'signing'),
    field('keyPassword', 'Key password', 'secret', true, 'signing'),
  ],
  windows: [field('packageIdentity', 'Package identity', 'text', true, 'platform'), field('publisher', 'Publisher', 'text', true, 'platform'), field('version', 'Version', 'text', false, 'platform'), field('certificate', 'Signing certificate (.pfx)', 'file', true, 'signing'), field('certificatePassword', 'Certificate password', 'secret', false, 'signing')],
  macos: [field('bundleId', 'Bundle ID', 'text', true, 'platform'), field('teamId', 'Team ID', 'text', true, 'platform'), field('developerId', 'Developer ID', 'text', false, 'platform'), field('certificate', 'Signing certificate (.p12)', 'file', true, 'signing'), field('certificatePassword', 'Certificate password', 'secret', false, 'signing'), field('provisioningProfile', 'Provisioning profile', 'file', false, 'signing')],
  miniprogram: [field('provider', 'Provider (WeChat / Alipay / other)', 'text', true, 'platform'), field('appId', 'App ID', 'text', true, 'platform'), field('appSecret', 'App secret', 'secret', false, 'signing'), field('privateKey', 'Upload private key', 'file', false, 'signing')],
  service: [field('name', 'Service name', 'text', true), field('provider', 'Provider'), field('category', 'Category (push / maps / payment / other)'), field('appId', 'App ID'), field('clientId', 'Client ID'), field('apiKey', 'API key', 'secret'), field('apiSecret', 'API secret', 'secret'), field('clientSecret', 'Client secret', 'secret'), field('token', 'Token', 'secret'), field('endpoint', 'Endpoint'), field('credentials', 'Credentials file', 'file'), field('privateKey', 'Private key', 'file'), field('notes', 'Notes')],
  environment: [field('name', 'Environment name', 'text', true), field('apiUrl', 'API URL'), field('webUrl', 'Web URL'), field('cdnUrl', 'CDN URL'), field('downloadUrl', 'Download URL'), field('privacyUrl', 'Privacy policy URL'), field('termsUrl', 'Terms URL'), field('token', 'Token', 'secret'), field('variables', 'Additional variables / secrets', 'secret')],
  assets: [field('icon', 'App icon source', 'file'), field('splash', 'Splash source', 'file'), field('screenshots', 'Screenshot file', 'file'), field('promotionalImage', 'Promotional image', 'file')],
  store: [field('name', 'Store name', 'text', true), field('appName', 'App name'), field('appId', 'Store App ID'), field('subtitle', 'Subtitle'), field('description', 'Description'), field('keywords', 'Keywords'), field('privacyUrl', 'Privacy policy URL'), field('supportUrl', 'Support URL'), field('marketingUrl', 'Marketing URL'), field('screenshots', 'Screenshot file', 'file'), field('promotionalImage', 'Promotional image', 'file'), field('consoleUrl', 'Console URL'), field('notes', 'Notes')],
}
for (const fields of Object.values(FIELDS)) Object.freeze(fields)
Object.freeze(FIELDS)
const CHINESE_FIELDS = Object.fromEntries(Object.entries(FIELDS).map(([kind, fields]) => [kind, Object.freeze(fields.map(item => Object.freeze({ ...item, label: t('zh', item.label) })))]))

/** A portable single directory name; never a path. */
export function isSafeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 120
    && name === name.trim() && !/[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(name)
    && !name.startsWith('.') && !name.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
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

function validReference(value) {
  return !/[\u0000-\u001F\u007F]/u.test(value) && (isAbsolute(value)
    || (!/[\\:]/u.test(value) && value.split('/').every(part => part && !part.startsWith('.'))))
}

/** Validate without mutation; issues contain field labels, never submitted values. */
export function validateDocument(kind, data, options = {}) {
  const fields = documentFields(kind, options)
  const language = options.language || 'en'
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return [{ key: '', message: t(language, 'Configuration must be a JSON object') }]
  const issues = []
  const issue = (key, messageKey, params = {}) => issues.push({ key, message: t(language, messageKey, params), ...(options.messages ? { messageKey, params } : {}) })
  if (data.schemaVersion !== 1)
    issue('schemaVersion', 'Unsupported or missing schema version; expected 1')
  for (const { key, label, type, required } of fields) {
    const value = data[key]
    if (value === undefined || value === null || value === '') {
      if (required)
        issue(key, '{label} is required', { label })
      continue
    }
    if (kind === 'app' && ['platforms', 'environments'].includes(key))
      continue
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
      issue(key, '{label} must be an absolute external path or a workspace-relative path without hidden components, traversal, colons, or backslashes', { label })
    }
    else if (type === 'file' && value.toLowerCase().endsWith('.example')) {
      issue(key, '{label} refers to an example placeholder; import a real file before saving', { label })
    }
  }
  if (kind === 'app') {
    for (const key of ['platforms', 'environments']) {
      const values = data[key]
      if (!Array.isArray(values) || values.some(value => !isSafeName(value)))
        issue(key, '{label} must be an array of safe names', { label: t(language, key === 'platforms' ? 'Platforms' : 'Environments') })
      else if (new Set(values.map(value => value.normalize('NFC').toLowerCase())).size !== values.length)
        issue(key, '{label} must not contain duplicate or case-conflicting names', { label: t(language, key === 'platforms' ? 'Platforms' : 'Environments') })
    }
    if (Array.isArray(data.platforms) && data.platforms.some(value => !platformKinds.includes(value)))
      issue('platforms', 'Enabled platforms must use supported platform names')
  }
  if (kind === 'environment' && data.name && !isSafeName(data.name))
    issue('name', 'Environment name must be a safe single directory name')
  return issues
}

/** Create only the metadata draft; this function never touches the filesystem. */
export function createApp({ name, description = '', version = '1.0.0', platforms = [], environments = [] } = {}) {
  const app = { schemaVersion: 1, name, description, version, platforms: Array.isArray(platforms) ? [...platforms] : platforms, environments: Array.isArray(environments) ? [...environments] : environments }
  const issues = validateDocument('app', app)
  if (issues.length) {
    const error = new Error(issues.map(issue => issue.message).join('; '))
    error.code = 'VALIDATION_FAILED'
    error.issues = issues
    throw error
  }
  return app
}
