import { t } from '../config/i18n.js'

export const CATEGORIES = [
  'App',
  'Assets',
  'Platforms',
  'Services',
  'Environments',
  'Store',
  'Doctor',
]
export const PLATFORM_KINDS = ['android', 'ios', 'harmony', 'windows', 'macos', 'miniprogram']

/** Layout decisions retain editing state across terminal resizes. */
export function layoutMode(width, height) {
  if (width >= 100 && height >= 24)
    return 'dual'
  if (width >= 60 && width < 100 && height >= 16)
    return 'single'
  return 'small'
}

/** A disk snapshot and editable draft never share mutable values. */
export function editDocument(document) {
  const draft = structuredClone(
    document.data ?? { schemaVersion: 1, ...(document.name ? { name: document.name } : {}) },
  )
  return {
    ...document,
    snapshot: structuredClone(document.missing ? draft : document.data),
    draft,
    index: 0,
    editing: false,
    cursor: 0,
  }
}

export function isDirty(editor) {
  return Boolean(editor && JSON.stringify(editor.draft) !== JSON.stringify(editor.snapshot))
}

export function setField(editor, field, value) {
  if (editor.kind === 'app' && ['platforms', 'environments'].includes(field.key)) {
    editor.draft[field.key] = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  }
  else if (field.type === 'number') {
    editor.draft[field.key] = value === '' ? '' : Number(value)
  }
  else {
    editor.draft[field.key] = value
  }
}

export function fieldValue(editor, field) {
  const value = editor.draft[field.key]
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}

export function categoryFor(kind) {
  if (PLATFORM_KINDS.includes(kind))
    return 'Platforms'
  return {
    app: 'App',
    assets: 'Assets',
    service: 'Services',
    environment: 'Environments',
    store: 'Store',
  }[kind]
}

/** Secret field values never enter ordinary view text, search, or status messages. */
export function displayValue(field, value, language = 'en') {
  if (field.type === 'secret')
    return value ? '********' : t(language, '(not set)')
  if (Array.isArray(value))
    return value.join(', ') || t(language, '(not set)')
  return String(value ?? '') || t(language, '(not set)')
}

/** Modal state owns focus until closed, with cancel selected by default. */
export function openModal(state, modal) {
  state.modal = {
    ...modal,
    index: 0,
    returnFocus: state.focus,
    returnEditor: Boolean(state.editor),
  }
  state.focus = 'modal'
}

/**
 * Close the active modal; `restore` (input dialogs only) rolls a live local
 * filter back to the snapshot captured when the dialog opened. Submit paths
 * pass `false` because the committed value must survive the close.
 */
export function closeModal(state, restore = true) {
  const modal = state.modal
  if (restore && modal?.restore)
    modal.restore()
  const target = modal?.returnFocus || 'list'
  state.modal = null
  // docs/spec.md section 5: closing restores the original focus. Only when that focus was the
  // document editor and the document is gone does it fall back to the list; an editor-free
  // details panel (file or Doctor preview) stays usable and keeps focus.
  state.focus = target === 'form' && modal?.returnEditor && !state.editor ? 'list' : target
}
