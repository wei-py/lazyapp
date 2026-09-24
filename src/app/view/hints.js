import { hintSegments } from '../../config/i18n.js'
import { CATEGORIES } from '../state.js'

export function keyHints(s) {
  return hintSegments(s.language, hintId(s))
}

function hintId(s) {
  if (s.modal?.type === 'input')
    return 'dialog-input'
  if (s.modal?.type === 'settings')
    return 'settings'
  if (s.modal?.yn)
    return 'dialog-confirm'
  if (s.modal)
    return 'dialog-choice'
  if (s.editor?.editing)
    return 'text-input'
  if (s.focus === 'form' && s.editor)
    return 'editor'
  if (s.focus === 'form')
    return 'preview'
  if (s.focus === 'nav')
    return 'nav'
  if (s.files)
    return 'files'
  if (CATEGORIES[s.category] === 'Doctor')
    return 'doctor'
  return 'list'
}
