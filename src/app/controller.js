import { join, resolve } from 'node:path'
import { createJobRunner } from '../../vendor/lazy-kit/jobs.js'
import { applyTextKey } from '../../vendor/lazy-kit/keys.js'
import { DEFAULT_THEME, THEMES } from '../../vendor/lazy-kit/themes.js'
import { t } from '../config/i18n.js'
import { documentFields } from '../config/model.js'
import {
  doctorLabel,
  identifyDocument,
  loadDocuments,
  logicalFiles,
  safeErrorMessage,
} from '../features/workspace.js'
import { loadPreferences, savePreferences } from '../storage/preferences.js'
import { copy } from './clipboard.js'
import { confirm, createDocument, leave, open, prompt, save } from './documents.js'
import { deleteSelected, filePicker, openFile, showFiles } from './files.js'
import {
  doctor,
  invalidateDoctor,
  operation,
  refresh,
  setLanguage,
  setTheme,
  start,
} from './operations.js'
import {
  CATEGORIES,
  categoryFor,
  closeModal,
  editDocument,
  fieldValue,
  layoutMode,
  openModal,
  setField,
} from './state.js'

/** Owns drafts, focus, async transitions, and dispatch; disk effects stay in storage. */
export class Application {
  constructor(
    projectDir,
    render,
    exit,
    { preferences = { load: loadPreferences, save: savePreferences } } = {},
  ) {
    this.projectDir = resolve(projectDir)
    this.render = render
    this.exit = exit
    this.preferences = preferences
    this.state = {
      language: 'en',
      theme: DEFAULT_THEME,
      root: join(this.projectDir, '.lazyapp'),
      documents: [],
      category: 0,
      selected: 0,
      focus: 'list',
      editor: null,
      modal: null,
      status: 'Reading workspace…',
      error: false,
      search: '',
      width: 100,
      height: 24,
      doctor: [],
      doctorIndex: 0,
      doctorLoaded: false,
      checking: false,
      detailScroll: 0,
      files: null,
      jobs: [],
    }
    this.generation = 0
    this.closed = false
    // Jobs stream into the status bar; patches repaint without blocking keys.
    this.runner = createJobRunner({
      onPatch: () => {
        this.state.jobs = this.runner.list()
        this.update()
      },
    })
  }

  t(key, params) {
    return t(this.state.language, key, params)
  }

  fields(editor = this.state.editor) {
    if (!editor)
      return []
    return documentFields(editor.kind, {
      scope: identifyDocument(editor.path)?.scope || 'all',
      language: this.state.language,
    })
  }

  items() {
    const s = this.state
    const category = CATEGORIES[s.category]
    if (s.files) {
      return logicalFiles(s.files).filter(item =>
        item.path.toLowerCase().includes(s.search.toLowerCase()),
      )
    }
    return s.documents.filter(
      doc =>
        categoryFor(doc.kind) === category
        && doc.path.toLowerCase().includes(s.search.toLowerCase()),
    )
  }

  update() {
    if (!this.closed)
      this.render(this.state, this)
  }

  requestQuit() {
    const active = this.runner
      .list()
      .filter(job => job.state === 'running' || job.state === 'queued')
    const proceed = () => leave(this, () => this.exit(this.state.error ? 1 : 0))
    if (active.length) {
      confirm(
        this,
        'Quit?',
        ['Cancel', 'Quit'],
        proceed,
        `${this.t('jobs still running: {count}', { count: active.length })}\n${this.t('y quit · n cancel')}`,
        true,
      )
      return
    }
    proceed()
  }

  focusPanel(focus) {
    const s = this.state
    if (focus === 'nav' && s.files) {
      s.files = null
      s.selected = 0
      s.search = ''
      s.editor = null
      s.detailScroll = 0
    }
    s.focus = focus
    if (focus === 'form' && !s.editor) {
      const item = this.items()[s.selected]
      if (item && !item.file)
        s.editor = editDocument(item)
    }
    if (CATEGORIES[s.category] === 'Doctor' && !s.files && !s.doctorLoaded && this.session)
      void doctor(this)
    this.update()
  }

  cyclePanel(delta) {
    const panels = ['nav', 'list', 'form']
    this.focusPanel(
      panels[(panels.indexOf(this.state.focus) + delta + panels.length) % panels.length],
    )
  }

  selectItem(index) {
    const s = this.state
    const doctor = CATEGORIES[s.category] === 'Doctor' && !s.files
    if (index === (doctor ? s.doctorIndex : s.selected))
      return
    const path = this.items()[index]?.path
    return leave(this, () => {
      s.editor = null
      s.detailScroll = 0
      if (doctor) {
        s.doctorIndex = index
      }
      else {
        s.selected = Math.max(
          0,
          this.items().findIndex(item => item.path === path),
        )
      }
      this.update()
    })
  }

  selectCategory(index) {
    const s = this.state
    if (index === s.category && !s.files)
      return
    return leave(this, () => {
      s.editor = null
      s.files = null
      s.category = index
      s.selected = 0
      s.search = ''
      s.detailScroll = 0
      if (CATEGORIES[index] === 'Doctor' && !s.doctorLoaded && this.session)
        void doctor(this)
      this.update()
    })
  }

  #cycleSetting(modal, delta) {
    if (modal.row === 0) {
      const order = ['en', 'zh']
      const next = order[(order.indexOf(this.state.language) + delta + order.length) % order.length]
      void setLanguage(this, next)
    }
    else {
      const ids = THEMES.map(theme => theme.id)
      const next = ids[(ids.indexOf(this.state.theme) + delta + ids.length) % ids.length]
      void setTheme(this, next)
    }
  }

  async key(key) {
    const s = this.state
    if (key.name === 'c' && key.ctrl) {
      if (s.modal) {
        // Ctrl+c inside a flow cancels that flow, never the application.
        closeModal(s)
        this.update()
      }
      else {
        this.requestQuit()
      }
      return
    }
    if (s.modal) {
      const modal = s.modal
      if (key.name === 'escape') {
        closeModal(s)
        this.update()
        return
      }
      if (modal.type === 'settings') {
        if (['j', 'down'].includes(key.name))
          modal.row = 1
        else if (['k', 'up'].includes(key.name))
          modal.row = 0
        else if (['enter', 'return', 'l', 'right'].includes(key.name))
          this.#cycleSetting(modal, 1)
        else if (['h', 'left'].includes(key.name))
          this.#cycleSetting(modal, -1)
        this.update()
        return
      }
      if (modal.type === 'input') {
        const next = applyTextKey(key, modal.value, modal.cursor)
        if (next.submit) {
          const action = modal.action
          const value = next.value
          closeModal(s, false)
          await action(value)
        }
        else if (next.value !== modal.value || next.cursor !== modal.cursor) {
          modal.value = next.value
          modal.cursor = next.cursor
          modal.onInput?.(next.value)
        }
        this.update()
        return
      }
      if (modal.yn && ['enter', 'return', 'y'].includes(key.name)) {
        const action = modal.action
        const index = modal.options.length - 1
        closeModal(s)
        await action(index)
        this.update()
        return
      }
      if (modal.yn && key.name === 'n') {
        closeModal(s)
        this.update()
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        const action = modal.action
        const index = modal.index
        closeModal(s)
        await action(index)
      }
      else if (['j', 'down', 'tab', 'l', 'right'].includes(key.name)) {
        modal.index
          = (modal.index + (key.shift ? modal.options.length - 1 : 1)) % modal.options.length
      }
      else if (['k', 'up', 'h', 'left'].includes(key.name)) {
        modal.index = (modal.index + modal.options.length - 1) % modal.options.length
      }
      else if (key.name === 'pagedown') {
        modal.scroll = (modal.scroll || 0) + 5
      }
      else if (key.name === 'pageup') {
        modal.scroll = Math.max(0, (modal.scroll || 0) - 5)
      }
      this.update()
      return
    }
    const editor = s.editor
    if (editor?.editing) {
      if (key.name === 'escape') {
        const field = this.fields()[editor.index]
        if (editor.hadValue)
          editor.draft[field.key] = editor.beforeValue
        else delete editor.draft[field.key]
        editor.editing = false
      }
      else if (key.name === 'tab') {
        editor.editing = false
        this.cyclePanel(key.shift ? -1 : 1)
      }
      else {
        const next = applyTextKey(key, editor.input, editor.cursor)
        if (next.submit) {
          editor.editing = false
        }
        else if (next.value !== editor.input || next.cursor !== editor.cursor) {
          editor.input = next.value
          editor.cursor = next.cursor
          setField(editor, this.fields()[editor.index], next.value)
        }
      }
      this.update()
      return
    }
    // Shifted letters arrive as name 'l' + shift with text 'L'; unshift them so
    // only the exact table spelling binds (A/R/S/... stay dead).
    const name
      = key.shift && !key.ctrl && !key.meta && typeof key.text === 'string' && /^[A-Z]$/.test(key.text)
        ? key.text
        : key.name
    if (layoutMode(s.width, s.height) === 'small') {
      if (name === 'q')
        this.requestQuit()
      return
    }
    // Only Ctrl+d/u (half page) survive this point; Ctrl+c already routed above.
    if ((key.ctrl || key.meta) && !['d', 'u'].includes(key.name))
      return
    if (name === 'q') {
      this.requestQuit()
      return
    }
    if (name === '?' || key.text === '?') {
      confirm(
        this,
        'Keyboard help',
        ['Close'],
        () => {},
        this.t('help_lines'),
      )
      return
    }
    if (name === 'L' || key.text === 'L') {
      void setLanguage(this, s.language === 'zh' ? 'en' : 'zh')
      return
    }
    if (name === ':' || key.text === ':') {
      openModal(s, { type: 'settings', title: this.t('Settings'), row: 0 })
      this.update()
      return
    }
    if (name === 'escape') {
      // Esc steps back one panel; at the categories panel it stops — q quits.
      if (s.focus !== 'nav')
        this.focusPanel(s.focus === 'form' ? 'list' : 'nav')
      return
    }
    if (name === 'x') {
      const active = [...s.jobs]
        .reverse()
        .find(job => job.state === 'running' || job.state === 'queued')
      if (active)
        this.runner.abort(active.id)
      return
    }
    if (name === 'tab' || name === 'backtab') {
      this.cyclePanel(key.shift || name === 'backtab' ? -1 : 1)
      this.update()
      return
    }
    if (!key.ctrl && !key.meta && !key.shift) {
      if (['1', '2', '3'].includes(name)) {
        this.focusPanel(['nav', 'list', 'form'][Number(name) - 1])
        return
      }
      if (['h', 'left', 'l', 'right'].includes(name)) {
        this.cyclePanel(['h', 'left'].includes(name) ? -1 : 1)
        return
      }
      if (name === '[' || name === ']') {
        const step = name === ']' ? 1 : -1
        this.selectCategory(
          (s.category + step + CATEGORIES.length) % CATEGORIES.length,
        )
        return
      }
    }
    if ((name === '/' || key.text === '/') && ['nav', 'list'].includes(s.focus)) {
      // Local-only path filter: typing filters instantly, Esc restores the list.
      if (s.focus === 'nav')
        this.focusPanel('list')
      const previous = {
        search: s.search,
        selected: s.selected,
        detailScroll: s.detailScroll,
      }
      const restore = () => {
        s.search = previous.search
        s.selected = previous.selected
        s.detailScroll = previous.detailScroll
        this.update()
      }
      prompt(
        this,
        'Search document paths (secrets excluded)',
        async (value) => {
          if (value === previous.search)
            return
          await leave(
            this,
            () => {
              s.search = value
              s.selected = 0
              s.editor = null
              s.detailScroll = 0
              this.update()
            },
            restore,
          )
        },
        s.search,
        '',
        {
          search: true,
          restore,
          onInput: (value) => {
            s.search = value
            s.selected = 0
            s.detailScroll = 0
            this.update()
          },
        },
      )
      return
    }
    if (name === 'r' && !this.session) {
      void start(this)
      return
    }
    if (name === 'r' && this.session) {
      if (s.focus === 'form' && editor) {
        void leave(this, () =>
          operation(this, this.t('Reloading {path}', { path: editor.path }), async () => {
            s.documents = await loadDocuments(this.session, { includeExamples: true })
            const document = s.documents.find(item => item.path === editor.path)
            s.editor = document ? editDocument(document) : null
            if (s.files)
              s.files = await this.session.list()
            invalidateDoctor(this)
            s.status = this.t('Reloaded disk version. You can edit and save again.')
          }))
      }
      else if (CATEGORIES[s.category] === 'Doctor' && !s.files) {
        void doctor(this)
      }
      else {
        void leave(this, () => refresh(this))
      }
      return
    }
    if (name === 'f' && this.session) {
      void showFiles(this)
      return
    }
    if (name === 'a' && ['nav', 'list'].includes(s.focus) && this.session && !s.files) {
      createDocument(this)
      return
    }
    if (name === 'D' && s.focus === 'list' && this.session) {
      deleteSelected(this)
      return
    }
    if (name === 's') {
      void save(this)
      return
    }
    if (name === 'e' && s.focus === 'form' && editor) {
      const field = this.fields()[editor.index]
      if (!field) {
        void save(this)
      }
      else if (field.type === 'file') {
        filePicker(this, field)
      }
      else {
        editor.editing = true
        editor.input = fieldValue(editor, field)
        editor.hadValue = Object.hasOwn(editor.draft, field.key)
        editor.beforeValue = structuredClone(editor.draft[field.key])
        editor.cursor = editor.input.length
      }
      this.update()
      return
    }
    if (name === 'y' && s.focus === 'form' && editor) {
      const field = this.fields()[editor.index]
      if (field) {
        s.error = false
        s.status = this.t('Copied {label}', { label: field.label })
        this.update()
        copy(fieldValue(editor, field)).catch((error) => {
          s.error = true
          s.status = this.t('Clipboard copy failed: {error}', {
            error: safeErrorMessage(error, s.language),
          })
          this.update()
        })
      }
      return
    }
    if (['return', 'enter'].includes(name)) {
      if (s.focus === 'nav') {
        this.focusPanel('list')
      }
      else if (s.focus === 'list') {
        const item = this.items()[s.selected]
        if (item?.file && (item.missing || identifyDocument(item.path)))
          openFile(this, item)
        else this.focusPanel('form')
      }
      else if (s.focus === 'form' && editor) {
        // Enter expands the full non-secret value; `e` edits it.
        const field = this.fields()[editor.index]
        if (field && field.type !== 'secret')
          confirm(this, field.label, ['Close'], () => {}, fieldValue(editor, field))
      }
      else if (CATEGORIES[s.category] === 'Doctor' && !s.files) {
        const item = s.doctor[s.doctorIndex]
        if (item) {
          confirm(
            this,
            this.t(item.status),
            ['Close'],
            () => {},
            `${doctorLabel(item, s.language)}\n${item.path || ''}`,
          )
        }
      }
      else {
        const item = this.items()[s.selected]
        if (item?.file)
          openFile(this, item)
        else if (item)
          open(this, item)
      }
      this.update()
      return
    }
    const halfPage = Math.max(1, Math.floor(s.height / 3))
    let delta = ['j', 'down'].includes(name) ? 1 : ['k', 'up'].includes(name) ? -1 : 0
    if (name === 'pagedown' || (key.ctrl && key.name === 'd'))
      delta = halfPage
    if (name === 'pageup' || (key.ctrl && key.name === 'u'))
      delta = -halfPage
    let edge = null
    if (name === 'end' || name === 'G')
      edge = 'last'
    else if (name === 'home' || name === 'g')
      edge = 'first'
    if (!delta && !edge)
      return
    const move = (index, count) =>
      edge === 'first'
        ? 0
        : edge === 'last'
          ? Math.max(0, count - 1)
          : Math.max(0, Math.min(count - 1, index + delta))
    if (s.focus === 'nav')
      this.selectCategory(move(s.category, CATEGORIES.length))
    else if (s.focus === 'form' && editor)
      editor.index = move(editor.index, this.fields().length + 1)
    else if (s.focus === 'form')
      s.detailScroll = edge === 'first' ? 0 : Math.max(0, s.detailScroll + delta)
    else if (CATEGORIES[s.category] === 'Doctor' && !s.files)
      this.selectItem(move(s.doctorIndex, s.doctor.length))
    else this.selectItem(move(s.selected, this.items().length))
    this.update()
  }

  async close() {
    if (this.closed)
      return
    this.closed = true
    this.generation++
    this.runner.abortAll()
    await this.inFlight
    await this.session?.close()
  }
}
