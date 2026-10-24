import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import * as pty from '@lydell/node-pty'
import { releaseTarget } from '../src/config/release.js'

const execFile = promisify(execFileCallback)
const root = join(import.meta.dirname, '..')
const target = releaseTarget()
const temporary = await mkdtemp(join(tmpdir(), 'lazyapp-release-'))
try {
  await execFile('tar', ['-xf', join(root, 'dist', target.archiveName), '-C', temporary])
  const binary = join(temporary, 'bin', target.binaryName)
  // Deny checkout access where sandbox-exec exists: bundled imports must not hide missing assets.
  const sandboxed = process.platform === 'darwin'
  const command = sandboxed
    ? [
        '/usr/bin/sandbox-exec',
        '-p',
        `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(root)}))`,
        binary,
      ]
    : [binary]
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
          TEMP: temporary,
          TMP: temporary,
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
    const terminal = pty.spawn(terminalCommand[0], terminalCommand.slice(1), {
      cols: 120,
      rows: 40,
      cwd: temporary,
      env,
      name: 'xterm-256color',
    })
    terminal.onData((data) => {
      output += data
      if (initialize && !accepted && output.includes('Create one? (y/N):')) {
        accepted = true
        terminal.write(process.platform === 'win32' ? 'y\r' : 'y\n')
      }
      // ConPTY emits screen diffs, so the complete ready sentence may not be contiguous.
      if (!ready && output.includes('encrypted')) {
        ready = true
        terminal.write('q')
      }
    })
    const exited = new Promise(resolve => terminal.onExit(resolve))
    const timer = setTimeout(() => {
      timedOut = true
      terminal.kill('SIGKILL')
    }, 20000)
    try {
      const { exitCode } = await exited
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
  process.stdout.write(
    `Release smoke passed: Node SEA archive, help, native TUI, initialization, reopen, terminal exit${sandboxed ? ', and checkout isolation' : ''}.\n`,
  )
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
