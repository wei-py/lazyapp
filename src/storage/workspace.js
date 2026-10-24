import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { identifyDocument } from '../config/model.js'

const LOCK_NAME = '.lazyapp.lock'
const TEMP_PREFIX = '.lazyapp-tmp-'

function failure(code, message) {
  return Object.assign(new Error(message), { code })
}

async function statOrNull(target) {
  try {
    return await fs.lstat(target)
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return null
    throw error
  }
}

function components(relative) {
  if (
    typeof relative !== 'string'
    || !relative
    || path.isAbsolute(relative)
    || /[\\:\x00-\x1F\x7F]/u.test(relative)
  ) {
    throw failure(
      'PATH_ESCAPE',
      'Use a nonempty workspace-relative path without traversal or separators from another operating system.',
    )
  }
  const parts = relative.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw failure(
      'PATH_ESCAPE',
      'Hidden, empty, and traversal path components are not managed file paths.',
    )
  }
  return parts
}

function assertDocument(data, relative) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw failure(
      'INVALID_DOCUMENT',
      `Expected a JSON object at ${relative}; reload or repair it before saving.`,
    )
  }
  if (data.schemaVersion !== 1) {
    throw failure(
      'UNSUPPORTED_SCHEMA',
      `Unsupported schemaVersion at ${relative}; this version supports schemaVersion 1 only. No migration or overwrite was performed.`,
    )
  }
}

function parseDocument(bytes, relative) {
  let data
  try {
    data = JSON.parse(bytes.toString('utf8'))
  }
  catch {
    throw failure(
      'INVALID_JSON',
      `Invalid JSON at ${relative}; repair the file or restore a backup before saving.`,
    )
  }
  assertDocument(data, relative)
  return data
}

function encodeDocument(data, relative) {
  assertDocument(data, relative)
  let serialized
  try {
    serialized = `${JSON.stringify(data, null, 2)}\n`
  }
  catch {
    throw failure('INVALID_DOCUMENT', `Cannot serialize the document at ${relative}.`)
  }
  parseDocument(Buffer.from(serialized), relative)
  return serialized
}

function revision(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readRegular(target) {
  const handle = await fs.open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    if (!(await handle.stat()).isFile()) {
      throw failure(
        'INVALID_FILE',
        'The target must be a regular file, not a directory or special device.',
      )
    }
    return await handle.readFile()
  }
  finally {
    await handle.close()
  }
}

async function removeTemporary(target) {
  try {
    await fs.unlink(target)
  }
  catch (error) {
    if (error.code !== 'ENOENT')
      throw error
  }
}

/** Inspect an explicit absolute external reference without modifying it or its permissions. */
export async function inspectExternalReference(reference) {
  if (
    typeof reference !== 'string'
    || !path.isAbsolute(reference)
    || /[\x00-\x1F\x7F]/u.test(reference)
  ) {
    throw failure('PATH_ESCAPE', 'External file references must be explicit absolute paths.')
  }
  try {
    const handle = await fs.open(reference, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      if (!(await handle.stat()).isFile()) {
        throw failure(
          'INVALID_FILE',
          'An external reference must point to a readable regular file.',
        )
      }
    }
    finally {
      await handle.close()
    }
    return {
      path: reference,
      external: true,
      exists: true,
      regular: true,
      permissionsWarning: false,
    }
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      return {
        path: reference,
        external: true,
        exists: false,
        regular: false,
        permissionsWarning: false,
      }
    }
    throw error
  }
}

async function workspaceLocation(projectDir) {
  const project = await fs.realpath(path.resolve(projectDir))
  return { project, root: path.join(project, '.lazyapp') }
}

/** Read-only discovery: any existing target is reserved, including corrupt files and symbolic links. */
export async function workspaceExists(projectDir) {
  const { root } = await workspaceLocation(projectDir)
  return (await statOrNull(root)) !== null
}

async function acquireLock(root) {
  const target = path.join(root, LOCK_NAME)
  const owner = {
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  }
  let handle
  try {
    handle = await fs.open(target, 'wx', 0o600)
  }
  catch (error) {
    if (error.code !== 'EEXIST')
      throw error
    let existing = null
    try {
      const raw = JSON.parse((await readRegular(target)).toString('utf8'))
      if (
        Number.isSafeInteger(raw.pid)
        && typeof raw.hostname === 'string'
        && typeof raw.startedAt === 'string'
      ) {
        existing = { pid: raw.pid, hostname: raw.hostname, startedAt: raw.startedAt }
      }
    }
    catch {
      // A malformed or unreadable lock is still a lock, never permission to recover automatically.
      existing = null
    }
    const locked = failure(
      'WORKSPACE_LOCKED',
      `Workspace is locked at ${target}. Close its owning instance. If it terminated, verify the owner is no longer running before manually removing this lock; locks are never recovered automatically.`,
    )
    locked.owner = existing
    locked.path = target
    throw locked
  }
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`)
    await handle.sync()
  }
  catch (error) {
    await handle.close()
    await removeTemporary(target)
    throw error
  }
  await handle.close()
  return owner
}

async function createSession(root, owner, { lockMode = 'session', identity = null } = {}) {
  identity ??= await fs.lstat(root)
  let queue = Promise.resolve()
  let closing = false
  let closePromise

  async function checkRoot() {
    const current = await statOrNull(root)
    if (
      !current
      || !current.isDirectory()
      || current.isSymbolicLink()
      || current.dev !== identity.dev
      || current.ino !== identity.ino
    ) {
      throw failure(
        'PATH_ESCAPE',
        'Workspace directory changed or became a symlink. Close and reopen the workspace.',
      )
    }
  }

  async function targetPath(relative, createParents = false) {
    const parts = components(relative)
    await checkRoot()
    let target = root
    for (let index = 0; index < parts.length; index++) {
      target = path.join(target, parts[index])
      let entry = await statOrNull(target)
      const parent = index < parts.length - 1
      if (!entry && parent && createParents) {
        try {
          await fs.mkdir(target, { mode: 0o700 })
        }
        catch (error) {
          if (error.code !== 'EEXIST')
            throw error
        }
        entry = await fs.lstat(target)
      }
      if (entry?.isSymbolicLink()) {
        throw failure(
          'PATH_ESCAPE',
          `Symlink paths are not managed: ${relative}. Use an explicit external reference instead.`,
        )
      }
      if (entry && parent && !entry.isDirectory())
        throw failure('INVALID_FILE', `A parent component is not a directory: ${relative}.`)
      if (entry && !parent && !entry.isFile())
        throw failure('INVALID_FILE', `The target is not a regular file: ${relative}.`)
      if (entry && parent && (await fs.realpath(target)) !== target) {
        throw failure(
          'PATH_ESCAPE',
          `A parent directory resolves outside its expected location: ${relative}.`,
        )
      }
    }
    return target
  }

  function ensureOpen() {
    if (closing) {
      throw failure(
        'SESSION_CLOSED',
        'Workspace session is closing or closed; reopen before accessing it.',
      )
    }
  }

  async function ensureLock() {
    await checkRoot()
    let current
    try {
      current = JSON.parse((await readRegular(path.join(root, LOCK_NAME))).toString('utf8'))
    }
    catch {
      throw failure(
        'WORKSPACE_LOCKED',
        'Workspace lock was removed or changed; close and reopen before writing.',
      )
    }
    if (current.token !== owner.token) {
      throw failure(
        'WORKSPACE_LOCKED',
        'Workspace lock ownership changed; close and reopen before writing.',
      )
    }
  }

  async function releaseLock() {
    await ensureLock()
    await fs.unlink(path.join(root, LOCK_NAME))
    owner = null
  }

  if (lockMode === 'operation')
    await checkRoot()

  function serialize(operation, mutation = true) {
    ensureOpen()
    const pending = queue.then(async () => {
      await checkRoot()
      if (!mutation)
        return operation()
      if (lockMode === 'operation')
        owner = await acquireLock(root)
      try {
        await ensureLock()
        return await operation()
      }
      finally {
        if (lockMode === 'operation' && owner)
          await releaseLock()
      }
    })
    queue = pending.catch(() => undefined)
    return pending
  }

  async function readDocument(relative) {
    const target = await targetPath(relative)
    try {
      const bytes = await readRegular(target)
      return { data: parseDocument(bytes, relative), revision: revision(bytes) }
    }
    catch (error) {
      if (error.code === 'ENOENT')
        return { data: null, revision: null }
      throw error
    }
  }

  async function readBytes(relative) {
    const target = await targetPath(relative)
    try {
      const bytes = await readRegular(target)
      return { bytes, revision: revision(bytes), size: bytes.length }
    }
    catch (error) {
      if (error.code === 'ENOENT')
        return { bytes: null, revision: null, size: 0 }
      throw error
    }
  }

  function assertFilePath(relative) {
    components(relative)
    if (identifyDocument(relative.normalize('NFC').toLowerCase())) {
      throw failure(
        'INVALID_FILE',
        'Configuration documents must be changed through the document editor.',
      )
    }
  }

  async function checkByteRevision(relative, expectedRevision) {
    const current = await readBytes(relative)
    if (current.revision !== expectedRevision) {
      throw failure(
        'REVISION_CONFLICT',
        'The file changed on disk; reload before writing. No data was overwritten.',
      )
    }
    return current
  }

  async function replace(relative, prepare, beforeCommit, overwrite) {
    const target = await targetPath(relative, true)
    const temporary = path.join(path.dirname(target), `${TEMP_PREFIX}${randomUUID()}`)
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      try {
        await prepare(handle)
        await handle.sync()
      }
      finally {
        await handle.close()
      }
      await targetPath(relative)
      await ensureLock()
      await beforeCommit()
      if (overwrite) {
        await fs.rename(temporary, target)
      }
      else {
        try {
          await fs.link(temporary, target)
        }
        catch (error) {
          if (error.code === 'EEXIST') {
            throw failure(
              'FILE_EXISTS',
              `A file already exists at ${relative}; confirm overwrite or choose a different name.`,
            )
          }
          throw error
        }
      }
    }
    finally {
      await removeTemporary(temporary)
    }
  }

  async function walk(directory, prefix, visit) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name === LOCK_NAME || entry.name.startsWith(TEMP_PREFIX))
        continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const target = path.join(directory, entry.name)
      const info = await fs.lstat(target)
      if (info.isSymbolicLink()) {
        throw failure(
          'PATH_ESCAPE',
          `Workspace contains a symlink at ${relative}; remove it or use an explicit external reference.`,
        )
      }
      if (!info.isFile() && !info.isDirectory())
        throw failure('INVALID_FILE', `Workspace contains a nonregular entry at ${relative}.`)
      await visit(relative, info)
      if (info.isDirectory()) {
        if ((await fs.realpath(target)) !== target)
          throw failure('PATH_ESCAPE', `Workspace directory changed at ${relative}.`)
        await walk(target, relative, visit)
      }
    }
  }

  return {
    root,
    async read(relative) {
      return serialize(() => readDocument(relative), false)
    },
    async readBytes(relative) {
      return serialize(() => readBytes(relative), false)
    },
    async writeBytes(relative, bytes, expectedRevision) {
      assertFilePath(relative)
      if (!Buffer.isBuffer(bytes))
        throw failure('INVALID_FILE', 'File contents must be a byte buffer.')
      return serialize(async () => {
        const original = await checkByteRevision(relative, expectedRevision)
        await replace(
          relative,
          handle => handle.writeFile(bytes),
          () => checkByteRevision(relative, expectedRevision),
          original.revision !== null,
        )
        return { revision: revision(bytes), size: bytes.length }
      })
    },
    async removeBytes(relative, expectedRevision) {
      assertFilePath(relative)
      return serialize(async () => {
        const current = await checkByteRevision(relative, expectedRevision)
        if (current.revision === null)
          throw failure('ENOENT', 'The requested file does not exist.')
        const target = await targetPath(relative)
        await ensureLock()
        await checkByteRevision(relative, expectedRevision)
        await fs.unlink(target)
      })
    },
    async save(relative, data, expectedRevision) {
      const encoded = encodeDocument(data, relative)
      return serialize(async () => {
        const original = await readDocument(relative)
        const check = async () => {
          const current = await readDocument(relative)
          if (current.revision !== expectedRevision) {
            throw failure(
              'REVISION_CONFLICT',
              `The document changed on disk at ${relative}; reload before saving. No data was overwritten.`,
            )
          }
        }
        await check()
        await replace(
          relative,
          handle => handle.writeFile(encoded),
          check,
          original.revision !== null,
        )
        return { data: JSON.parse(encoded), revision: revision(encoded) }
      })
    },
    async list() {
      return serialize(async () => {
        const files = []
        await walk(root, '', async (relative, info) => {
          if (info.isFile() && !relative.split('/').some(part => part.startsWith('.')))
            files.push(relative)
        })
        return files.sort()
      }, false)
    },
    async importFile(source, destination, { overwrite = false, expectedRevision } = {}) {
      return serialize(async () => {
        if (destination === 'app.json') {
          throw failure(
            'INVALID_FILE',
            'App metadata must be saved as a versioned document, not replaced through file import.',
          )
        }
        const absoluteSource = path.resolve(source)
        const sourceHandle = await fs.open(
          absoluteSource,
          constants.O_RDONLY | constants.O_NONBLOCK,
        )
        try {
          const sourceInfo = await sourceHandle.stat()
          if (!sourceInfo.isFile())
            throw failure('INVALID_FILE', 'Import source must be a readable regular file.')
          const destinationPath = await targetPath(destination)
          const existing = await statOrNull(destinationPath)
          if (expectedRevision !== undefined)
            await checkByteRevision(destination, expectedRevision)
          if (existing && sourceInfo.dev === existing.dev && sourceInfo.ino === existing.ino) {
            throw failure(
              'INVALID_FILE',
              'Source and destination refer to the same file; choose a different destination.',
            )
          }
          if (existing && !overwrite) {
            throw failure(
              'FILE_EXISTS',
              `A file already exists at ${destination}; explicit overwrite confirmation is required.`,
            )
          }
          const check = async () => {
            if (expectedRevision !== undefined)
              await checkByteRevision(destination, expectedRevision)
            const current = await statOrNull(await targetPath(destination))
            if (!overwrite && current) {
              throw failure(
                'FILE_EXISTS',
                `A file already exists at ${destination}; explicit overwrite confirmation is required.`,
              )
            }
          }
          await replace(
            destination,
            async (handle) => {
              const buffer = Buffer.allocUnsafe(64 * 1024)
              while (true) {
                const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, null)
                if (bytesRead === 0)
                  break
                let offset = 0
                while (offset < bytesRead) {
                  const { bytesWritten } = await handle.write(
                    buffer,
                    offset,
                    bytesRead - offset,
                    null,
                  )
                  if (bytesWritten === 0) {
                    throw failure(
                      'EIO',
                      'Import could not write file contents; the original destination was not changed.',
                    )
                  }
                  offset += bytesWritten
                }
              }
            },
            check,
            overwrite && Boolean(existing),
          )
          return destination
        }
        finally {
          await sourceHandle.close()
        }
      })
    },
    async removeFile(relative, expectedRevision) {
      return serialize(async () => {
        if (relative === 'app.json') {
          throw failure(
            'INVALID_FILE',
            'The workspace app.json cannot be deleted through file management.',
          )
        }
        const target = await targetPath(relative)
        if (expectedRevision !== undefined)
          await checkByteRevision(relative, expectedRevision)
        const current = await statOrNull(target)
        if (!current)
          throw Object.assign(new Error(`File not found: ${relative}`), { code: 'ENOENT' })
        if (!current.isFile() || current.isSymbolicLink()) {
          throw failure(
            'INVALID_FILE',
            'Only explicitly selected internal regular files can be deleted.',
          )
        }
        await ensureLock()
        if (expectedRevision !== undefined)
          await checkByteRevision(relative, expectedRevision)
        await fs.unlink(target)
      })
    },
    async inspectReference(reference) {
      return serialize(async () => {
        if (path.isAbsolute(reference))
          return inspectExternalReference(reference)
        const target = await targetPath(reference)
        const entry = await statOrNull(target)
        if (entry)
          await fs.access(target, constants.R_OK)
        return {
          path: reference,
          external: false,
          exists: Boolean(entry),
          regular: Boolean(entry?.isFile()),
          permissionsWarning: Boolean(entry && process.platform !== 'win32' && entry.mode & 0o077),
        }
      }, false)
    },
    async permissionWarnings() {
      return serialize(async () => {
        if (process.platform === 'win32')
          return []
        const warnings = []
        const inspect = async (relative, info) => {
          if (info.mode & 0o077) {
            warnings.push({
              path: relative,
              label: 'Permissions allow group or other users access; review permissions manually.',
            })
          }
        }
        await inspect('.', await fs.lstat(root))
        await walk(root, '', inspect)
        return warnings
      }, false)
    },
    close() {
      if (closePromise)
        return closePromise
      closing = true
      closePromise = queue.then(async () => {
        if (lockMode === 'session')
          await releaseLock()
      })
      return closePromise
    },
  }
}

/** Open only projectDir/.lazyapp. Operation mode defers exclusive locking until each mutation. */
export async function openWorkspace(projectDir, { lockMode = 'session' } = {}) {
  if (!['session', 'operation'].includes(lockMode))
    throw failure('INVALID_DOCUMENT', 'Unsupported workspace locking mode.')
  const { root } = await workspaceLocation(projectDir)
  const info = await statOrNull(root)
  if (!info) {
    throw failure(
      'WORKSPACE_MISSING',
      `No workspace exists at ${root}. Initialize only after confirmation.`,
    )
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw failure(
      'WORKSPACE_CONFLICT',
      `The path ${root} already exists and is not a regular workspace directory. Choose another project or move the conflicting path.`,
    )
  }
  const appPath = path.join(root, 'app.json')
  const appInfo = await statOrNull(appPath)
  if (!appInfo || !appInfo.isFile() || appInfo.isSymbolicLink()) {
    throw failure(
      'WORKSPACE_CONFLICT',
      `The existing directory ${root} has no regular app.json; it will not be adopted or overwritten.`,
    )
  }
  parseDocument(await readRegular(appPath), 'app.json')
  const owner = lockMode === 'session' ? await acquireLock(root) : null
  return createSession(root, owner, { lockMode, identity: info })
}

/**
 * Commit a new workspace from a private sibling staging directory only after final confirmation.
 * Documents, imports, and inactive examples are prepared before publication. Existing directories are never adopted.
 */
export async function initializeWorkspace(
  projectDir,
  app,
  { documents = [], imports = [], examples = [] } = {},
) {
  const { project, root } = await workspaceLocation(projectDir)
  encodeDocument(app, 'app.json')
  if (await statOrNull(root)) {
    throw failure(
      'WORKSPACE_CONFLICT',
      `The path ${root} already exists; initialization will not overwrite it.`,
    )
  }
  for (const example of examples) {
    components(example.path)
    if (!example.path.endsWith('.example')) {
      throw failure(
        'INVALID_DOCUMENT',
        'Initialization examples must use an inactive .example filename.',
      )
    }
  }
  const paths = new Set(['app.json'])
  for (const item of [
    ...documents.map(document => ({ destination: document.path })),
    ...imports,
    ...examples.map(example => ({ destination: example.path })),
  ]) {
    components(item.destination)
    const normalized = item.destination.normalize('NFC').toLowerCase()
    if (paths.has(normalized)) {
      throw failure(
        'FILE_EXISTS',
        `Initialization contains duplicate destination ${item.destination}.`,
      )
    }
    paths.add(normalized)
  }
  for (const document of documents) encodeDocument(document.data, document.path)
  for (const example of examples) encodeDocument(example.data, example.path)
  const stage = await fs.mkdtemp(path.join(project, '.lazyapp-stage-'))
  await fs.chmod(stage, 0o700)
  let stagingSession
  let committed = false
  try {
    const owner = await acquireLock(stage)
    stagingSession = await createSession(stage, owner)
    await stagingSession.save('app.json', app, null)
    for (const document of documents) await stagingSession.save(document.path, document.data, null)
    for (const example of examples) await stagingSession.save(example.path, example.data, null)
    for (const item of imports) await stagingSession.importFile(item.source, item.destination)
    const ignore = await fs.open(path.join(stage, '.gitignore'), 'wx', 0o600)
    try {
      await ignore.writeFile('*\n')
      await ignore.sync()
    }
    finally {
      await ignore.close()
    }
    // Reserve the destination exclusively. This also prevents rename from replacing an existing empty directory.
    let reserved = false
    try {
      await fs.mkdir(root, { mode: 0o700 })
      reserved = true
    }
    catch (error) {
      if (error.code === 'EEXIST') {
        throw failure(
          'WORKSPACE_CONFLICT',
          `The path ${root} appeared during initialization; nothing was overwritten.`,
        )
      }
      throw error
    }
    if (process.platform === 'win32') {
      // Windows rename cannot replace any existing directory, so release our empty reservation first.
      try {
        await fs.rmdir(root)
      }
      catch (error) {
        // ENOENT: already released. ENOTEMPTY or EEXIST: another writer claimed the path; the
        // rename below fails against it and reports the conflict without touching their contents.
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST')
          throw error
      }
      reserved = false
    }
    try {
      await fs.rename(stage, root)
    }
    catch (error) {
      if (reserved) {
        try {
          await fs.rmdir(root)
        }
        catch (cleanup) {
          // Never mask the rename failure with reservation cleanup noise.
          if (
            cleanup.code !== 'ENOENT'
            && cleanup.code !== 'ENOTEMPTY'
            && cleanup.code !== 'EEXIST'
          ) {
            throw error
          }
        }
      }
      if (await statOrNull(root)) {
        throw failure(
          'WORKSPACE_CONFLICT',
          `The path ${root} appeared during initialization; nothing was overwritten.`,
        )
      }
      throw error
    }
    committed = true
    return await createSession(root, owner)
  }
  finally {
    if (!committed) {
      if (stagingSession)
        await stagingSession.close()
      await fs.rm(stage, { recursive: true, force: true })
    }
  }
}
