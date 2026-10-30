import { Buffer } from 'node:buffer'
import * as fs from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Application } from '../src/app/controller.js'
import { startWeb } from '../src/app/web.js'
import { initializeWorkspace, openWorkspace } from '../src/storage/workspace.js'
import { startWebServer } from '../src/web/server.js'
import { afterEach, beforeEach, describe, expect, test } from '../support/node-test.js'

const APP = { schemaVersion: 1, name: 'Web example', platforms: ['android'], environments: ['preview'] }
let project
let services
let sessions

beforeEach(async () => {
  project = await fs.mkdtemp(path.join(tmpdir(), 'lazyapp-web-'))
  services = []
  sessions = []
})

afterEach(async () => {
  try {
    for (const service of services) await service.close()
    for (const session of sessions) await session.close()
  }
  finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

async function initialize(options) {
  const initial = await initializeWorkspace(project, APP, options)
  await initial.close()
}

async function start() {
  const service = await startWebServer(project)
  services.push(service)
  const response = await fetch(`${service.url}/api/session`)
  const { token } = await response.json()
  return {
    ...service,
    token,
    call(route, options = {}) {
      return fetch(`${service.url}${route}`, {
        ...options,
        headers: { 'X-Lazyapp-Token': token, 'Origin': service.url, ...options.headers },
      })
    },
  }
}

function raw(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

function putDocument(client, snapshot, data) {
  return client.call('/api/document', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: snapshot.path, revision: snapshot.revision, data }),
  })
}

describe('local web workspace service', () => {
  test('missing startup does not create or adopt anything', async () => {
    await expect(startWebServer(project)).rejects.toMatchObject({ code: 'WORKSPACE_MISSING' })
    expect(await fs.readdir(project)).toEqual([])
    await fs.mkdir(path.join(project, '.lazyapp'))
    await fs.writeFile(path.join(project, '.lazyapp/keep'), 'original')
    await expect(startWebServer(project)).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    expect(await fs.readdir(path.join(project, '.lazyapp'))).toEqual(['keep'])
  })

  test('serves only local static assets and fills missing canonical documents in older workspaces', async () => {
    await initialize()
    const client = await start()
    for (const [route, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/scroll.js', 'text/javascript'], ['/virtual-list.js', 'text/javascript'], ['/style.css', 'text/css']]) {
      const response = await fetch(`${client.url}${route}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain(type)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-security-policy')).toContain('default-src \'none\'')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    }
    expect((await fetch(`${client.url}/server.js`)).status).toBe(404)
    const state = await (await client.call('/api/state')).json()
    expect(state.documents).toContainEqual(expect.objectContaining({ path: 'assets/config.json', missing: true, revision: null }))
    expect(state.documents).toContainEqual(expect.objectContaining({ path: 'platforms/android/config.json', scope: 'platform', missing: true }))
    expect(state.documents).toContainEqual(expect.objectContaining({ path: 'platforms/android/preview/config.json', scope: 'signing', missing: true }))
    expect(state.documents).toContainEqual(expect.objectContaining({ path: 'environments/preview.json', missing: true }))
    const created = await putDocument(client, { path: 'assets/config.json', revision: null }, { schemaVersion: 1, waiver: 'assets/waiver.pdf' })
    expect(created.status).toBe(200)
    expect((await created.json()).missing).toBe(false)
    expect((await client.call('/api/doctor')).status).toBe(200)
  })

  test('rejects missing tokens, rebinding Hosts, foreign Origins and missing mutation Origins', async () => {
    await initialize()
    const client = await start()
    expect((await fetch(`${client.url}/api/state`)).status).toBe(403)
    expect((await raw(`${client.url}/api/session`, { headers: { Host: 'attacker.invalid' } })).status).toBe(403)
    expect((await raw(`${client.url}/`, { headers: { Host: 'localhost' } })).status).toBe(403)
    expect((await client.call('/api/state', { headers: { Origin: 'https://attacker.invalid' } })).status).toBe(403)
    expect((await fetch(`${client.url}/api/session`, { headers: { Origin: 'null' } })).status).toBe(403)
    expect((await raw(`${client.url}/api/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
    const response = await raw(`${client.url}/api/file?path=assets/test.bin&revision=null`, {
      method: 'PUT',
      headers: { 'X-Lazyapp-Token': client.token },
      body: 'not written',
    })
    expect(response.status).toBe(403)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(await fs.readdir(path.join(project, '.lazyapp'))).not.toContain('assets')
  })

  test('two live servers coexist and stale document saves conflict without replacing originals', async () => {
    await initialize()
    const first = await start()
    const second = await start()
    expect(first.token).not.toBe(second.token)
    const a = await (await first.call('/api/document?path=app.json')).json()
    const b = await (await second.call('/api/document?path=app.json')).json()
    expect((await putDocument(first, a, { ...a.data, name: 'First editor', futureField: { retained: true } })).status).toBe(200)
    const stale = await putDocument(second, b, { ...b.data, name: 'Stale editor' })
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe('REVISION_CONFLICT')
    const current = await (await second.call('/api/document?path=app.json')).json()
    expect(current.data.name).toBe('First editor')
    expect(current.data.futureField).toEqual({ retained: true })
    expect(await fs.readdir(path.join(project, '.lazyapp'))).not.toContain('.lazyapp.lock')
    await first.close()
    expect((await second.call('/api/state')).status).toBe(200)
  })

  test('configuration deletion protects App metadata and rejects a stale editor revision', async () => {
    await initialize({ documents: [{ path: 'services/push.json', data: { schemaVersion: 1, name: 'Push' } }] })
    const client = await start()
    const snapshot = await (await client.call('/api/document?path=services/push.json')).json()
    expect((await putDocument(client, snapshot, { ...snapshot.data, name: 'Updated' })).status).toBe(200)
    const remove = (path, revision) => client.call('/api/document', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, revision }),
    })
    expect((await remove(snapshot.path, snapshot.revision)).status).toBe(409)
    const latest = await (await client.call('/api/document?path=services/push.json')).json()
    expect(latest.data.name).toBe('Updated')
    expect((await remove(latest.path, latest.revision)).status).toBe(200)
    expect((await (await client.call('/api/document?path=services/push.json')).json()).data).toBeNull()
    const app = await (await client.call('/api/document?path=app.json')).json()
    expect((await remove(app.path, app.revision)).status).toBe(422)
    expect((await (await client.call('/api/document?path=app.json')).json()).data).toEqual(APP)
  })

  test('binary and credential JSON bytes round-trip with optimistic overwrite and delete', async () => {
    await initialize()
    const client = await start()
    const route = '/api/file?path=assets/credential.json'
    const bytes = Buffer.from([0, 255, 17, 128, 13, 10, 0, 42])
    expect(await (await client.call('/api/file-info?path=assets/credential.json')).json()).toEqual({ revision: null, size: 0 })
    const upload = await client.call(`${route}&revision=null`, { method: 'PUT', body: bytes })
    expect(upload.status).toBe(200)
    const initial = await upload.json()
    expect(initial.size).toBe(bytes.length)
    const downloaded = await client.call(route)
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes)
    expect(downloaded.headers.get('content-disposition')).toContain('attachment')
    expect((await client.call(`${route}&revision=null`, { method: 'PUT', body: 'stale' })).status).toBe(409)
    const replacement = '{"private_key":"fictional credential"}'
    const updated = await (await client.call(`${route}&revision=${initial.revision}`, { method: 'PUT', body: replacement })).json()
    const staleDelete = await client.call('/api/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/credential.json', revision: initial.revision }),
    })
    expect(staleDelete.status).toBe(409)
    expect(await (await client.call(route)).text()).toBe(replacement)
    expect((await client.call('/api/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/credential.json', revision: updated.revision }),
    })).status).toBe(200)
    expect((await client.call(route)).status).toBe(404)
    expect((await client.call(route, { method: 'PUT', body: 'missing revision' })).status).toBe(400)
  })

  test('denies traversal, hidden paths, symlinks, external downloads and configuration byte replacement', async () => {
    const outside = path.join(project, 'outside-secret')
    await fs.writeFile(outside, 'fictional external secret')
    await initialize({ documents: [{ path: 'assets/config.json', data: { schemaVersion: 1, icon: outside } }] })
    const client = await start()
    const original = await fs.readFile(path.join(project, '.lazyapp/app.json'))
    for (const value of ['../outside-secret', outside, 'assets/../../outside-secret', '.gitignore', 'assets/hidden/../file', 'assets\\file', 'C:/secret']) {
      expect((await client.call(`/api/file?path=${encodeURIComponent(value)}`)).status).toBe(403)
      expect((await client.call(`/api/file?path=${encodeURIComponent(value)}&revision=null`, { method: 'PUT', body: 'bad' })).status).toBe(403)
    }
    await fs.symlink(outside, path.join(project, '.lazyapp/link'))
    expect((await client.call('/api/file?path=link')).status).toBe(403)
    await fs.unlink(path.join(project, '.lazyapp/link'))
    for (const relative of ['app.json', 'APP.JSON', 'assets/config.json', 'platforms/android/config.json', 'services/push.json']) {
      expect((await client.call(`/api/file?path=${relative}&revision=null`, { method: 'PUT', body: 'not configuration JSON' })).status).toBe(422)
    }
    expect(await fs.readFile(path.join(project, '.lazyapp/app.json'))).toEqual(original)
    const state = await (await client.call('/api/state')).json()
    expect(state.files).toContainEqual(expect.objectContaining({ path: outside, external: true, missing: false }))
    expect(await fs.readFile(outside, 'utf8')).toBe('fictional external secret')
  })

  test('absolute references inside the workspace preview without exposing external paths or allowing absolute writes', async () => {
    await initialize()
    const root = await fs.realpath(path.join(project, '.lazyapp'))
    const relative = 'assets/icon/source.png'
    const absolute = path.join(root, relative)
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, bytes)
    const client = await start()
    expect((await putDocument(client, { path: 'assets/config.json', revision: null }, { schemaVersion: 1, icon: absolute })).status).toBe(200)
    const route = `/api/file?path=${encodeURIComponent(absolute)}`
    const response = await client.call(route)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('inline')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    const state = await (await client.call('/api/state')).json()
    expect(state.files.filter(file => file.path === absolute)).toEqual([])
    expect(state.files).toContainEqual(expect.objectContaining({ path: relative, missing: false }))
    expect((await client.call(`${route}&revision=null`, { method: 'PUT', body: 'bad' })).status).toBe(403)
    expect((await client.call('/api/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absolute, revision: null }),
    })).status).toBe(403)
    const outside = path.join(project, 'outside.png')
    await fs.writeFile(outside, bytes)
    await fs.symlink(outside, path.join(root, 'assets/escape.png'))
    for (const unsafe of [outside, `${root}-other/image.png`, path.join(root, 'assets/escape.png'), `${root}/../outside.png`]) {
      expect((await client.call(`/api/file?path=${encodeURIComponent(unsafe)}`)).status).toBe(403)
    }
    expect(await fs.readFile(absolute)).toEqual(bytes)
  })

  test('only byte-sniffed raster files preview inline; HTML and SVG always download', async () => {
    await initialize()
    const client = await start()
    const cases = [
      ['fake.png', Buffer.from('<html><script>alert(1)</script></html>'), false],
      ['drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), false],
      ['image.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), true],
    ]
    for (const [name, bytes, inline] of cases) {
      const route = `/api/file?path=assets/${name}`
      expect((await client.call(`${route}&revision=null`, { method: 'PUT', body: bytes })).status).toBe(200)
      const response = await client.call(route)
      expect(response.headers.get('content-disposition')).toContain(inline ? 'inline' : 'attachment')
      expect(response.headers.get('content-type')).toBe(inline ? 'image/png' : 'application/octet-stream')
      expect((await client.call(`${route}&download=1`)).headers.get('content-disposition')).toContain('attachment')
    }
  })

  test('rejects invalid and oversized requests before touching originals without echoing secrets', async () => {
    await initialize()
    const client = await start()
    const original = await fs.readFile(path.join(project, '.lazyapp/app.json'))
    const invalid = await client.call('/api/document', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"secret":"do-not-echo",',
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).not.toContain('do-not-echo')
    const oversizedJson = await raw(`${client.url}/api/document`, {
      method: 'PUT',
      headers: {
        'Origin': client.url,
        'X-Lazyapp-Token': client.token,
        'Content-Type': 'application/json',
        'Content-Length': String(1024 * 1024 + 1),
      },
    })
    expect(oversizedJson.status).toBe(413)
    const oversized = await raw(`${client.url}/api/file?path=assets/large.bin&revision=null`, {
      method: 'PUT',
      headers: { 'Origin': client.url, 'X-Lazyapp-Token': client.token, 'Content-Length': String(32 * 1024 * 1024 + 1) },
    })
    expect(oversized.status).toBe(413)
    expect(await fs.readFile(path.join(project, '.lazyapp/app.json'))).toEqual(original)
    expect(await fs.readdir(path.join(project, '.lazyapp'))).not.toContain('assets')
  })
  test('TUI-owned Web service starts once and closes with the application', async () => {
    await initialize()
    const app = new Application(project, () => {}, () => {})
    expect(await startWeb(app, 0)).toBe(true)
    const first = app.webService
    expect(app.state.webUrl).toBe(first.url)
    expect((await fetch(first.url)).status).toBe(200)
    expect(await startWeb(app, 0)).toBe(true)
    expect(app.webService).toBe(first)
    expect(app.state.status).toContain(first.url)
    await app.close()
    await expect(fetch(first.url)).rejects.toThrow()
  })
})

describe('operation-lock storage sessions', () => {
  test('serializes revisions, drains queued work on close and preserves exclusive-session behavior', async () => {
    await initialize()
    const first = await openWorkspace(project, { lockMode: 'operation' })
    const second = await openWorkspace(project, { lockMode: 'operation' })
    sessions.push(first, second)
    const one = await first.writeBytes('assets/key.bin', Buffer.from([0, 255]), null)
    expect((await second.readBytes('assets/key.bin')).bytes).toEqual(Buffer.from([0, 255]))
    const saving = first.writeBytes('assets/key.bin', Buffer.from('changed'), one.revision)
    const stale = first.writeBytes('assets/key.bin', Buffer.from('stale'), one.revision)
    const closing = first.close()
    await saving
    await expect(stale).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await closing
    expect((await second.readBytes('assets/key.bin')).bytes.toString()).toBe('changed')
    const exclusive = await openWorkspace(project)
    sessions.push(exclusive)
    const reader = await openWorkspace(project, { lockMode: 'operation' })
    sessions.push(reader)
    expect((await reader.read('app.json')).data).toEqual(APP)
    await expect(reader.writeBytes('assets/new.bin', Buffer.from('blocked'), null)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' })
    await reader.close()
    await expect(second.writeBytes('assets/new.bin', Buffer.from('blocked'), null)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' })
    await exclusive.close()
    expect((await second.writeBytes('assets/new.bin', Buffer.from('allowed'), null)).size).toBe(7)
    await second.close()
    expect(await fs.readdir(path.join(project, '.lazyapp'))).not.toContain('.lazyapp.lock')
  })

  test('imports and TUI deletions honor optional byte revisions while allowing configuration deletion', async () => {
    await initialize({ documents: [{ path: 'assets/config.json', data: { schemaVersion: 1 } }] })
    const first = await openWorkspace(project, { lockMode: 'operation' })
    const second = await openWorkspace(project, { lockMode: 'operation' })
    sessions.push(first, second)
    const source = path.join(project, 'source.key')
    await fs.writeFile(source, 'replacement')
    await first.importFile(source, 'assets/key.bin', { expectedRevision: null })
    const original = await first.readBytes('assets/key.bin')
    await second.writeBytes('assets/key.bin', Buffer.from('other editor'), original.revision)
    await expect(first.importFile(source, 'assets/key.bin', {
      overwrite: true,
      expectedRevision: original.revision,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(first.removeFile('assets/key.bin', original.revision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect((await first.readBytes('assets/key.bin')).bytes.toString()).toBe('other editor')
    const current = await first.readBytes('assets/key.bin')
    await first.importFile(source, 'assets/key.bin', { overwrite: true, expectedRevision: current.revision })
    const imported = await first.readBytes('assets/key.bin')
    expect(imported.bytes.toString()).toBe('replacement')
    await second.removeFile('assets/key.bin', imported.revision)
    expect((await first.readBytes('assets/key.bin')).revision).toBeNull()
    const configuration = await first.readBytes('assets/config.json')
    await first.removeFile('assets/config.json', configuration.revision)
    expect((await first.read('assets/config.json')).data).toBeNull()
    expect(await fs.readdir(path.join(project, '.lazyapp'))).not.toContain('.lazyapp.lock')
  })
})
