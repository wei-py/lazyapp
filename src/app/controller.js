import { join, resolve } from 'node:path'
import { t } from '../config/i18n.js'
import { documentFields } from '../config/model.js'
import { DEFAULT_THEME } from '../config/themes.js'
import {
  doctorLabel,
  identifyDocument,
  loadDocuments,
  logicalFiles,
} from '../features/workspace.js'
import { loadPreferences, savePreferences } from '../storage/preferences.js'
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
  editText,
  fieldValue,
  layoutMode,
  preferenceItems,
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
      settingsIndex: 1,
      root: join(this.projectDir, '.lazyapp'),
      documents: [],
      category: 0,
      selected: 0,
      focus: 'list',
      editor: null,
      modal: null,
      status: 'Reading workspace…',
      busy: null,
      error: false,
      search: '',
      gg: 0,
      width: 100,
      height: 24,
      doctor: [],
      doctorIndex: 0,
      doctorLoaded: false,
      detailScroll: 0,
      files: null,
    }
    this.generation = 0
    this.closed = false
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
    if (category === 'Settings')
      return []
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
    if (this.state.busy) {
      this.quitPending = true
      this.state.status = this.t('Quit requested; waiting for current commit.')
      this.update()
      return
    }
    leave(this, () => this.exit(this.state.error ? 1 : 0))
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
    s.gg = 0
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
    if (CATEGORIES[s.category] === 'Settings') {
      s.settingsIndex = index
      s.detailScroll = 0
      this.update()
      return
    }
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
      s.gg = 0
      if (CATEGORIES[index] === 'Doctor' && !s.doctorLoaded && this.session)
        void doctor(this)
      this.update()
    })
  }

  async key(key) {
    const s = this.state
    if (key.name === 'c' && key.ctrl) {
      if (s.modal && !s.busy) {
        closeModal(s)
        this.update()
      }
      else {
        this.requestQuit()
      }
      return
    }
    if (s.busy) {
      if (key.name === 'q' && !s.editor?.editing && s.modal?.type !== 'input')
        this.requestQuit()
      return
    }
    if (s.modal) {
      const modal = s.modal
      if (key.name === 'escape') {
        closeModal(s)
        this.update()
        return
      }
      if (modal.type === 'input') {
        if (key.name === 'return' || key.name === 'enter') {
          closeModal(s)
          await modal.action(modal.value)
        }
        else {
          Object.assign(modal, editText(modal.value, modal.cursor, key))
        }
      }
      else if (key.name === 'return' || key.name === 'enter') {
        closeModal(s)
        await modal.action(modal.index)
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
      if (key.ctrl && key.name === 's') {
        await save(this)
        return
      }
      if (key.name === 'escape') {
        const field = this.fields()[editor.index]
        if (editor.hadValue)
          editor.draft[field.key] = editor.beforeValue
        else delete editor.draft[field.key]
        editor.editing = false
      }
      else if (['return', 'enter', 'tab'].includes(key.name)) {
        editor.editing = false
        if (key.name === 'tab')
          this.cyclePanel(key.shift ? -1 : 1)
      }
      else {
        const edited = editText(editor.input, editor.cursor, key)
        editor.input = edited.value
        editor.cursor = edited.cursor
        setField(editor, this.fields()[editor.index], edited.value)
      }
      this.update()
      return
    }
    if (layoutMode(s.width, s.height) === 'small') {
      if (key.name === 'q' || key.name === 'escape')
        this.requestQuit()
      return
    }
    if (key.ctrl && key.name === 's') {
      await save(this)
      return
    }
    if (key.name === 'q') {
      this.requestQuit()
      return
    }
    if (key.name === '?') {
      confirm(
        this,
        'Keyboard help',
        ['Close'],
        () => {},
        this.t(
          '1/2/3: categories / list / details; Tab / Shift+Tab: next / previous panel\nh/l or Left/Right: previous / next panel; j/k or Up/Down: move in focused panel\nCategories and list selections preview immediately; Enter: focus list / details / edit field\nEsc: details → list → categories → quit; switching panels retains drafts\nChanging category, item, or search asks Save / Discard / Cancel when dirty\ng g (500ms) / G: first / last; /: search document paths from list\nCtrl+s: save; n: create from categories/list; r: refresh or reload focused detail\nf: managed files; d: delete selected file from list; v: full non-secret field in details\nq: quit; Ctrl+c: request quit\nRed means missing; green means present, not valid credentials. Enter on missing configs edits a clean draft; Enter on missing resources imports a real file.\nText mode keeps all printable shortcuts, including 123jq/?.\nFile imports are independent confirmed commits. Doctor is read-only.\nPageUp/PageDown scroll details and long dialogs.\nSettings / 设置: choose 中文 / English; Enter applies and saves. Document shortcuts are disabled in Settings.',
        ),
      )
      return
    }
    if (key.name === 'escape') {
      if (s.focus === 'nav') {
        this.requestQuit()
      }
      else {
        this.focusPanel(s.focus === 'form' ? 'list' : 'nav')
      }
      return
    }
    if (key.name === 'tab') {
      s.gg = 0
      this.cyclePanel(key.shift ? -1 : 1)
      this.update()
      return
    }
    if (!key.ctrl && !key.meta) {
      if (['1', '2', '3'].includes(key.name)) {
        this.focusPanel(['nav', 'list', 'form'][Number(key.name) - 1])
        return
      }
      if (['h', 'left', 'l', 'right'].includes(key.name)) {
        this.cyclePanel(['h', 'left'].includes(key.name) ? -1 : 1)
        return
      }
    }
    if (CATEGORIES[s.category] === 'Settings' && ['/', 'r', 'n', 'f', 'd', 'v'].includes(key.name))
      return
    if (key.name === '/' && ['nav', 'list'].includes(s.focus)) {
      // Searching from the categories panel scrolls the filtered list instead of leaving the workflow.
      if (s.focus === 'nav')
        this.focusPanel('list')
      prompt(
        this,
        'Search document paths (secrets excluded)',
        (value) => {
          if (value === s.search)
            return
          return leave(this, () => {
            s.search = value
            s.selected = 0
            s.editor = null
            s.detailScroll = 0
            this.update()
          })
        },
        s.search,
      )
      return
    }
    if (key.name === 'r' && !this.session) {
      await start(this)
      return
    }
    if (key.name === 'r' && this.session) {
      if (s.focus === 'form' && editor) {
        await leave(this, async () => {
          await operation(this, this.t('Reloading {path}', { path: editor.path }), async () => {
            s.documents = await loadDocuments(this.session, { includeExamples: true })
            const document = s.documents.find(item => item.path === editor.path)
            s.editor = document ? editDocument(document) : null
            if (s.files)
              s.files = await this.session.list()
            invalidateDoctor(this)
            s.status = this.t('Reloaded disk version. You can edit and save again.')
          })
        })
      }
      else if (CATEGORIES[s.category] === 'Doctor' && !s.files) {
        await doctor(this)
      }
      else {
        await leave(this, () => refresh(this))
      }
      return
    }
    if (key.name === 'f' && this.session) {
      await showFiles(this)
      return
    }
    if (key.name === 'n' && ['nav', 'list'].includes(s.focus) && this.session && !s.files) {
      createDocument(this)
      return
    }
    if (key.name === 'd' && s.focus === 'list' && this.session) {
      deleteSelected(this)
      return
    }
    if (key.name === 'v' && s.focus === 'form' && editor) {
      const field = this.fields()[editor.index]
      if (field && field.type !== 'secret')
        confirm(this, field.label, ['Close'], () => {}, fieldValue(editor, field))
      return
    }
    if (['return', 'enter'].includes(key.name)) {
      if (s.focus === 'nav') {
        this.focusPanel('list')
      }
      else if (CATEGORIES[s.category] === 'Settings') {
        const item = preferenceItems()[s.settingsIndex]
        if (item?.kind === 'theme')
          await setTheme(this, item.id)
        else if (item)
          await setLanguage(this, item.id)
      }
      else if (s.focus === 'list') {
        const item = this.items()[s.selected]
        if (item?.file && (item.missing || identifyDocument(item.path)))
          openFile(this, item)
        else this.focusPanel('form')
      }
      else if (s.focus === 'form' && editor) {
        const field = this.fields()[editor.index]
        if (!field) {
          await save(this)
        }
        else if (field.type === 'file') {
          filePicker(this, field)
        }
        else {
          editor.editing = true
          editor.input = fieldValue(editor, field)
          editor.hadValue = Object.hasOwn(editor.draft, field.key)
          editor.beforeValue = structuredClone(editor.draft[field.key])
          editor.cursor = Array.from(editor.input).length
          s.gg = 0
        }
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
    let delta = ['j', 'down'].includes(key.name) ? 1 : ['k', 'up'].includes(key.name) ? -1 : 0
    if (key.name === 'pagedown')
      delta = 8
    if (key.name === 'pageup')
      delta = -8
    let edge = null
    if ((key.name === 'g' && key.shift) || key.text === 'G') {
      edge = 'last'
    }
    else if (key.name === 'g') {
      const now = Date.now()
      if (s.gg && now - s.gg <= 500) {
        edge = 'first'
        s.gg = 0
      }
      else {
        s.gg = now
      }
    }
    else {
      s.gg = 0
    }
    if (!delta && !edge)
      return
    const move = (index, count) =>
      edge === 'first'
        ? 0
        : edge === 'last'
          ? Math.max(0, count - 1)
          : Math.max(0, Math.min(count - 1, index + delta))
    if (s.focus === 'nav')
      await this.selectCategory(move(s.category, CATEGORIES.length))
    else if (CATEGORIES[s.category] === 'Settings')
      await this.selectItem(move(s.settingsIndex, preferenceItems().length))
    else if (s.focus === 'form' && editor)
      editor.index = move(editor.index, this.fields().length + 1)
    else if (s.focus === 'form')
      s.detailScroll = edge === 'first' ? 0 : Math.max(0, s.detailScroll + delta)
    else if (CATEGORIES[s.category] === 'Doctor' && !s.files)
      await this.selectItem(move(s.doctorIndex, s.doctor.length))
    else await this.selectItem(move(s.selected, this.items().length))
    this.update()
  }

  async close() {
    if (this.closed)
      return
    this.closed = true
    this.generation++
    await this.inFlight
    await this.session?.close()
  }
}
