import { documentPath, isSafeName } from '../config/model.js'
import { safeErrorMessage, saveDocument } from '../features/workspace.js'
import { invalidateDoctor, operation } from './operations.js'
import {
  CATEGORIES,
  categoryFor,
  editDocument,
  isDirty,
  openModal,
  PLATFORM_KINDS,
} from './state.js'

export function confirm(app, title, options, action, detail = '', yn = false) {
  openModal(app.state, {
    type: 'choice',
    title: app.t(title),
    options: options.map(option => app.t(option)),
    action,
    detail,
    yn,
  })
  app.update()
}

export function prompt(app, title, action, value = '', detail = '', options = {}) {
  openModal(app.state, {
    type: 'input',
    title: app.t(title),
    value,
    cursor: value.length,
    action,
    detail,
    ...options,
  })
  app.update()
}

/**
 * Run `action` only once any dirty draft is resolved; `onCancel` fires when
 * the user backs out (or a save fails) so flows that already mutated state —
 * like the live local search filter — can restore their snapshot.
 */
export function leave(app, action, onCancel) {
  if (isDirty(app.state.editor)) {
    return confirm(
      app,
      'Unsaved changes',
      ['Cancel', 'Save', 'Discard'],
      async (index) => {
        if (index === 1 && await save(app))
          return action()
        if (index === 2)
          return action()
        onCancel?.()
      },
      app.t('Save commits this document; Discard loses this draft only.'),
    )
  }
  else {
    return action()
  }
}

export function open(app, document, fresh = false) {
  const s = app.state
  if (s.editor?.path === document.path) {
    s.focus = 'form'
    app.update()
    return
  }
  return leave(app, () => {
    s.editor = editDocument(document)
    if (fresh)
      s.editor.snapshot = null
    s.files = null
    s.category = CATEGORIES.indexOf(categoryFor(document.kind))
    s.selected = app.items().findIndex(item => item.path === document.path)
    s.focus = 'form'
    s.detailScroll = 0
    app.update()
  })
}

export async function save(app) {
  const editor = app.state.editor
  if (!editor)
    return false
  const success = await operation(
    app,
    app.t('Saving {path}', { path: editor.path }),
    async () => {
      const saved = await saveDocument(
        app.session,
        editor.path,
        editor.kind,
        editor.draft,
        editor.revision,
      )
      editor.snapshot = structuredClone(saved.data)
      editor.draft = structuredClone(saved.data)
      editor.revision = saved.revision
      editor.editing = false
      editor.missing = false
      const index = app.state.documents.findIndex(item => item.path === editor.path)
      const document = { path: editor.path, kind: editor.kind, ...saved, missing: false }
      if (index < 0)
        app.state.documents.push(document)
      else app.state.documents[index] = document
      if (app.state.files && !app.state.files.includes(editor.path))
        app.state.files.push(editor.path)
      invalidateDoctor(app)
      app.state.category = CATEGORIES.indexOf(categoryFor(editor.kind))
      if (!app.items().some(item => item.path === editor.path))
        app.state.search = ''
      app.state.selected = app.items().findIndex(item => item.path === editor.path)
      app.state.status = app.t('Saved {path}. Doctor can check completeness.', {
        path: editor.path,
      })
    },
    true,
  )
  return success
}

export function createDocument(app) {
  const category = CATEGORIES[app.state.category]
  if (category === 'App' || category === 'Assets') {
    const kind = category.toLowerCase()
    const path = documentPath(kind)
    open(
      app,
      app.state.documents.find(doc => doc.path === path) || {
        path,
        kind,
        data: null,
        revision: null,
      },
    )
    return
  }
  if (category === 'Platforms') {
    confirm(app, 'Choose platform', ['Cancel', ...PLATFORM_KINDS], (index) => {
      if (!index)
        return
      const kind = PLATFORM_KINDS[index - 1]
      confirm(
        app,
        'Platform configuration scope',
        ['Cancel', 'Identity / root', 'Environment signing'],
        (choice) => {
          if (choice === 1)
            newDocument(app, kind, {})
          if (choice === 2) {
            prompt(
              app,
              'Environment name',
              environment => newDocument(app, kind, { environment }),
              '',
              app.t('Use a single safe name. Mark production targets deliberately.'),
            )
          }
        },
      )
    })
    return
  }
  const kind = { Services: 'service', Environments: 'environment', Store: 'store' }[category]
  if (kind) {
    prompt(
      app,
      app.t('New {kind} name', { kind: app.t(kind) }),
      name => newDocument(app, kind, { name }),
      '',
      app.t(
        'Single directory-safe name; environment names can be custom. Add enabled names to App metadata too.',
      ),
    )
  }
}

export function newDocument(app, kind, options) {
  if (Object.values(options).some(value => !isSafeName(value))) {
    app.state.status = app.t(
      'Use a nonempty single name without separators, traversal, reserved names, or trailing dots.',
    )
    app.update()
    return
  }
  try {
    const path = documentPath(kind, options)
    const existing = app.state.documents.find(doc => doc.path === path)
    const data = { schemaVersion: 1, ...(options.name ? { name: options.name } : {}) }
    return open(app, existing || { path, kind, data, revision: null }, !existing)
  }
  catch (error) {
    app.state.status = safeErrorMessage(error, app.state.language)
    app.update()
  }
}
