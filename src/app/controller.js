import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { LANGUAGES, t } from '../config/i18n.js'
import { documentFields, documentPath, isSafeName } from '../config/model.js'
import { doctorLabel, identifyDocument, loadDocuments, logicalFiles, runDoctor, safeErrorMessage, saveDocument } from '../features/workspace.js'
import { loadPreferences, savePreferences } from '../storage/preferences.js'
import { inspectExternalReference, openWorkspace } from '../storage/workspace.js'
import { CATEGORIES, categoryFor, closeModal, editDocument, editText, fieldValue, isDirty, layoutMode, openModal, PLATFORM_KINDS, setField } from './state.js'

/** Owns drafts, focus, async transitions, and dispatch; disk effects stay in storage. */
export class Application {
  constructor(projectDir, render, exit, { preferences = { load: loadPreferences, save: savePreferences } } = {}) {
    this.projectDir = resolve(projectDir)
    this.render = render
    this.exit = exit
    this.preferences = preferences
    this.state = { language: 'en', settingsIndex: 1, root: join(this.projectDir, '.lazyapp'), documents: [], category: 0, selected: 0, focus: 'list', editor: null, modal: null, status: 'Reading workspace…', busy: null, error: false, search: '', gg: 0, width: 100, height: 24, doctor: [], doctorIndex: 0, doctorLoaded: false, detailScroll: 0, files: null }
    this.generation = 0
    this.closed = false
  }

  t(key, params) {
    return t(this.state.language, key, params)
  }

  async setLanguage(language) {
    if (!LANGUAGES.some(item => item.id === language) || this.state.busy)
      return false
    return this.operation(this.t('Saving language preference'), async () => {
      await this.preferences.save({ language })
      this.state.language = language
      this.state.settingsIndex = LANGUAGES.findIndex(item => item.id === language)
      for (const result of this.state.doctor)
        result.label = doctorLabel(result, language)
      this.state.status = this.t('Language preference saved.')
    }, true)
  }

  fields(editor = this.state.editor) {
    if (!editor)
      return []
    return documentFields(editor.kind, { scope: identifyDocument(editor.path)?.scope || 'all', language: this.state.language })
  }

  items() {
    const s = this.state
    const category = CATEGORIES[s.category]
    if (category === 'Settings')
      return []
    if (s.files)
      return logicalFiles(s.files).filter(item => item.path.toLowerCase().includes(s.search.toLowerCase()))
    return s.documents.filter(doc => categoryFor(doc.kind) === category && doc.path.toLowerCase().includes(s.search.toLowerCase()))
  }

  update() {
    if (!this.closed)
      this.render(this.state, this)
  }

  async operation(label, action, commit = false) {
    if (this.state.busy)
      return false
    let settled
    this.inFlight = new Promise((resolveSettled) => {
      settled = resolveSettled
    })
    label = this.t(label)
    this.state.busy = label
    const loadingStatus = this.t('{label} — {activity}', { label, activity: this.t(commit ? 'commit cannot be interrupted; quit waits for completion' : 'reading; quit waits for completion') })
    const slowStatus = this.t('{label} — still executing; please wait', { label })
    this.state.status = loadingStatus
    const timer = setTimeout(() => {
      this.state.status = slowStatus
      this.update()
    }, 3000)
    this.update()
    try {
      await action()
      this.state.error = false
      if (this.state.status === loadingStatus || this.state.status === slowStatus)
        this.state.status = this.t('{label}: complete.', { label })
      return true
    }
    catch (error) {
      this.state.status = this.t('{error} Retry explicitly; drafts retained.', { error: safeErrorMessage(error, this.state.language) })
      this.state.error = true
      return false
    }
    finally {
      clearTimeout(timer)
      this.state.busy = null
      settled()
      this.update()
      if (this.quitPending) {
        this.quitPending = false
        this.requestQuit()
      }
    }
  }

  async start() {
    let preferenceError
    const opened = await this.operation('Opening workspace', async () => {
      try {
        const preferences = await this.preferences.load()
        this.state.language = preferences.language
        this.state.settingsIndex = LANGUAGES.findIndex(item => item.id === preferences.language)
      }
      catch (error) {
        preferenceError = error
      }
      this.session = await openWorkspace(this.projectDir)
      this.state.documents = await loadDocuments(this.session, { includeExamples: true })
      this.state.status = this.t('Ready. Secrets are plaintext on disk, masked here; this is not an encrypted vault.')
    })
    if (preferenceError && opened) {
      this.state.status = this.t('Preferences could not be loaded. Settings were not changed. {error}', { error: safeErrorMessage(preferenceError, this.state.language) })
      this.state.error = true
      this.update()
    }
  }

  confirm(title, options, action, detail = '') {
    openModal(this.state, { type: 'choice', title: this.t(title), options: options.map(option => this.t(option)), action, detail })
    this.update()
  }

  prompt(title, action, value = '', detail = '') {
    openModal(this.state, { type: 'input', title: this.t(title), value, cursor: Array.from(value).length, action, detail })
    this.update()
  }

  leave(action) {
    if (isDirty(this.state.editor)) {
      return this.confirm('Unsaved changes', ['Cancel', 'Save', 'Discard'], async (index) => {
        if (index === 1) {
          if (await this.save())
            return action()
        }
        if (index === 2)
          return action()
      }, this.t('Save commits this document; Discard loses this draft only.'))
    }
    else {
      return action()
    }
  }

  requestQuit() {
    if (this.state.busy) {
      this.quitPending = true
      this.state.status = this.t('Quit requested; waiting for current commit.')
      this.update()
      return
    }
    this.leave(() => this.exit(this.state.error ? 1 : 0))
  }

  async refresh() {
    return this.operation('Refreshing workspace', async () => {
      const id = this.items()[this.state.selected]?.path
      const previousIndex = this.state.selected
      const documents = await loadDocuments(this.session, { includeExamples: true })
      this.state.documents = documents
      if (this.state.files)
        this.state.files = await this.session.list()
      this.invalidateDoctor()
      const items = this.items()
      const matched = items.findIndex(item => item.path === id)
      this.state.selected = matched >= 0 ? matched : Math.min(previousIndex, Math.max(0, items.length - 1))
      this.state.editor = null
      this.state.detailScroll = 0
      this.state.status = this.t('Refreshed; existing selection restored where available.')
    })
  }

  open(document, fresh = false) {
    const s = this.state
    if (s.editor?.path === document.path) {
      s.focus = 'form'
      this.update()
      return
    }
    return this.leave(() => {
      s.editor = editDocument(document)
      if (fresh)
        s.editor.snapshot = null
      s.files = null
      s.category = CATEGORIES.indexOf(categoryFor(document.kind))
      s.selected = this.items().findIndex(item => item.path === document.path)
      s.focus = 'form'
      s.detailScroll = 0
      s.gg = 0
      this.update()
    })
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
      void this.doctor()
    this.update()
  }

  cyclePanel(delta) {
    const panels = ['nav', 'list', 'form']
    this.focusPanel(panels[(panels.indexOf(this.state.focus) + delta + panels.length) % panels.length])
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
    return this.leave(() => {
      s.editor = null
      s.detailScroll = 0
      if (doctor)
        s.doctorIndex = index
      else
        s.selected = Math.max(0, this.items().findIndex(item => item.path === path))
      this.update()
    })
  }

  async save() {
    const editor = this.state.editor
    if (!editor || this.state.busy)
      return false
    const success = await this.operation(this.t('Saving {path}', { path: editor.path }), async () => {
      const saved = await saveDocument(this.session, editor.path, editor.kind, editor.draft, editor.revision)
      editor.snapshot = structuredClone(saved.data)
      editor.draft = structuredClone(saved.data)
      editor.revision = saved.revision
      editor.editing = false
      editor.missing = false
      const index = this.state.documents.findIndex(item => item.path === editor.path)
      const document = { path: editor.path, kind: editor.kind, ...saved, missing: false }
      if (index < 0)
        this.state.documents.push(document)
      else this.state.documents[index] = document
      if (this.state.files && !this.state.files.includes(editor.path))
        this.state.files.push(editor.path)
      this.invalidateDoctor()
      this.state.category = CATEGORIES.indexOf(categoryFor(editor.kind))
      if (!this.items().some(item => item.path === editor.path))
        this.state.search = ''
      this.state.selected = this.items().findIndex(item => item.path === editor.path)
      this.state.status = this.t('Saved {path}. Doctor can check completeness.', { path: editor.path })
    }, true)
    return success
  }

  invalidateDoctor() {
    this.generation++
    this.state.doctor = []
    this.state.doctorLoaded = false
    this.state.doctorIndex = 0
  }

  async doctor() {
    const generation = ++this.generation
    await this.operation('Checking configuration (read-only)', async () => {
      const results = await runDoctor(this.session, this.state.language)
      if (generation !== this.generation)
        return
      this.state.doctor = results
      this.state.doctorLoaded = true
      this.state.detailScroll = 0
      this.state.doctorIndex = Math.min(this.state.doctorIndex, Math.max(0, results.length - 1))
      this.state.status = this.t('Doctor complete. File existence is not certificate validity or release readiness.')
    })
  }

  selectCategory(index) {
    const s = this.state
    if (index === s.category && !s.files)
      return
    return this.leave(() => {
      s.editor = null
      s.files = null
      s.category = index
      s.selected = 0
      s.search = ''
      s.detailScroll = 0
      s.gg = 0
      if (CATEGORIES[index] === 'Doctor' && !s.doctorLoaded && this.session)
        void this.doctor()
      this.update()
    })
  }

  createDocument() {
    const category = CATEGORIES[this.state.category]
    if (category === 'App' || category === 'Assets') {
      const kind = category.toLowerCase()
      const path = documentPath(kind)
      this.open(this.state.documents.find(doc => doc.path === path) || { path, kind, data: null, revision: null })
      return
    }
    if (category === 'Platforms') {
      this.confirm('Choose platform', ['Cancel', ...PLATFORM_KINDS], (index) => {
        if (!index)
          return
        const kind = PLATFORM_KINDS[index - 1]
        this.confirm('Platform configuration scope', ['Cancel', 'Identity / root', 'Environment signing'], (choice) => {
          if (choice === 1)
            this.newDocument(kind, {})
          if (choice === 2)
            this.prompt('Environment name', environment => this.newDocument(kind, { environment }), '', this.t('Use a single safe name. Mark production targets deliberately.'))
        })
      })
      return
    }
    const kind = { Services: 'service', Environments: 'environment', Store: 'store' }[category]
    if (kind)
      this.prompt(this.t('New {kind} name', { kind: this.t(kind) }), name => this.newDocument(kind, { name }), '', this.t('Single directory-safe name; environment names can be custom. Add enabled names to App metadata too.'))
  }

  newDocument(kind, options) {
    if (Object.values(options).some(value => !isSafeName(value))) {
      this.state.status = this.t('Use a nonempty single name without separators, traversal, reserved names, or trailing dots.')
      this.update()
      return
    }
    try {
      const path = documentPath(kind, options)
      const existing = this.state.documents.find(doc => doc.path === path)
      const data = { schemaVersion: 1, ...(options.name ? { name: options.name } : {}) }
      return this.open(existing || { path, kind, data, revision: null }, !existing)
    }
    catch (error) {
      this.state.status = safeErrorMessage(error, this.state.language)
      this.update()
    }
  }

  filePicker(field) {
    const editor = this.state.editor
    this.confirm(this.t('{field}: file action', { field: field.label }), ['Cancel', 'Copy into workspace', 'Reference external file', 'Remove reference'], (index) => {
      if (index === 3) {
        setField(editor, field, '')
        this.update()
        return
      }
      if (index !== 1 && index !== 2)
        return
      this.prompt('Source file: absolute path', async (source) => {
        const valid = await this.operation('Checking source file', async () => {
          const info = await inspectExternalReference(source)
          if (!info.exists)
            throw Object.assign(new Error('Missing file'), { code: 'ENOENT' })
        })
        if (!valid)
          return
        if (index === 2) {
          this.confirm('Use read-only external reference?', ['Cancel', 'Use reference'], (selected) => {
            if (selected) {
              setField(editor, field, source)
              this.state.status = this.t('External file is read-only and will not move with this workspace.')
              this.update()
            }
          }, source)
          return
        }
        this.prompt('Destination relative to workspace', destination => this.confirmCopy(source, destination, editor, field), join(dirname(editor.path), basename(source)), this.t('No traversal. Copy never modifies the source file.'))
      })
    }, this.t('External references are read-only. Removing a reference never deletes its source.'))
  }

  async confirmCopy(source, destination, editor, field) {
    let exists = false
    const checked = await this.operation('Checking copy destination', async () => {
      if (isAbsolute(destination))
        throw Object.assign(new Error('Invalid destination'), { code: 'INVALID_PATH' })
      exists = (await this.session.inspectReference(destination)).exists
    })
    if (!checked)
      return
    this.confirm(exists ? 'Overwrite this workspace file?' : 'Copy file now?', ['Cancel', exists ? 'Overwrite file' : 'Copy file'], async (index) => {
      if (!index)
        return
      await this.operation(this.t('Copying to {path}', { path: destination }), async () => {
        const reference = await this.session.importFile(source, destination, { overwrite: exists })
        if (editor && field)
          setField(editor, field, reference)
        if (this.state.files && !this.state.files.includes(destination))
          this.state.files.push(destination)
        this.invalidateDoctor()
        if (identifyDocument(destination))
          this.state.documents = await loadDocuments(this.session, { includeExamples: true })
        this.state.status = this.t(editor ? 'File copy committed. Save the draft to link it; discarding the draft retains this independently imported file.' : 'Imported {path}. Presence does not imply credential validity.', { path: destination })
      }, true)
    }, this.t('{source}\n-> {destination}\nThis is an independent file commit. Canceling later form edits will NOT undo this copy.', { source, destination }))
  }

  openFile(item) {
    const document = this.state.documents.find(document => document.path === item.path)
    if (document)
      return this.open(document)
    if (item.missing && !item.instructionOnly)
      return this.prompt('Source file: absolute path', source => this.confirmCopy(source, item.path), '', this.t('Import a real file to {path}. The example instructions remain unchanged.', { path: item.path }))
    this.confirm('Managed file', ['Close'], () => {}, item.instructionOnly
      ? this.t('Legacy credential instructions have no typed destination. Use a configuration file field to import the correct credential.')
      : item.path)
  }

  async showFiles() {
    return this.leave(async () => {
      await this.operation('Listing managed files', async () => {
        this.state.files = await this.session.list()
        this.state.documents = await loadDocuments(this.session, { includeExamples: true })
        this.invalidateDoctor()
        this.state.editor = null
        this.state.selected = 0
        this.state.search = ''
        this.state.detailScroll = 0
        this.state.focus = 'list'
        this.state.status = this.t('Managed files: panel 3 previews the path; d deletes one file after confirmation. External files are never listed.')
      })
    })
  }

  deleteSelected() {
    const item = this.items()[this.state.selected]
    if (!item || item.missing)
      return
    if (item.path === 'app.json') {
      this.state.status = this.t('The App document cannot be deleted inside an open workspace.')
      this.update()
      return
    }
    return this.leave(() => this.confirm('Delete this one workspace file?', ['Cancel', 'Delete file'], async (index) => {
      if (!index)
        return
      await this.operation(this.t('Deleting {path}', { path: item.path }), async () => {
        await this.session.removeFile(item.path)
        this.state.documents = await loadDocuments(this.session, { includeExamples: true })
        if (this.state.files)
          this.state.files = await this.session.list()
        this.invalidateDoctor()
        this.state.selected = Math.min(this.state.selected, Math.max(0, this.items().length - 1))
        this.state.editor = null
        this.state.detailScroll = 0
        this.state.status = this.t('Deleted selected file only. References may now be missing; run Doctor.')
      }, true)
    }, this.t('{path}\nNo directories are recursively deleted. This cannot be undone.', { path: item.path })))
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
        modal.index = (modal.index + (key.shift ? modal.options.length - 1 : 1)) % modal.options.length
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
        await this.save()
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
      await this.save()
      return
    }
    if (key.name === 'q') {
      this.requestQuit()
      return
    }
    if (key.name === '?') {
      this.confirm('Keyboard help', ['Close'], () => {}, this.t('1/2/3: categories / list / details; Tab / Shift+Tab: next / previous panel\nh/l or Left/Right: previous / next panel; j/k or Up/Down: move in focused panel\nCategories and list selections preview immediately; Enter: focus list / details / edit field\nEsc: details → list → categories → quit; switching panels retains drafts\nChanging category, item, or search asks Save / Discard / Cancel when dirty\ng g (500ms) / G: first / last; /: search document paths from list\nCtrl+s: save; n: create from categories/list; r: refresh or reload focused detail\nf: managed files; d: delete selected file from list; v: full non-secret field in details\nq: quit; Ctrl+c: request quit\nRed means missing; green means present, not valid credentials. Enter on missing configs edits a clean draft; Enter on missing resources imports a real file.\nText mode keeps all printable shortcuts, including 123jq/?.\nFile imports are independent confirmed commits. Doctor is read-only.\nPageUp/PageDown scroll details and long dialogs.\nSettings / 设置: choose 中文 / English; Enter applies and saves. Document shortcuts are disabled in Settings.'))
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
      this.prompt('Search document paths (secrets excluded)', (value) => {
        if (value === s.search)
          return
        return this.leave(() => {
          s.search = value
          s.selected = 0
          s.editor = null
          s.detailScroll = 0
          this.update()
        })
      }, s.search)
      return
    }
    if (key.name === 'r' && !this.session) {
      await this.start()
      return
    }
    if (key.name === 'r' && this.session) {
      if (s.focus === 'form' && editor) {
        await this.leave(async () => {
          await this.operation(this.t('Reloading {path}', { path: editor.path }), async () => {
            s.documents = await loadDocuments(this.session, { includeExamples: true })
            const document = s.documents.find(item => item.path === editor.path)
            s.editor = document ? editDocument(document) : null
            if (s.files)
              s.files = await this.session.list()
            this.invalidateDoctor()
            s.status = this.t('Reloaded disk version. You can edit and save again.')
          })
        })
      }
      else if (CATEGORIES[s.category] === 'Doctor' && !s.files) {
        await this.doctor()
      }
      else {
        await this.leave(() => this.refresh())
      }
      return
    }
    if (key.name === 'f' && this.session) {
      await this.showFiles()
      return
    }
    if (key.name === 'n' && ['nav', 'list'].includes(s.focus) && this.session && !s.files) {
      this.createDocument()
      return
    }
    if (key.name === 'd' && s.focus === 'list' && this.session) {
      this.deleteSelected()
      return
    }
    if (key.name === 'v' && s.focus === 'form' && editor) {
      const field = this.fields()[editor.index]
      if (field && field.type !== 'secret')
        this.confirm(field.label, ['Close'], () => {}, fieldValue(editor, field))
      return
    }
    if (['return', 'enter'].includes(key.name)) {
      if (s.focus === 'nav') {
        this.focusPanel('list')
      }
      else if (CATEGORIES[s.category] === 'Settings') {
        await this.setLanguage(LANGUAGES[s.settingsIndex].id)
      }
      else if (s.focus === 'list') {
        const item = this.items()[s.selected]
        if (item?.file && (item.missing || identifyDocument(item.path)))
          this.openFile(item)
        else
          this.focusPanel('form')
      }
      else if (s.focus === 'form' && editor) {
        const field = this.fields()[editor.index]
        if (!field) {
          await this.save()
        }
        else if (field.type === 'file') {
          this.filePicker(field)
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
        if (item)
          this.confirm(this.t(item.status), ['Close'], () => {}, `${doctorLabel(item, s.language)}\n${item.path || ''}`)
      }
      else {
        const item = this.items()[s.selected]
        if (item?.file)
          this.openFile(item)
        else if (item)
          this.open(item)
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
    const move = (index, count) => edge === 'first' ? 0 : edge === 'last' ? Math.max(0, count - 1) : Math.max(0, Math.min(count - 1, index + delta))
    if (s.focus === 'nav')
      await this.selectCategory(move(s.category, CATEGORIES.length))
    else if (CATEGORIES[s.category] === 'Settings')
      await this.selectItem(move(s.settingsIndex, LANGUAGES.length))
    else if (s.focus === 'form' && editor)
      editor.index = move(editor.index, this.fields().length + 1)
    else if (s.focus === 'form')
      s.detailScroll = edge === 'first' ? 0 : Math.max(0, s.detailScroll + delta)
    else if (CATEGORIES[s.category] === 'Doctor' && !s.files)
      await this.selectItem(move(s.doctorIndex, s.doctor.length))
    else
      await this.selectItem(move(s.selected, this.items().length))
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
