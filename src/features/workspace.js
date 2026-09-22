import { t } from '../config/i18n.js'
import { documentFields, documentPath, isSafeName, platformKinds, validateDocument } from '../config/model.js'

/** Identify only supported configuration documents, not imported JSON credentials. */
export function identifyDocument(path) {
  if (path === 'app.json')
    return { kind: 'app', scope: 'all' }
  if (path === 'assets/config.json')
    return { kind: 'assets', scope: 'all' }
  const parts = path.split('/')
  if (parts[0] === 'platforms' && platformKinds.includes(parts[1]) && parts.at(-1) === 'config.json') {
    if (parts.length === 3)
      return { kind: parts[1], scope: 'platform' }
    if (parts.length === 4 && isSafeName(parts[2]))
      return { kind: parts[1], scope: 'signing', environment: parts[2] }
  }
  const kinds = { services: 'service', environments: 'environment', store: 'store' }
  if (parts.length === 2 && Object.hasOwn(kinds, parts[0]) && parts[1].endsWith('.json') && isSafeName(parts[1].slice(0, -5))) {
    return { kind: kinds[parts[0]], scope: 'all', name: parts[1].slice(0, -5) }
  }
  return null
}

/** Safe user-facing summaries: unknown exception messages may contain secrets and are not echoed. */
export function safeErrorMessage(error, language = 'en') {
  const messages = {
    PREFERENCES_INVALID: 'A saved preference is invalid or unsafe. Repair the settings file before retrying; it was not overwritten.',
    PREFERENCES_BUSY: 'Preferences are being saved by another instance. Retry when it finishes.',
    VALIDATION_FAILED: 'Configuration validation failed. Check the highlighted fields.',
    REVISION_CONFLICT: 'The file changed outside this editor. Reload before saving; your draft was retained.',
    WORKSPACE_MISSING: 'No workspace exists. Initialize this project first.',
    WORKSPACE_CONFLICT: 'The target directory already exists but is not a valid workspace. Choose another project or resolve the conflict explicitly.',
    WORKSPACE_LOCKED: 'This workspace is locked by another instance. Close it before retrying.',
    INVALID_JSON: 'A configuration contains malformed JSON. Repair it in an external editor before retrying.',
    UNSUPPORTED_SCHEMA: 'This schema version is unsupported. Use a compatible version of lazyapp.',
    PATH_ESCAPE: 'The path is outside the workspace or crosses an unsafe symbolic link.',
    SESSION_CLOSED: 'The workspace session is closed. Reopen the workspace before retrying.',
    INVALID_DOCUMENT: 'The document must be a supported JSON object. Check its structure before retrying.',
    FILE_EXISTS: 'The destination already exists. Confirm overwrite or choose another destination.',
    INVALID_FILE: 'The source must be a readable regular file. Check its path before retrying.',
    ENOENT: 'The requested file does not exist. Check its path and retry.',
    EACCES: 'Permission denied. Check the file permissions and retry.',
    EPERM: 'The operation is not permitted. Check the file permissions and retry.',
    EEXIST: 'The destination already exists. Confirm overwrite or choose another destination.',
  }
  return t(language, Object.hasOwn(messages, error?.code) ? messages[error.code] : 'The operation failed. Check the workspace, file access, and configuration, then retry.')
}

/** Coalesce example instructions with their canonical targets; real files always win. */
export function logicalFiles(paths) {
  const actual = new Set(paths.filter(path => !path.endsWith('.example')))
  const entries = new Map([...actual].map(path => [path, { path, file: true, missing: false }]))
  for (const examplePath of paths.filter(path => path.endsWith('.example'))) {
    const path = examplePath.slice(0, -8)
    if (!entries.has(path))
      entries.set(path, { path, file: true, missing: true, examplePath, instructionOnly: path.split('/').at(-1) === 'credentials' })
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** Doctor reads actual documents only. UI may also expose clean, missing example targets. */
export async function loadDocuments(session, { includeExamples = false } = {}) {
  const paths = await session.list()
  const entries = includeExamples
    ? logicalFiles(paths)
    : paths.map(path => ({ path, missing: false }))
  const documents = []
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    const identified = identifyDocument(entry.path)
    if (!identified)
      continue
    if (entry.missing) {
      documents.push({ path: entry.path, ...identified, data: null, revision: null, missing: true, examplePath: entry.examplePath })
      continue
    }
    const { data, revision } = await session.read(entry.path)
    if (data !== null)
      documents.push({ path: entry.path, ...identified, data, revision, missing: false })
  }
  return documents
}

function validationError(issues) {
  const error = new Error(issues.map(issue => issue.message).join('; '))
  error.code = 'VALIDATION_FAILED'
  error.issues = issues
  return error
}

/** Validate and save a draft while preserving unedited/unknown fields and optimistic revision protection. */
export async function saveDocument(session, path, kind, draft, revision) {
  const identified = identifyDocument(path)
  if (!identified || identified.kind !== kind)
    throw validationError([{ key: '', message: 'Document kind does not match a supported configuration path' }])
  if (!draft || typeof draft !== 'object' || Array.isArray(draft))
    throw validationError([{ key: '', message: 'Configuration must be a JSON object' }])
  const previous = await session.read(path)
  if (previous.revision !== revision) {
    const error = new Error('The file changed outside this editor. Reload before saving.')
    error.code = 'REVISION_CONFLICT'
    throw error
  }
  const data = { ...(previous.data ?? {}), ...draft }
  const issues = validateDocument(kind, data, { scope: identified.scope })
  if (kind === 'environment' && data.name !== identified.name)
    issues.push({ key: 'name', message: 'Environment name must match its document filename' })
  if (issues.length)
    throw validationError(issues)
  return session.save(path, data, revision)
}

/** Read-only completeness check. Existence never implies that a credential can sign or publish. */
export function doctorLabel(result, language = 'en') {
  if (!result.message)
    return result.label
  const { key, params } = result.message
  return t(language, key, params.label ? { ...params, label: t(language, params.label) } : params)
}

export async function runDoctor(session, language = 'en') {
  const results = []
  const report = (status, key, path, params = {}) => {
    const result = { status, path, message: { key, params } }
    result.label = doctorLabel(result, language)
    results.push(result)
  }
  let paths
  try {
    paths = (await session.list()).filter(path => identifyDocument(path)).sort()
  }
  catch {
    report('error', 'Cannot list workspace files; check permissions and retry', '')
    return results
  }
  if (!paths.includes('app.json'))
    paths.unshift('app.json')
  const documents = new Map()
  for (const path of paths) {
    const identified = identifyDocument(path)
    try {
      const { data } = await session.read(path)
      documents.set(path, { ...identified, data })
    }
    catch {
      report('error', 'Configuration cannot be read; check JSON, schema version, and permissions', path)
      documents.set(path, { ...identified, data: null, failed: true })
    }
  }
  const app = documents.get('app.json')?.data
  const enabled = Array.isArray(app?.platforms) ? app.platforms.filter(kind => platformKinds.includes(kind)) : []
  const environments = Array.isArray(app?.environments) ? app.environments.filter(isSafeName) : []
  for (const kind of enabled) {
    const path = documentPath(kind)
    if (!documents.has(path))
      report('missing', 'Enabled platform configuration is missing', path)
    if (kind !== 'miniprogram' && ![...documents.values()].some(document => document.kind === kind && document.scope === 'signing')) {
      report('missing', 'Signing configuration is not configured; add only the environments this platform needs', path)
    }
  }
  for (const name of environments) {
    const path = documentPath('environment', { name })
    if (!documents.has(path))
      report('missing', 'Declared environment configuration is missing', path)
  }
  for (const [path, document] of documents) {
    const { data, kind, scope } = document
    if (document.failed)
      continue
    if (!data) {
      report('missing', 'Configuration is missing', path)
      continue
    }
    const disabled = platformKinds.includes(kind) && !enabled.includes(kind)
    if (disabled)
      report('warning', 'Configuration belongs to a platform not enabled in App; completeness is not required', path)
    const issues = validateDocument(kind, data, { scope, messages: true })
    for (const issue of issues) {
      const missing = issue.messageKey === '{label} is required'
      if (!disabled || !missing)
        report(missing ? 'missing' : 'error', issue.messageKey || issue.message, path, issue.params)
    }
    if (!issues.length && !disabled)
      report('pass', 'Required fields are complete; credentials are not validated', path)
    if (kind === 'environment' && data.name !== document.name)
      report('error', 'Environment name does not match its document filename', path)
    if (kind === 'environment' && !environments.includes(document.name))
      report('warning', 'Environment is not listed in App', path)
    if (document.environment && !environments.includes(document.environment))
      report('warning', 'Platform environment is not listed in App', path)
    for (const field of documentFields(kind, { scope })) {
      const reference = data[field.key]
      if (field.type !== 'file' || typeof reference !== 'string' || !reference || issues.some(issue => issue.key === field.key))
        continue
      try {
        const info = await session.inspectReference(reference)
        if (!info.exists) {
          report(disabled ? 'warning' : 'missing', '{label}: referenced file is missing', path, { label: field.label })
        }
        else if (!info.regular) {
          report('error', '{label}: reference is not a regular file', path, { label: field.label })
        }
        else {
          report('pass', '{label}: file exists (existence only)', path, { label: field.label })
          report('unchecked', '{label}: content, validity, expiry, and compatibility have not been checked', path, { label: field.label })
        }
        if (info.external)
          report('warning', '{label}: external read-only reference is not portable with this workspace', path, { label: field.label })
        if (info.permissionsWarning)
          report('warning', '{label}: file permissions allow access by other users', path, { label: field.label })
      }
      catch {
        report('error', '{label}: cannot inspect reference; check path safety and permissions', path, { label: field.label })
      }
    }
    if (documentFields(kind, { scope }).some(field => field.type === 'secret' && typeof data[field.key] === 'string' && data[field.key].length > 0)) {
      report('unchecked', 'Stored credentials have not been authenticated; no remote services were contacted', path)
    }
  }
  try {
    for (const warning of await session.permissionWarnings()) report('warning', warning.label, warning.path)
  }
  catch {
    report('unchecked', 'Workspace permissions could not be checked', '')
  }
  return results
}
