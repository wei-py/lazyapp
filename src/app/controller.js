import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createApp, documentFields, documentPath, isSafeName, validateDocument } from '../config/model.js'
import { identifyDocument, loadDocuments, runDoctor, safeErrorMessage, saveDocument } from '../features/workspace.js'
import { initializeWorkspace, inspectExternalReference, openWorkspace } from '../storage/workspace.js'
import { CATEGORIES, categoryFor, closeModal, editDocument, editText, fieldValue, isDirty, layoutMode, openModal, PLATFORM_KINDS, setField } from './state.js'

/** Owns drafts, focus, async transitions, and dispatch; disk effects stay in storage. */
export class Application {
  constructor(projectDir, render, exit) {
    this.projectDir = resolve(projectDir)
    this.render = render
    this.exit = exit
    this.state = { root: join(this.projectDir, 'lazyapp'), documents: [], category: 0, selected: 0, focus: 'list', editor: null, modal: null, status: 'Reading workspace…', busy: null, error: false, search: '', gg: 0, width: 100, height: 24, doctor: [], doctorIndex: 0, doctorLoaded: false, detailScroll: 0, files: null, wizard: null }
    this.generation = 0
    this.closed = false
  }

  fields(editor = this.state.editor) {
    if (!editor)
      return []
    return documentFields(editor.kind, { scope: identifyDocument(editor.path)?.scope || 'all' })
  }

  items() {
    const s = this.state
    const category = CATEGORIES[s.category]
    if (s.files)
      return s.files.filter(path => path.toLowerCase().includes(s.search.toLowerCase())).map(path => ({ path, file: true }))
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
    this.state.busy = label
    const loadingStatus = `${label} — ${commit ? 'commit cannot be interrupted; quit waits for completion' : 'reading; quit waits for completion'}`
    const slowStatus = `${label} — still executing; please wait`
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
        this.state.status = `${label}: complete.`
      return true
    }
    catch (error) {
      this.state.status = `${safeErrorMessage(error)} Retry explicitly; drafts retained.`
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
    await this.operation('Opening workspace', async () => {
      try {
        this.session = await openWorkspace(this.projectDir)
      }
      catch (error) {
        if (error.code !== 'WORKSPACE_MISSING')
          throw error
        this.state.status = 'No configuration found. Initialization writes only after final Create.'
        this.confirm('Create a new workspace?', ['Cancel', 'Start wizard'], index => index ? this.startWizard() : this.exit(0))
        return
      }
      this.state.documents = await loadDocuments(this.session)
      this.state.status = 'Ready. Secrets are plaintext on disk, masked here; this is not an encrypted vault.'
    })
  }

  confirm(title, options, action, detail = '') {
    openModal(this.state, { type: 'choice', title, options, action, detail })
    this.update()
  }

  prompt(title, action, value = '', detail = '') {
    openModal(this.state, { type: 'input', title, value, cursor: Array.from(value).length, action, detail })
    this.update()
  }

  leave(action) {
    if (this.state.wizard) {
      return this.confirm('Cancel initialization? No files will be created.', ['Cancel', 'Discard wizard'], (index) => {
        if (index)
          this.exit(0)
      })
    }
    else if (isDirty(this.state.editor)) {
      return this.confirm('Unsaved changes', ['Cancel', 'Save', 'Discard'], async (index) => {
        if (index === 1) {
          if (await this.save())
            return action()
        }
        if (index === 2)
          return action()
      }, 'Save commits this document; Discard loses this draft only.')
    }
    else {
      return action()
    }
  }

  requestQuit() {
    if (this.state.busy) {
      this.quitPending = true
      this.state.status = 'Quit requested; waiting for current commit.'
      this.update()
      return
    }
    this.leave(() => this.exit(this.state.error ? 1 : 0))
  }

  async refresh() {
    return this.operation('Refreshing workspace', async () => {
      const id = this.items()[this.state.selected]?.path
      const previousIndex = this.state.selected
      const documents = await loadDocuments(this.session)
      this.state.documents = documents
      if (this.state.files)
        this.state.files = await this.session.list()
      const items = this.items()
      const matched = items.findIndex(item => item.path === id)
      this.state.selected = matched >= 0 ? matched : Math.min(previousIndex, Math.max(0, items.length - 1))
      this.state.editor = null
      this.state.detailScroll = 0
      this.state.status = 'Refreshed; existing selection restored where available.'
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
    if (this.state.wizard)
      return this.nextWizard()
    const success = await this.operation(`Saving ${editor.path}`, async () => {
      const saved = await saveDocument(this.session, editor.path, editor.kind, editor.draft, editor.revision)
      editor.snapshot = structuredClone(saved.data)
      editor.draft = structuredClone(saved.data)
      editor.revision = saved.revision
      editor.editing = false
      const index = this.state.documents.findIndex(item => item.path === editor.path)
      const document = { path: editor.path, kind: editor.kind, ...saved }
      if (index < 0)
        this.state.documents.push(document)
      else this.state.documents[index] = document
      this.state.category = CATEGORIES.indexOf(categoryFor(editor.kind))
      if (!this.items().some(item => item.path === editor.path))
        this.state.search = ''
      this.state.selected = this.items().findIndex(item => item.path === editor.path)
      this.state.status = `Saved ${editor.path}. Doctor can check completeness.`
    }, true)
    return success
  }

  async doctor() {
    const generation = ++this.generation
    await this.operation('Checking configuration (read-only)', async () => {
      const results = await runDoctor(this.session)
      if (generation !== this.generation)
        return
      this.state.doctor = results
      this.state.doctorLoaded = true
      this.state.detailScroll = 0
      this.state.doctorIndex = Math.min(this.state.doctorIndex, Math.max(0, results.length - 1))
      this.state.status = 'Doctor complete. File existence is not certificate validity or release readiness.'
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
            this.prompt('Environment name', environment => this.newDocument(kind, { environment }), '', 'Use a single safe name. Mark production targets deliberately.')
        })
      })
      return
    }
    const kind = { Services: 'service', Environments: 'environment', Store: 'store' }[category]
    if (kind)
      this.prompt(`New ${kind} name`, name => this.newDocument(kind, { name }), '', 'Single directory-safe name; environment names can be custom. Add enabled names to App metadata too.')
  }

  newDocument(kind, options) {
    if (Object.values(options).some(value => !isSafeName(value))) {
      this.state.status = 'Use a nonempty single name without separators, traversal, reserved names, or trailing dots.'
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
      this.state.status = safeErrorMessage(error)
      this.update()
    }
  }

  startWizard() {
    const app = createApp({ name: basename(this.projectDir) || 'My App', platforms: [], environments: [] })
    this.state.wizard = { pages: [{ path: 'app.json', kind: 'app', data: app }], index: 0, imports: [] }
    this.showWizardPage()
  }

  showWizardPage() {
    const wizard = this.state.wizard
    const page = wizard.pages[wizard.index]
    this.state.editor = editDocument({ ...page, revision: null })
    this.state.focus = 'form'
    this.state.status = `Initialization ${wizard.index + 1}/${wizard.pages.length}: ${page.path}. Enter edits; Tab selects Continue; no files written.`
    this.update()
  }

  nextWizard() {
    const wizard = this.state.wizard
    const editor = this.state.editor
    const empty = editor.kind !== 'app' && Object.keys(editor.draft).every(key => key === 'schemaVersion' || editor.draft[key] === '')
    const issues = empty ? [] : validateDocument(editor.kind, editor.draft, { scope: identifyDocument(editor.path)?.scope || 'all' })
    if (issues.length) {
      this.state.status = issues.map(issue => issue.message).join('; ')
      this.update()
      return false
    }
    wizard.pages[wizard.index].data = structuredClone(editor.draft)
    wizard.pages[wizard.index].skip = empty
    if (wizard.index === 0) {
      const app = editor.draft
      const previous = new Map(wizard.pages.map(page => [page.path, page]))
      const pages = [{ path: 'assets/config.json', kind: 'assets' }]
      for (const kind of app.platforms) {
        pages.push({ path: documentPath(kind), kind })
        for (const environment of app.environments) pages.push({ path: documentPath(kind, { environment }), kind })
      }
      wizard.pages = [wizard.pages[0], ...pages.map(page => previous.get(page.path) || { ...page, data: { schemaVersion: 1 } })]
    }
    if (wizard.index < wizard.pages.length - 1) {
      wizard.index++
      this.showWizardPage()
      return true
    }
    const configured = wizard.pages.filter(page => !page.skip)
    this.confirm('Final confirmation: create workspace?', ['Cancel', 'Back', 'Create'], async (index) => {
      if (index === 0)
        return
      if (index === 1) {
        this.showWizardPage()
        return
      }
      await this.operation('Creating staged workspace', async () => {
        const app = wizard.pages[0].data
        const documents = configured.filter(page => page.kind !== 'app').map(({ path, data }) => ({ path, data }))
        this.session = await initializeWorkspace(this.projectDir, app, { documents, imports: wizard.imports })
        this.state.wizard = null
        this.state.editor = null
        this.state.focus = 'nav'
        this.state.documents = await loadDocuments(this.session)
        this.state.status = 'Workspace created. Secrets are stored in plaintext; .gitignore is not a security boundary.'
      }, true)
    }, `${this.state.root}\n${configured.map(page => page.path).join('\n')}\n${wizard.imports.length} file copies. Unconfigured steps are omitted.\nLocal plaintext is not encrypted. Backups and forced Git adds can expose secrets.`)
    return true
  }

  filePicker(field) {
    const editor = this.state.editor
    this.confirm(`${field.label}: file action`, ['Cancel', 'Copy into workspace', 'Reference external file', 'Remove reference'], (index) => {
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
              this.state.status = 'External file is read-only and will not move with this workspace.'
              this.update()
            }
          }, source)
          return
        }
        this.prompt('Destination relative to workspace', destination => this.confirmCopy(source, destination, editor, field), join(dirname(editor.path), basename(source)), 'No traversal. Copy never modifies the source file.')
      })
    }, 'External references are read-only. Removing a reference never deletes its source.')
  }

  async confirmCopy(source, destination, editor, field) {
    if (this.state.wizard) {
      const imports = this.state.wizard.imports
      const existing = imports.find(item => item.destination === destination)
      this.confirm(existing ? 'Replace pending wizard copy?' : 'Stage file copy for final Create?', ['Cancel', 'Stage copy'], (index) => {
        if (!index)
          return
        if (existing)
          existing.source = source
        else imports.push({ source, destination })
        setField(editor, field, destination)
        this.state.status = 'Copy staged; disk untouched until final Create.'
        this.update()
      }, `${source}\n-> ${destination}`)
      return
    }
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
      await this.operation(`Copying to ${destination}`, async () => {
        const reference = await this.session.importFile(source, destination, { overwrite: exists })
        setField(editor, field, reference)
        this.state.status = 'File copy committed. Save the draft to link it; discarding the draft retains this independently imported file.'
      }, true)
    }, `${source}\n-> ${destination}\nThis is an independent file commit. Canceling later form edits will NOT undo this copy.`)
  }

  async showFiles() {
    return this.leave(async () => {
      await this.operation('Listing managed files', async () => {
        this.state.files = await this.session.list()
        this.state.editor = null
        this.state.selected = 0
        this.state.search = ''
        this.state.detailScroll = 0
        this.state.focus = 'list'
        this.state.status = 'Managed files: panel 3 previews the path; d deletes one file after confirmation. External files are never listed.'
      })
    })
  }

  deleteSelected() {
    const item = this.items()[this.state.selected]
    if (!item)
      return
    if (item.path === 'app.json') {
      this.state.status = 'The App document cannot be deleted inside an open workspace.'
      this.update()
      return
    }
    return this.leave(() => this.confirm('Delete this one workspace file?', ['Cancel', 'Delete file'], async (index) => {
      if (!index)
        return
      await this.operation(`Deleting ${item.path}`, async () => {
        await this.session.removeFile(item.path)
        this.state.documents = this.state.documents.filter(doc => doc.path !== item.path)
        if (this.state.files)
          this.state.files = this.state.files.filter(path => path !== item.path)
        this.state.selected = Math.min(this.state.selected, Math.max(0, this.items().length - 1))
        this.state.editor = null
        this.state.detailScroll = 0
        this.state.status = 'Deleted selected file only. References may now be missing; run Doctor.'
      }, true)
    }, `${item.path}\nNo directories are recursively deleted. This cannot be undone.`))
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
        if (key.name === 'tab') {
          if (s.wizard) {
            const count = this.fields().length + 1
            editor.index = (editor.index + (key.shift ? count - 1 : 1)) % count
          }
          else {
            this.cyclePanel(key.shift ? -1 : 1)
          }
        }
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
      this.confirm('Keyboard help', ['Close'], () => {}, '1/2/3: categories / list / details; Tab / Shift+Tab: next / previous panel\nh/l or Left/Right: previous / next panel; j/k or Up/Down: move in focused panel\nCategories and list selections preview immediately; Enter: focus list / details / edit field\nEsc: details → list → categories → quit; switching panels retains drafts\nChanging category, item, or search asks Save / Discard / Cancel when dirty\ng g (500ms) / G: first / last; /: search document paths from list\nCtrl+s: save; n: create from categories/list; r: refresh or reload focused detail\nf: managed files; d: delete selected file from list; v: full non-secret field in details\nq: quit; Ctrl+c: request quit; Ctrl+w: cancel wizard\nWizard Tab steps fields; h/Esc goes back. Text mode keeps all printable shortcuts, including 123jq/?.\nFile imports are independent confirmed commits. Doctor is read-only.\nPageUp/PageDown scroll details and long dialogs.')
      return
    }
    if (s.wizard && key.ctrl && key.name === 'w') {
      this.requestQuit()
      return
    }
    if (key.name === 'escape' || (s.wizard && ['h', 'left'].includes(key.name))) {
      if (s.wizard) {
        if (s.wizard.index > 0) {
          s.wizard.pages[s.wizard.index].data = structuredClone(editor.draft)
          s.wizard.index--
          this.showWizardPage()
        }
        else {
          this.requestQuit()
        }
      }
      else if (s.focus === 'nav') {
        this.requestQuit()
      }
      else {
        this.focusPanel(s.focus === 'form' ? 'list' : 'nav')
      }
      return
    }
    if (key.name === 'tab') {
      s.gg = 0
      if (s.wizard) {
        const count = this.fields().length + 1
        editor.index = (editor.index + (key.shift ? count - 1 : 1)) % count
      }
      else {
        this.cyclePanel(key.shift ? -1 : 1)
      }
      this.update()
      return
    }
    if (!s.wizard && !key.ctrl && !key.meta) {
      if (['1', '2', '3'].includes(key.name)) {
        this.focusPanel(['nav', 'list', 'form'][Number(key.name) - 1])
        return
      }
      if (['h', 'left', 'l', 'right'].includes(key.name)) {
        this.cyclePanel(['h', 'left'].includes(key.name) ? -1 : 1)
        return
      }
    }
    if (key.name === '/' && s.focus === 'list') {
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
    if (key.name === 'r' && !this.session && !s.wizard) {
      await this.start()
      return
    }
    if (key.name === 'r' && this.session && !s.wizard) {
      if (s.focus === 'form' && editor) {
        await this.leave(async () => {
          await this.operation(`Reloading ${editor.path}`, async () => {
            const loaded = await this.session.read(editor.path)
            s.editor = editDocument({ path: editor.path, kind: editor.kind, ...loaded })
            const index = s.documents.findIndex(item => item.path === editor.path)
            if (index >= 0)
              s.documents[index] = { path: editor.path, kind: editor.kind, ...loaded }
            s.status = 'Reloaded disk version. You can edit and save again.'
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
    if (key.name === 'f' && this.session && !s.wizard) {
      await this.showFiles()
      return
    }
    if (key.name === 'n' && ['nav', 'list'].includes(s.focus) && this.session && !s.files && !s.wizard) {
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
    if (['return', 'enter'].includes(key.name) || (s.wizard && ['l', 'right'].includes(key.name))) {
      if (s.focus === 'nav') {
        this.focusPanel('list')
      }
      else if (s.focus === 'list') {
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
          this.confirm(item.status, ['Close'], () => {}, `${item.label}\n${item.path || ''}`)
      }
      else {
        const item = this.items()[s.selected]
        if (item?.file)
          this.confirm('Managed file', ['Close'], () => {}, item.path)
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
