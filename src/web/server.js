/* global LAZYAPP_COMPILED */
import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { documentFields, documentKinds, documentPath, identifyDocument, isSafeName, platformKinds } from '../config/model.js'
import { loadDocuments, logicalFiles, runDoctor, safeErrorMessage, saveDocument } from '../features/workspace.js'
import { openWorkspace } from '../storage/workspace.js'

const JSON_LIMIT = 1024 * 1024
const FILE_LIMIT = 32 * 1024 * 1024
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/scroll.js', ['scroll.js', 'text/javascript; charset=utf-8']],
  ['/virtual-list.js', ['virtual-list.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/icons.css', ['icons.css', 'text/css; charset=utf-8']],
])
const HTTP_ERRORS = {
  BAD_REQUEST: [400, 'The request is not valid.'],
  FORBIDDEN: [403, 'This request is not authorized for this local workspace.'],
  NOT_FOUND: [404, 'The requested resource does not exist.'],
  METHOD_NOT_ALLOWED: [405, 'This method is not supported.'],
  PAYLOAD_TOO_LARGE: [413, 'The request body exceeds the supported size limit.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'JSON requests require application/json.'],
}

function failure(code) {
  return Object.assign(new Error(code), { code })
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}

function body(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    let settled = false
    const fail = (code) => {
      if (!settled) {
        settled = true
        chunks.length = 0
        reject(failure(code))
      }
    }
    const onError = () => fail('BAD_REQUEST')
    const onClose = () => {
      fail('BAD_REQUEST')
      cleanup()
    }
    const onEnd = () => {
      if (!settled) {
        settled = true
        resolve(Buffer.concat(chunks, length))
      }
      cleanup()
    }
    const onData = (chunk) => {
      if (settled)
        return
      length += chunk.length
      if (length > limit) {
        fail('PAYLOAD_TOO_LARGE')
        return
      }
      chunks.push(chunk)
    }
    function cleanup() {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onError)
      request.off('close', onClose)
    }
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onError)
    request.once('close', onClose)
    if (Number(request.headers['content-length']) > limit)
      fail('PAYLOAD_TOO_LARGE')
  })
}

async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw failure('UNSUPPORTED_MEDIA_TYPE')
  const bytes = await body(request, JSON_LIMIT)
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw failure('BAD_REQUEST')
    return value
  }
  catch {
    throw failure('BAD_REQUEST')
  }
}

function expectedRevision(value) {
  if (value === null || value === 'null')
    return null
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw failure('BAD_REQUEST')
  return value
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096
    || path.isAbsolute(value) || /[\\:\x00-\x1F\x7F]/u.test(value)
    || value.split('/').some(part => !part || part.startsWith('.'))) {
    throw Object.assign(new Error('Unsafe workspace path'), { code: 'PATH_ESCAPE' })
  }
  return value
}

// Absolute references beneath this workspace share its existing safe relative-path checks.
// This mapping is for reads only; writes still require explicit relative paths.
function internalReference(value, root) {
  return typeof value === 'string' && value.startsWith(`${root}${path.sep}`)
    ? path.relative(root, value).split(path.sep).join('/')
    : value
}

function documentInfo(relative) {
  relativePath(relative)
  const info = identifyDocument(relative)
  if (!info)
    throw failure('NOT_FOUND')
  return info
}

function rasterType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg'
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    return 'image/gif'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  return null
}

async function state(session) {
  const documents = await loadDocuments(session, { includeExamples: true })
  const byPath = new Map(documents.map(document => [document.path, document]))
  const app = byPath.get('app.json')?.data
  const environments = Array.isArray(app?.environments) ? app.environments.filter(isSafeName) : []
  const suggestions = [documentPath('app'), documentPath('assets')]
  for (const kind of platformKinds) {
    suggestions.push(documentPath(kind))
    for (const environment of environments)
      suggestions.push(documentPath(kind, { environment }))
  }
  for (const name of environments)
    suggestions.push(documentPath('environment', { name }))
  for (const relative of suggestions) {
    if (!byPath.has(relative))
      byPath.set(relative, { path: relative, ...identifyDocument(relative), data: null, revision: null, missing: true })
  }
  const files = new Map(logicalFiles(await session.list())
    .filter(entry => !identifyDocument(entry.path))
    .map(entry => [entry.path, entry]))
  for (const document of byPath.values()) {
    if (!document.data)
      continue
    for (const field of documentFields(document.kind, { scope: document.scope })) {
      const reference = document.data[field.key]
      if (field.type !== 'file' || typeof reference !== 'string' || !reference || files.has(reference))
        continue
      const filePath = internalReference(reference, session.root)
      if (files.has(filePath))
        continue
      try {
        const info = await session.inspectReference(filePath)
        files.set(filePath, { ...info, file: true, missing: !info.exists })
      }
      catch {
        files.set(reference, { path: reference, file: true, missing: true, external: path.isAbsolute(reference), unsafe: true })
      }
    }
  }
  const fields = Object.fromEntries(documentKinds.map(kind => [kind, Object.fromEntries(['all', 'platform', 'signing'].map(scope => [scope, documentFields(kind, { scope, language: 'zh' })]))]))
  return {
    root: session.root,
    documents: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    fields,
    kinds: documentKinds,
    platforms: platformKinds,
    environments,
  }
}

/** Serve one existing workspace, bound exclusively to the IPv4 loopback interface. */
export async function startWebServer(projectDir, { port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw failure('BAD_REQUEST')
  const session = await openWorkspace(projectDir, { lockMode: 'operation' })
  const token = randomBytes(32).toString('base64url')
  const tokenBytes = Buffer.from(token)
  const staticRoot = typeof LAZYAPP_COMPILED !== 'undefined' && LAZYAPP_COMPILED
    ? pathToFileURL(`${path.join(path.dirname(process.execPath), 'web')}${path.sep}`)
    : new URL('./public/', import.meta.url)
  const active = new Set()
  let url
  let host
  let closing = false
  let closePromise

  const server = createServer((request, response) => {
    const work = handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      const known = HTTP_ERRORS[error?.code]
      const status = known?.[0] ?? ({
        REVISION_CONFLICT: 409,
        WORKSPACE_LOCKED: 409,
        FILE_EXISTS: 409,
        PATH_ESCAPE: 403,
        ENOENT: 404,
        VALIDATION_FAILED: 422,
        INVALID_DOCUMENT: 422,
        INVALID_FILE: 422,
        INVALID_JSON: 422,
        UNSUPPORTED_SCHEMA: 422,
        SESSION_CLOSED: 503,
      }[error?.code] ?? 500)
      if (status === 413)
        response.setHeader('Connection', 'close')
      json(response, status, {
        code: known || status !== 500 ? error.code : 'INTERNAL_ERROR',
        message: known?.[1] ?? safeErrorMessage(error, 'zh'),
        ...(error?.code === 'VALIDATION_FAILED' ? { issues: error.issues } : {}),
      })
    }).finally(() => active.delete(work))
    active.add(work)
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000

  async function handle(request, response) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Content-Security-Policy', 'default-src \'none\'; script-src \'self\'; style-src \'self\'; img-src \'self\' blob: data:; connect-src \'self\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'; object-src \'none\'')
    if (closing)
      throw Object.assign(new Error('Closing'), { code: 'SESSION_CLOSED' })
    if (request.headers.host !== host || request.headersDistinct?.host?.length > 1)
      throw failure('FORBIDDEN')
    if (request.headers.origin !== undefined && request.headers.origin !== url)
      throw failure('FORBIDDEN')
    if (request.headers['sec-fetch-site'] === 'cross-site')
      throw failure('FORBIDDEN')
    if (!request.url?.startsWith('/') || request.url.startsWith('//'))
      throw failure('BAD_REQUEST')
    const target = new URL(request.url, url)
    const method = request.method
    const mutation = !['GET', 'HEAD'].includes(method)
    if (mutation && request.headers.origin !== url)
      throw failure('FORBIDDEN')
    if (!target.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD')
        throw failure('METHOD_NOT_ALLOWED')
      const entry = STATIC_FILES.get(target.pathname)
      if (!entry)
        throw failure('NOT_FOUND')
      const bytes = await readFile(new URL(entry[0], staticRoot))
      response.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': bytes.length })
      response.end(method === 'HEAD' ? undefined : bytes)
      return
    }
    if (target.pathname === '/api/session') {
      if (method !== 'GET')
        throw failure('METHOD_NOT_ALLOWED')
      json(response, 200, { token })
      return
    }
    const supplied = request.headers['x-lazyapp-token']
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== tokenBytes.length
      || !timingSafeEqual(Buffer.from(supplied), tokenBytes)) {
      throw failure('FORBIDDEN')
    }
    if (target.pathname === '/api/state' && method === 'GET') {
      json(response, 200, await state(session))
      return
    }
    if (target.pathname === '/api/doctor' && method === 'GET') {
      json(response, 200, { results: await runDoctor(session, 'zh') })
      return
    }
    if (target.pathname === '/api/document') {
      if (method === 'GET') {
        const relative = target.searchParams.get('path')
        const info = documentInfo(relative)
        const snapshot = await session.read(relative)
        json(response, 200, { path: relative, ...info, ...snapshot, missing: snapshot.data === null })
        return
      }
      if (method === 'PUT') {
        const input = await jsonBody(request)
        const info = documentInfo(input.path)
        const saved = await saveDocument(session, input.path, info.kind, input.data, expectedRevision(input.revision))
        json(response, 200, { path: input.path, ...info, ...saved, missing: false })
        return
      }
      if (method === 'DELETE') {
        const input = await jsonBody(request)
        documentInfo(input.path)
        await session.removeFile(input.path, expectedRevision(input.revision))
        json(response, 200, { deleted: true })
        return
      }
      throw failure('METHOD_NOT_ALLOWED')
    }
    if (target.pathname === '/api/file-info' && method === 'GET') {
      const file = await session.readBytes(relativePath(target.searchParams.get('path')))
      json(response, 200, { revision: file.revision, size: file.size })
      return
    }
    if (target.pathname === '/api/file') {
      if (method === 'GET') {
        const relative = relativePath(internalReference(target.searchParams.get('path'), session.root))
        const file = await session.readBytes(relative)
        if (file.bytes === null)
          throw failure('NOT_FOUND')
        const type = rasterType(file.bytes)
        const inline = type && target.searchParams.get('download') !== '1'
        const filename = encodeURIComponent(path.basename(relative)).replace(/['()*]/gu, character => `%${character.charCodeAt(0).toString(16)}`)
        response.writeHead(200, {
          'Content-Type': inline ? type : 'application/octet-stream',
          'Content-Length': file.size,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${filename}`,
          'Content-Security-Policy': 'default-src \'none\'; sandbox',
        })
        response.end(file.bytes)
        return
      }
      if (method === 'PUT') {
        const relative = relativePath(target.searchParams.get('path'))
        const revision = expectedRevision(target.searchParams.get('revision') ?? undefined)
        const bytes = await body(request, FILE_LIMIT)
        json(response, 200, await session.writeBytes(relative, bytes, revision))
        return
      }
      if (method === 'DELETE') {
        const input = await jsonBody(request)
        await session.removeBytes(relativePath(input.path), expectedRevision(input.revision))
        json(response, 200, { deleted: true })
        return
      }
      throw failure('METHOD_NOT_ALLOWED')
    }
    if (['/api/state', '/api/doctor', '/api/file-info'].includes(target.pathname))
      throw failure('METHOD_NOT_ALLOWED')
    throw failure('NOT_FOUND')
  }

  try {
    for (;;) {
      try {
        await new Promise((resolve, reject) => {
          function onError(error) {
            server.off('listening', onListening)
            reject(error)
          }
          function onListening() {
            server.off('error', onError)
            resolve()
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, '127.0.0.1')
        })
        break
      }
      catch (error) {
        if (error.code !== 'EADDRINUSE' || port === 0 || port === 65535)
          throw error
        port++
      }
    }
    url = `http://127.0.0.1:${server.address().port}`
    host = new URL(url).host
  }
  catch (error) {
    await session.close()
    throw error
  }
  return {
    server,
    url,
    close() {
      if (!closePromise) {
        closing = true
        closePromise = (async () => {
          try {
            await new Promise((resolve, reject) => server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()))
            await Promise.allSettled([...active])
          }
          finally {
            await session.close()
          }
        })()
      }
      return closePromise
    },
  }
}
