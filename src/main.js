#!/usr/bin/env bun
import { resolve } from 'node:path'
import process from 'node:process'
import { prepareStartup } from './app/startup.js'
import { runCli } from './cli.js'

/** CLI commands are handled first; TUI mode requires an interactive terminal. */
export async function main(args = process.argv.slice(2)) {
  const cliResult = await runCli(args)
  if (cliResult !== null)
    return cliResult

  // Global flags — handled after CLI dispatch, before TUI guard.
  if (args.includes('--help') || args.includes('-h')) {
    const { printUsage } = await import('./cli.js')
    printUsage()
    return 0
  }
  if (args.includes('--version') || args.includes('-v')) {
    const { VERSION } = await import('./config/version.js')
    process.stdout.write(`lazyapp ${VERSION}\n`)
    return 0
  }

  if (args.length > 1 || args.some(arg => arg.startsWith('-'))) {
    process.stderr.write('Usage: lazyapp [project-directory]\nRun lazyapp --help for all commands.\n')
    return 1
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('lazyapp requires interactive stdin and stdout TTYs. Run it directly in a terminal.\n')
    return 1
  }
  const projectDir = resolve(args[0] || process.cwd())
  const startupCode = await prepareStartup(projectDir)
  if (startupCode !== null)
    return startupCode
  let renderer
  let app
  let cleanup
  let resolveExit
  const done = new Promise((resolveDone) => {
    resolveExit = resolveDone
  })
  const finish = (code, message) => {
    if (cleanup)
      return cleanup
    cleanup = (async () => {
      renderer?.destroy()
      try {
        await app?.close()
      }
      catch {
        code = code || 1
        message = 'Workspace cleanup failed; inspect the lock before reopening.'
      }
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      process.off('uncaughtException', onFailure)
      process.off('unhandledRejection', onFailure)
      if (message)
        process.stderr.write(`lazyapp: ${message}\n`)
      resolveExit(code)
    })()
    return cleanup
  }
  function onSigint() {
    void finish(130)
  }
  function onSigterm() {
    void finish(143)
  }
  function onFailure() {
    void finish(1, 'Unexpected runtime failure. Terminal restored; unsaved changes were not committed.')
  }
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  process.on('uncaughtException', onFailure)
  process.on('unhandledRejection', onFailure)
  try {
    const [{ createCliRenderer }, { Application }, { createView }] = await Promise.all([import('@opentui/core'), import('./app/controller.js'), import('./app/view.js')])
    if (cleanup)
      return await done
    renderer = await createCliRenderer({ exitOnCtrlC: false, exitSignals: [], useMouse: false, consoleMode: 'disabled', openConsoleOnError: false, screenMode: 'alternate-screen', clearOnShutdown: true })
    if (cleanup) {
      renderer.destroy()
      return await done
    }
    const view = createView(renderer)
    app = new Application(projectDir, view, code => finish(code))
    renderer.on('resize', () => app.update())
    renderer.on('render:error', onFailure)
    renderer.on('handler:error', onFailure)
    renderer.keyInput.on('keypress', (key) => {
      if (key.eventType === 'release')
        return
      key.preventDefault()
      key.stopPropagation()
      let text
      if (!key.ctrl && !key.meta) {
        if (!key.sequence.startsWith('\x1B'))
          text = key.sequence
        else if (key.name === 'space')
          text = ' '
        else if (Array.from(key.name).length === 1)
          text = key.shift ? key.name.toUpperCase() : key.name
      }
      void app.key({ name: key.name, ctrl: key.ctrl, meta: key.meta, shift: key.shift, text }).catch(onFailure)
    })
    renderer.keyInput.on('paste', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (app.state.editor?.editing || app.state.modal?.type === 'input') {
        void app.key({ name: 'paste', text: new TextDecoder().decode(event.bytes) }).catch(onFailure)
      }
    })
    app.update()
    await app.start()
  }
  catch {
    await finish(1, 'Unable to start the terminal application. Check native OpenTUI support and workspace permissions; source checkouts also require Bun.')
  }
  return await done
}

if (import.meta.main) {
  main().then((code) => {
    process.exitCode = code
  })
}
