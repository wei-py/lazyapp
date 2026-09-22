import { LANGUAGES } from '../config/i18n.js'
import { DEFAULT_THEME, isTheme } from '../config/themes.js'
import {
  doctorLabel,
  loadDocuments,
  runDoctor,
  safeErrorMessage,
} from '../features/workspace.js'
import { openWorkspace } from '../storage/workspace.js'
import { preferenceItems } from './state.js'

export async function operation(app, label, action, commit = false) {
  if (app.state.busy)
    return false
  let settled
  app.inFlight = new Promise((resolveSettled) => {
    settled = resolveSettled
  })
  label = app.t(label)
  app.state.busy = label
  const loadingStatus = app.t('{label} — {activity}', {
    label,
    activity: app.t(
      commit
        ? 'commit cannot be interrupted; quit waits for completion'
        : 'reading; quit waits for completion',
    ),
  })
  const slowStatus = app.t('{label} — still executing; please wait', { label })
  app.state.status = loadingStatus
  const timer = setTimeout(() => {
    app.state.status = slowStatus
    app.update()
  }, 3000)
  app.update()
  try {
    await action()
    app.state.error = false
    if (app.state.status === loadingStatus || app.state.status === slowStatus)
      app.state.status = app.t('{label}: complete.', { label })
    return true
  }
  catch (error) {
    app.state.status = app.t('{error} Retry explicitly; drafts retained.', {
      error: safeErrorMessage(error, app.state.language),
    })
    app.state.error = true
    return false
  }
  finally {
    clearTimeout(timer)
    app.state.busy = null
    settled()
    app.update()
    if (app.quitPending) {
      app.quitPending = false
      app.requestQuit()
    }
  }
}

export async function start(app) {
  let preferenceError
  const opened = await operation(app, 'Opening workspace', async () => {
    try {
      const preferences = await app.preferences.load()
      app.state.language = preferences.language
      app.state.theme = preferences.theme ?? DEFAULT_THEME
      app.state.settingsIndex = preferenceItems().findIndex(
        item => item.kind === 'language' && item.id === preferences.language,
      )
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
  await operation(app, 'Checking configuration (read-only)', async () => {
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
}

export function invalidateDoctor(app) {
  app.generation++
  app.state.doctor = []
  app.state.doctorLoaded = false
  app.state.doctorIndex = 0
}

export async function setLanguage(app, language) {
  if (!LANGUAGES.some(item => item.id === language) || app.state.busy)
    return false
  return operation(
    app,
    app.t('Saving language preference'),
    async () => {
      await app.preferences.save({ language, theme: app.state.theme })
      app.state.language = language
      app.state.settingsIndex = preferenceItems().findIndex(
        item => item.kind === 'language' && item.id === language,
      )
      for (const result of app.state.doctor) result.label = doctorLabel(result, language)
      app.state.status = app.t('Language preference saved.')
    },
    true,
  )
}

export async function setTheme(app, id) {
  if (!isTheme(id) || app.state.busy)
    return false
  return operation(
    app,
    app.t('Saving theme preference'),
    async () => {
      await app.preferences.save({ language: app.state.language, theme: id })
      app.state.theme = id
      app.state.settingsIndex = preferenceItems().findIndex(
        item => item.kind === 'theme' && item.id === id,
      )
      app.state.status = app.t('Theme preference saved.')
    },
    true,
  )
}
