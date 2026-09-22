import { basename, resolve } from 'node:path'
import process from 'node:process'
import { t } from '../config/i18n.js'
import { defaultInitialization } from '../config/initialization.js'
import { safeErrorMessage } from '../features/workspace.js'
import { loadPreferences } from '../storage/preferences.js'
import { initializeWorkspace, workspaceExists } from '../storage/workspace.js'

/** Read one cooked-terminal line without enabling raw mode or touching the alternate screen. */
export function promptForInitialization(
  message,
  { input = process.stdin, output = process.stdout, signal } = {},
) {
  return new Promise((resolveAnswer, reject) => {
    let answer = ''
    let settled = false
    const finish = (value, error) => {
      if (settled)
        return
      settled = true
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('close', onEnd)
      input.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
      input.pause()
      if (error)
        reject(error)
      else resolveAnswer(value)
    }
    function onData(chunk) {
      answer += chunk.toString()
      const end = answer.search(/[\r\n]/)
      if (end !== -1)
        finish(answer.slice(0, end))
    }
    function onEnd() {
      output.write('\n')
      finish(null)
    }
    function onError(error) {
      finish(null, error)
    }
    function onAbort() {
      finish(null)
    }
    if (signal?.aborted) {
      finish(null)
      return
    }
    output.write(message)
    input.on('data', onData)
    input.once('end', onEnd)
    input.once('error', onError)
    input.once('close', onEnd)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (input.readableEnded || input.destroyed)
      onEnd()
    else input.resume()
  })
}

/** Return null to enter the TUI, or an exit code. Signals wait for in-flight creation and session cleanup. */
export async function prepareStartup(
  projectDir,
  {
    input = process.stdin,
    output = process.stdout,
    errorOutput = process.stderr,
    signals = process,
    prompt = promptForInitialization,
    preferences = { load: loadPreferences },
    storage = { exists: workspaceExists, initialize: initializeWorkspace },
  } = {},
) {
  let language = 'en'
  let interrupted = null
  const cancellation = new AbortController()
  const interrupt = (code) => {
    if (interrupted !== null)
      return
    interrupted = code
    output.write('\n')
    cancellation.abort()
  }
  const onSigint = () => interrupt(130)
  const onSigterm = () => interrupt(143)
  const report = error =>
    errorOutput.write(
      `lazyapp: ${t(language, 'Could not start lazyapp: {message}', { message: safeErrorMessage(error, language) })}\n`,
    )
  signals.on('SIGINT', onSigint)
  signals.on('SIGTERM', onSigterm)
  try {
    // Existing targets belong to the normal workspace opener, even when corrupt.
    if (await storage.exists(projectDir))
      return interrupted
    if (interrupted !== null)
      return interrupted
    try {
      language = (await preferences.load()).language
    }
    catch (error) {
      // An invalid personal preference neither changes files nor masks workspace failures.
      report(error)
    }
    if (interrupted !== null)
      return interrupted
    const answer = await prompt(t(language, 'No lazyapp workspace found. Create one? (y/N): '), {
      input,
      output,
      signal: cancellation.signal,
    })
    if (interrupted !== null)
      return interrupted
    if (typeof answer !== 'string' || !/^(?:y|yes)$/i.test(answer.trim()))
      return 0
    const { app, examples } = defaultInitialization(basename(resolve(projectDir)) || 'My App')
    const session = await storage.initialize(projectDir, app, { examples })
    // Never abandon an in-flight atomic initialization on a signal or leave its lock behind.
    await session.close()
    return interrupted
  }
  catch (error) {
    report(error)
    return interrupted ?? 1
  }
  finally {
    signals.off('SIGINT', onSigint)
    signals.off('SIGTERM', onSigterm)
  }
}
