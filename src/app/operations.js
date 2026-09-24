import { DEFAULT_THEME, isTheme } from '../../vendor/lazy-kit/themes.js'
import { LANGUAGES } from '../config/i18n.js'
import { doctorLabel, loadDocuments, runDoctor, safeErrorMessage } from '../features/workspace.js'
import { openWorkspace } from '../storage/workspace.js'

/**
 * Run one action as a background job instead of blocking the key loop. The
 * returned promise resolves `true` only for a job that finished successfully
 * and never rejects, so callers can chain without gating input. `commit`
 * serializes the job behind every earlier commit (workspace writes never race).
 * Failures surface as a redacted status line; raw error text only reaches the
 * job row, never the shared log.
 */
export function operation(app, label, action, commit = false) {
  const title = app.t(label)
  let failure = null
  const settled = app.runner
    .submit({
      kind: 'task',
      label: title,
      serialized: commit,
      run: async () => {
        try {
          await action()
        }
        catch (error) {
          failure = safeErrorMessage(error, app.state.language)
          throw new Error(failure)
        }
      },
    })
    .then((job) => {
      if (job.state === 'done') {
        app.state.error = false
      }
      else if (job.state === 'failed') {
        app.state.status = app.t('{error} Retry explicitly; drafts retained.', {
          error: failure ?? job.lastLine,
        })
        app.state.error = true
      }
      app.update()
      return job.state === 'done'
    })
  app.inFlight = settled
  return settled
}

export async function start(app) {
  let preferenceError
  const opened = await operation(app, 'Opening workspace', async () => {
    try {
      const preferences = await app.preferences.load()
      app.state.language = preferences.language
      app.state.theme = preferences.theme ?? DEFAULT_THEME
    }
    catch (error) {
      preferenceError = error
    }
    app.session = await openWorkspace(app.projectDir)
    app.state.documents = await loadDocuments(app.session, { includeExamples: true })
    app.state.status = app.t(
      'Ready. Secrets are plaintext on disk, masked here; this is not an encrypted vault.',
    )
  })
  if (preferenceError && opened) {
    app.state.status = app.t(
      'Preferences could not be loaded. Settings were not changed. {error}',
      { error: safeErrorMessage(preferenceError, app.state.language) },
    )
    app.state.error = true
    app.update()
  }
}

export async function refresh(app) {
  return operation(app, 'Refreshing workspace', async () => {
    const id = app.items()[app.state.selected]?.path
    const previousIndex = app.state.selected
    const documents = await loadDocuments(app.session, { includeExamples: true })
    app.state.documents = documents
    if (app.state.files)
      app.state.files = await app.session.list()
    invalidateDoctor(app)
    const items = app.items()
    const matched = items.findIndex(item => item.path === id)
    app.state.selected
      = matched >= 0 ? matched : Math.min(previousIndex, Math.max(0, items.length - 1))
    app.state.editor = null
    app.state.detailScroll = 0
    app.state.status = app.t('Refreshed; existing selection restored where available.')
  })
}

export async function doctor(app) {
  const generation = ++app.generation
  app.state.checking = true
  app.update()
  const done = await operation(app, 'Checking configuration (read-only)', async () => {
    const results = await runDoctor(app.session, app.state.language)
    if (generation !== app.generation)
      return
    app.state.doctor = results
    app.state.doctorLoaded = true
    app.state.detailScroll = 0
    app.state.doctorIndex = Math.min(app.state.doctorIndex, Math.max(0, results.length - 1))
    app.state.status = app.t(
      'Doctor complete. File existence is not certificate validity or release readiness.',
    )
  })
  if (generation === app.generation)
    app.state.checking = false
  app.update()
  return done
}

export function invalidateDoctor(app) {
  app.generation++
  app.state.doctor = []
  app.state.doctorLoaded = false
  app.state.doctorIndex = 0
  app.state.checking = false
}

export async function setLanguage(app, language) {
  if (!LANGUAGES.some(item => item.id === language))
    return false
  return operation(
    app,
    app.t('Saving language preference'),
    async () => {
      await app.preferences.save({ language, theme: app.state.theme })
      app.state.language = language
      for (const result of app.state.doctor) result.label = doctorLabel(result, language)
      app.state.status = app.t('Language preference saved.')
    },
    true,
  )
}

export async function setTheme(app, id) {
  if (!isTheme(id))
    return false
  return operation(
    app,
    app.t('Saving theme preference'),
    async () => {
      await app.preferences.save({ language: app.state.language, theme: id })
      app.state.theme = id
      app.state.status = app.t('Theme preference saved.')
    },
    true,
  )
}
