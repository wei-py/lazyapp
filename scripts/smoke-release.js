import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import * as Bun from 'bun'

const root = resolve(import.meta.dir, '..')
const temporary = await mkdtemp(join(tmpdir(), 'lazyapp-release-'))
try {
  const unpack = Bun.spawn(['tar', '-xzf', join(root, 'dist/lazyapp-darwin-arm64.tar.gz'), '-C', temporary])
  assert.equal(await unpack.exited, 0, 'Release archive must extract')
  const binary = join(temporary, 'bin/lazyapp')
  // Deny access to the checkout: absolute bundled imports must not hide missing assets.
  const command = ['/usr/bin/sandbox-exec', '-p', `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(root)}))`, binary]
  const env = { PATH: '/usr/bin:/bin', HOME: temporary, XDG_CONFIG_HOME: join(temporary, 'preferences'), TERM: 'xterm-256color' }
  const help = Bun.spawn([...command, '--help'], { cwd: temporary, env, stdout: 'pipe', stderr: 'pipe' })
  assert.match(await new Response(help.stdout).text(), /Usage: lazyapp/)
  assert.equal(await help.exited, 0)

  async function exercise(initialize) {
    let output = ''
    let accepted = false
    let ready = false
    let timedOut = false
    const child = Bun.spawn(command, {
      cwd: temporary,
      env,
      terminal: {
        cols: 120,
        rows: 40,
        data(terminal, bytes) {
          output += new TextDecoder().decode(bytes)
          if (initialize && !accepted && output.includes('Create one? (y/N):')) {
            accepted = true
            terminal.write('y\n')
          }
          if (!ready && output.includes('Ready.')) {
            ready = true
            terminal.write('q')
          }
        },
      },
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 20000)
    try {
      const code = await child.exited
      assert.ok(!timedOut, `Packaged TUI timed out: ${output}`)
      assert.equal(code, 0, `Packaged TUI failed: ${output}`)
      assert.ok(ready, `Native renderer must reach the workspace: ${output}`)
      assert.ok(output.includes('\x1B[?1049l'), 'Exit must leave the alternate screen')
      assert.equal(accepted, initialize, 'Only a new workspace should require initialization')
      if (!initialize)
        assert.ok(!output.includes('Create one?'), 'Existing workspace must reopen directly')
    }
    finally {
      clearTimeout(timer)
      child.terminal.close()
    }
  }

  await exercise(true)
  const saved = await readFile(join(temporary, '.lazyapp/app.json'), 'utf8')
  assert.ok(JSON.parse(saved).name, 'Initialization must persist valid App metadata')
  await exercise(false)
  assert.equal(await readFile(join(temporary, '.lazyapp/app.json'), 'utf8'), saved, 'Reopening must not rewrite configuration')
  process.stdout.write('Release smoke passed: archive, help, native TUI, initialization, reopen, terminal exit; no Bun on PATH or checkout access.\n')
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
