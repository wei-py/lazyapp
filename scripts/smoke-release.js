/* global Bun */
import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { get } from 'node:http'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { releaseTarget } from '../src/config/release.js'

const execFile = promisify(execFileCallback)
const root = join(import.meta.dirname, '..')
const target = releaseTarget()
const source = process.argv.includes('--source')
const temporary = await mkdtemp(join(tmpdir(), 'lazyapp-release-'))
try {
  if (!source)
    await execFile('tar', ['-xf', join(root, 'dist', target.archiveName), '-C', temporary])
  const binary = source ? process.execPath : join(temporary, 'bin', target.binaryName)
  // Deny checkout access for extracted releases where sandbox-exec exists.
  const sandboxed = !source && process.platform === 'darwin'
  if (sandboxed)
    await execFile('codesign', ['--verify', '--strict', binary])
  const command = sandboxed
    ? [
        '/usr/bin/sandbox-exec',
        '-p',
        `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(root)}))`,
        binary,
      ]
    : [binary, ...(source ? [join(root, 'src/main.js')] : [])]
  const env = Object.fromEntries(Object.entries({
    PATH: process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
      : '/usr/bin:/bin',
    HOME: temporary,
    XDG_CONFIG_HOME: join(temporary, 'preferences'),
    TERM: 'xterm-256color',
    ...(process.platform === 'win32'
      ? {
          SystemRoot: process.env.SystemRoot,
          SystemDrive: process.env.SystemDrive,
        }
      : {}),
  }).filter(([, value]) => value !== undefined))
  const help = await execFile(command[0], [...command.slice(1), '--help'], { cwd: temporary, env })
  assert.match(help.stdout, /Usage: lazyapp/)
  const version = await execFile(command[0], [...command.slice(1), '--version'], { cwd: temporary, env })
  assert.match(version.stdout, /^lazyapp \d+\.\d+\.\d+/)
  const terminalCommand = sandboxed ? [binary] : command

  async function exercise(initialize) {
    let output = ''
    let accepted = false
    let ready = false
    let timedOut = false
    let inputTimer
    let quitTimer
    const decoder = new TextDecoder()
    const child = Bun.spawn(terminalCommand, {
      cwd: temporary,
      env,
      terminal: {
        cols: 120,
        rows: 40,
        name: 'xterm-256color',
        data(terminal, data) {
          output += decoder.decode(data, { stream: true })
          if (initialize && !accepted && output.includes('Create one? (y/N):')) {
            accepted = true
            terminal.write(process.platform === 'win32' ? 'y\r' : 'y\n')
          }
          // Wait for a real loaded document, not localized explanatory copy.
          if (!ready && output.includes('app.json')) {
            ready = true
            terminal.resize(80, 24)
            terminal.write('?')
            inputTimer = setTimeout(() => {
              terminal.write('\x1B')
              terminal.resize(120, 40)
              quitTimer = setTimeout(() => terminal.write('q'), 100)
            }, 200)
          }
        },
      },
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 20000)
    try {
      const exitCode = await child.exited
      assert.ok(!timedOut, `Packaged TUI timed out: ${output}`)
      assert.equal(exitCode, 0, `Packaged TUI failed: ${output}`)
      assert.ok(ready, `Native renderer must reach the workspace: ${output}`)
      if (process.platform !== 'win32')
        assert.ok(output.includes('\x1B[?1049l'), 'Exit must leave the alternate screen')
      assert.equal(accepted, initialize, 'Only a new workspace should require initialization')
      if (!initialize)
        assert.ok(!output.includes('Create one?'), 'Existing workspace must reopen directly')
    }
    finally {
      clearTimeout(timer)
      clearTimeout(inputTimer)
      clearTimeout(quitTimer)
      child.terminal.close()
    }
  }

  await exercise(true)
  const saved = await readFile(join(temporary, '.lazyapp/app.json'), 'utf8')
  assert.ok(JSON.parse(saved).name, 'Initialization must persist valid App metadata')
  await exercise(false)
  assert.equal(
    await readFile(join(temporary, '.lazyapp/app.json'), 'utf8'),
    saved,
    'Reopening must not rewrite configuration',
  )
  async function exerciseWeb() {
    let output = ''
    let stdout = ''
    let closed = false
    let spawnError
    let announce
    const announced = new Promise((resolve) => {
      announce = resolve
    })
    const child = spawn(command[0], [...command.slice(1), 'web', temporary, '--port', '0'], {
      cwd: temporary,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data) => {
      output += data
      stdout += data
      const match = stdout.match(/lazyapp Web: (http:\/\/127\.0\.0\.1:\d+)\r?\n/u)
      if (match)
        announce(match[1])
    })
    child.stderr.on('data', (data) => {
      output += data
    })
    child.once('error', (error) => {
      spawnError = error
    })
    const exited = new Promise(resolve => child.once('close', (code, signal) => {
      closed = true
      resolve({ code, signal, error: spawnError })
    }))
    async function bounded(promise, milliseconds, message) {
      let timer
      try {
        return await Promise.race([
          promise,
          new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`${message}: ${output}`)), milliseconds)
          }),
        ])
      }
      finally {
        clearTimeout(timer)
      }
    }
    async function request(url, pathname, type, headers = {}) {
      const response = await new Promise((resolve, reject) => {
        const request = get(new URL(pathname, url), { agent: false, headers }, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (data) => {
            body += data
          })
          response.once('error', reject)
          response.once('end', () => resolve({
            status: response.statusCode,
            type: response.headers['content-type'],
            body,
          }))
        })
        const timer = setTimeout(() => request.destroy(new Error(`Web request timed out: ${pathname}`)), 5000)
        request.once('error', reject)
        request.once('close', () => clearTimeout(timer))
      })
      assert.equal(response.status, 200, `Packaged Web ${pathname} failed (check bin/web sidecar): ${response.body}\n${output}`)
      assert.match(response.type ?? '', type, `Packaged Web ${pathname} must have its expected content type`)
      return response.body
    }
    try {
      const url = await bounded(Promise.race([
        announced,
        exited.then(({ code, signal, error }) => {
          throw new Error(`Packaged Web exited before announcing its URL (${error?.message ?? signal ?? code}): ${output}`)
        }),
      ]), 20000, 'Packaged Web startup timed out')
      assert.ok(Number(new URL(url).port) > 0, 'Packaged Web must announce its assigned ephemeral port')
      const html = await request(url, '/', /^text\/html\b/u)
      assert.match(html, /<!doctype html>/iu)
      assert.match(html, /src=["']\/app\.js["']/u, 'Packaged HTML must reference the Web JavaScript sidecar')
      assert.match(html, /href=["']\/style\.css["']/u, 'Packaged HTML must reference the Web stylesheet sidecar')
      await request(url, '/app.js', /^text\/javascript\b/u)
      await request(url, '/scroll.js', /^text\/javascript\b/u)
      await request(url, '/virtual-list.js', /^text\/javascript\b/u)
      await request(url, '/style.css', /^text\/css\b/u)
      const { token } = JSON.parse(await request(url, '/api/session', /^application\/json\b/u))
      assert.equal(typeof token, 'string', 'Packaged Web must issue an API session token')
      const document = JSON.parse(await request(url, '/api/document?path=app.json', /^application\/json\b/u, {
        'X-Lazyapp-Token': token,
      }))
      assert.equal(document.path, 'app.json')
      assert.equal(document.missing, false, 'Packaged Web must open the initialized workspace')
      assert.deepEqual(document.data, JSON.parse(saved), 'Packaged Web must read persisted App metadata')
      assert.ok(!closed, `Packaged Web must remain running until stopped: ${output}`)
      // Windows kill() terminates unconditionally; it cannot exercise the POSIX signal handler.
      assert.ok(child.kill('SIGTERM'), 'Packaged Web must accept the shutdown request')
      const result = await bounded(exited, 10000, 'Packaged Web shutdown timed out')
      assert.ifError(result.error)
      if (process.platform !== 'win32') {
        assert.equal(result.signal, null, `Packaged Web must handle SIGTERM rather than die from it: ${output}`)
        assert.equal(result.code, 143, `Packaged Web must finish its SIGTERM cleanup: ${output}`)
      }
      await new Promise((resolve, reject) => {
        const address = new URL(url)
        const socket = createConnection({ host: address.hostname, port: Number(address.port) })
        const timer = setTimeout(() => socket.destroy(new Error('Packaged Web port closure check timed out')), 5000)
        socket.once('connect', () => {
          socket.destroy()
          reject(new Error(`Packaged Web port is still accepting connections after shutdown: ${url}`))
        })
        socket.once('error', (error) => {
          if (error.code === 'ECONNREFUSED')
            resolve()
          else
            reject(error)
        })
        socket.once('close', () => clearTimeout(timer))
      })
      assert.equal(await readFile(join(temporary, '.lazyapp/app.json'), 'utf8'), saved, 'Read-only Web requests must not rewrite configuration')
    }
    finally {
      if (!closed) {
        child.kill('SIGKILL')
        await bounded(exited, 5000, 'Packaged Web forced cleanup timed out')
      }
    }
  }
  await exerciseWeb()
  process.stdout.write(
    `${source ? 'Source' : 'Release'} smoke passed: ${source ? 'Bun runtime' : 'Bun standalone archive'}, help, native TUI, initialization, resize, reopen, terminal exit, Web assets, read-only API, and service shutdown${sandboxed ? ', signature verification, and checkout isolation' : ''}.\n`,
  )
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
