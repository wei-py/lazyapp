import { join, resolve } from 'node:path'
import { createJobRunner } from '../../vendor/lazy-kit/jobs.js'
import { applyTextKey } from '../../vendor/lazy-kit/keys.js'
import { DEFAULT_THEME, THEMES } from '../../vendor/lazy-kit/themes.js'
import { t } from '../config/i18n.js'
import { documentFields, identifyDocument } from '../config/model.js'
import {
  doctorLabel,
  loadDocuments,
  logicalFiles,
  safeErrorMessage,
} from '../features/workspace.js'
import { loadPreferences, savePreferences } from '../storage/preferences.js'
import { copy } from './clipboard.js'
import { confirm, createDocument, leave, prompt, save } from './documents.js'
import { deleteSelected, filePicker, openFile, showFiles } from './files.js'
import { moveHelp } from './help.js'
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
  focusedGroup,
  GROUP_TABS,
  isNavigation,
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
      focus: 'group1',
      lastGroup: 1,
      activeGroup: 1,
      groups: Array.from({ length: 4 }, () => ({ tab: 0, indices: [0, 0, 0], searches: ['', '', ''] })),
      expanded: [],
      target: null,
      managedFiles: [],
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
      webUrl: null,
    }
    this.generation = 0
    this.closed = false
    this.webService = null
    this.webStarting = null
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

  groupItems(group, tab = this.state.groups[group - 1].tab, search) {
    const s = this.state
    const query = (search ?? s.groups[group - 1].searches[tab]).toLowerCase()
    const matches = item => item.path?.toLowerCase().includes(query)
    if (group === 4) {
      return tab === 1
        ? s.doctor.map((entry, index) => ({ ...entry, doctor: true, id: `doctor:${index}` }))
        : logicalFiles(s.files || s.managedFiles).filter(matches)
    }
    if (group === 1)
      return s.documents.filter(doc => ['app', 'assets'].includes(doc.kind) && matches(doc))
    if (group === 3) {
      const category = GROUP_TABS[2][tab]
      return s.documents.filter(doc => categoryFor(doc.kind) === category && matches(doc))
    }
    const documents = s.documents
      .filter(doc => categoryFor(doc.kind) === 'Platforms')
      .toSorted((a, b) => a.kind.localeCompare(b.kind) || Number(Boolean(identifyDocument(a.path)?.environment)) - Number(Boolean(identifyDocument(b.path)?.environment)) || a.path.localeCompare(b.path))
    const kinds = [...new Set(documents.map(doc => doc.kind))]
    return kinds.flatMap((kind) => {
      const children = documents.filter(doc => doc.kind === kind && matches(doc))
      if (query && !children.length)
        return []
      return [
        { node: true, kind, path: `platform:${kind}` },
        ...(s.expanded.includes(kind) || query ? children : []),
      ]
    })
  }

  items() {
    return this.groupItems(this.state.activeGroup, this.state.activeTab ?? 0, this.state.search)
  }

  activeItem() {
    return this.state.target || this.items()[this.state.selected]
  }

  isDoctor() {
    return this.state.activeGroup === 4 && this.state.activeTab === 1
  }

  isFiles() {
    return this.state.activeGroup === 4 && this.state.activeTab === 0
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
        (index) => {
          if (index)
            return proceed()
        },
        `${this.t('jobs still running: {count}', { count: active.length })}\n${this.t('y quit · n cancel')}`,
        true,
      )
      return
    }
    proceed()
  }

  focusPanel(focus) {
    const s = this.state
    s.focus = focus
    if (isNavigation(focus))
      s.lastGroup = Number(focus.slice(-1))
    if (focus === 'form' && !s.editor) {
      const item = this.activeItem()
      if (item && !item.file && !item.node && !item.doctor)
        s.editor = editDocument(item)
    }
    this.update()
  }

  cyclePanel(delta) {
    const panels = ['group1', 'group2', 'group3', 'group4', 'form']
    this.focusPanel(panels[(panels.indexOf(this.state.focus) + delta + panels.length) % panels.length])
  }

  selectItem(index, group = focusedGroup(this.state), tab = this.state.groups[group - 1].tab, after, onCancel) {
    const s = this.state
    const navigation = s.groups[group - 1]
    const item = this.groupItems(group, tab)[index]
    if (item?.node) {
      navigation.tab = tab
      navigation.indices[tab] = index
      this.update()
      return after?.(item)
    }
    const same = s.activeGroup === group && (s.activeTab ?? 0) === tab
      && (this.activeItem()?.path || this.activeItem()?.id) === (item?.path || item?.id)
    const apply = () => {
      navigation.tab = tab
      navigation.indices[tab] = index
      s.activeGroup = group
      s.activeTab = tab
      s.selected = index
      s.search = navigation.searches[tab]
      s.target = item || null
      if (!same) {
        s.editor = null
        s.detailScroll = 0
      }
      if (group === 4) {
        s.files = tab === 0 ? s.managedFiles : null
        if (tab === 1 && !s.doctorLoaded && this.session)
          void doctor(this)
      }
      else {
        s.files = null
        if (item)
          s.category = CATEGORIES.indexOf(categoryFor(item.kind))
        else if (group === 3)
          s.category = CATEGORIES.indexOf(GROUP_TABS[2][tab])
      }
      if (item?.doctor)
        s.doctorIndex = index
      after?.(item)
      this.update()
    }
    return same ? apply() : leave(this, apply, onCancel)
  }

  selectCategory(index) {
    const category = CATEGORIES[index]
    const group = index < 2 ? 1 : index === 2 ? 2 : index === 6 ? 4 : 3
    const tab = group === 3 ? index - 3 : group === 4 ? 1 : 0
    this.focusPanel(`group${group}`)
    const items = this.groupItems(group, tab)
    const selected = group === 1 ? items.findIndex(item => categoryFor(item.kind) === category) : 0
    return this.selectItem(Math.max(0, selected), group, tab)
  }

  locateDocument(document) {
    const s = this.state
    const category = categoryFor(document.kind)
    const group = ['App', 'Assets'].includes(category) ? 1 : category === 'Platforms' ? 2 : 3
    const tab = group === 3 ? GROUP_TABS[2].indexOf(category) : 0
    if (group === 2 && !s.expanded.includes(document.kind))
      s.expanded.push(document.kind)
    s.activeGroup = group
    s.activeTab = tab
    s.lastGroup = group
    s.groups[group - 1].tab = tab
    s.groups[group - 1].searches[tab] = ''
    s.search = ''
    s.files = null
    s.category = CATEGORIES.indexOf(category)
    s.selected = this.items().findIndex(item => item.path === document.path)
    s.groups[group - 1].indices[tab] = Math.max(0, s.selected)
    s.target = document
  }

  navigateHorizontal(forward) {
    const s = this.state
    if (s.focus === 'form') {
      if (!forward)
        this.focusPanel(`group${s.lastGroup}`)
      return
    }
    const group = focusedGroup(s)
    const navigation = s.groups[group - 1]
    const index = navigation.indices[navigation.tab]
    const item = this.groupItems(group)[index]
    if (group === 2 && item) {
      const expanded = s.expanded.includes(item.kind)
      if (item.node && (forward !== expanded)) {
        s.expanded = forward ? [...s.expanded, item.kind] : s.expanded.filter(kind => kind !== item.kind)
        this.update()
        return
      }
      if (!forward && !item.node) {
        navigation.indices[0] = this.groupItems(2).findIndex(row => row.node && row.kind === item.kind)
        this.update()
        return
      }
      if (item.node)
        return
    }
    if (forward)
      this.selectItem(index, group, navigation.tab, () => this.focusPanel('form'))
  }

  #cycleSetting(modal, delta) {
    if (modal.row === 0) {
      const order = ['en', 'zh']
      const next
        = order[(order.indexOf(this.state.language) + delta + order.length) % order.length]
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
      if (modal.type === 'help') {
        if (['enter', 'return', 'q'].includes(key.name))
          closeModal(s)
        else
          moveHelp(s, key)
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
      if (modal.yn && key.name === 'y') {
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
      = key.shift
        && !key.ctrl
        && !key.meta
        && typeof key.text === 'string'
        && /^[A-Z]$/.test(key.text)
        ? key.text
        : key.name
    if ((name === '?' || key.text === '?') && !key.ctrl && !key.meta) {
      openModal(s, { type: 'help', title: this.t('Keyboard help'), section: 0, scrolls: [0, 0, 0] })
      this.update()
      return
    }
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
    if (name === 'L' || key.text === 'L') {
      void setLanguage(this, s.language === 'zh' ? 'en' : 'zh')
      return
    }
    if (name === ':' || key.text === ':') {
      openModal(s, { type: 'settings', title: this.t('Settings'), row: 0 })
      this.update()
      return
    }
    if (name === 'W' || key.text === 'W') {
      const { startWeb } = await import('./web.js')
      void startWeb(this)
      return
    }
    if (name === 'escape') {
      if (s.focus === 'form')
        this.focusPanel(`group${s.lastGroup}`)
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
      if (['0', '1', '2', '3', '4'].includes(name)) {
        this.focusPanel(name === '0' ? 'form' : `group${name}`)
        return
      }
      if (['h', 'left', 'l', 'right'].includes(name)) {
        this.navigateHorizontal(['l', 'right'].includes(name))
        return
      }
      if (name === '[' || name === ']') {
        const group = focusedGroup(s)
        const navigation = s.groups[group - 1]
        const tabs = group >= 3 ? GROUP_TABS[group - 1].length : 1
        if (tabs > 1) {
          const tab = (navigation.tab + (name === ']' ? 1 : -1) + tabs) % tabs
          this.selectItem(navigation.indices[tab], group, tab)
        }
        return
      }
    }
    if ((name === '/' || key.text === '/') && isNavigation(s.focus)) {
      const group = focusedGroup(s)
      const navigation = s.groups[group - 1]
      const tab = navigation.tab
      const previous = { search: navigation.searches[tab], index: navigation.indices[tab] }
      const restore = () => {
        navigation.searches[tab] = previous.search
        navigation.indices[tab] = previous.index
        this.update()
      }
      prompt(
        this,
        'Search document paths (secrets excluded)',
        () => this.selectItem(0, group, tab, undefined, restore),
        previous.search,
        '',
        {
          search: true,
          restore,
          onInput: (value) => {
            navigation.searches[tab] = value
            navigation.indices[tab] = 0
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
      else if (focusedGroup(s) === 4 && s.groups[3].tab === 1) {
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
    if (name === 'a' && isNavigation(s.focus) && this.session && focusedGroup(s) !== 4) {
      const group = focusedGroup(s)
      const category = group === 1
        ? categoryFor(this.groupItems(1)[s.groups[0].indices[0]]?.kind) || 'App'
        : GROUP_TABS[group - 1][s.groups[group - 1].tab]
      createDocument(this, category)
      return
    }
    if (name === 'D' && isNavigation(s.focus) && this.session) {
      const group = focusedGroup(s)
      const navigation = s.groups[group - 1]
      const item = this.groupItems(group)[navigation.indices[navigation.tab]]
      if (!item || item.node || item.doctor)
        return
      this.selectItem(navigation.indices[navigation.tab], group, navigation.tab, () => deleteSelected(this))
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
      if (isNavigation(s.focus)) {
        const group = focusedGroup(s)
        const navigation = s.groups[group - 1]
        const index = navigation.indices[navigation.tab]
        const item = this.groupItems(group)[index]
        if (item?.node) {
          s.expanded = s.expanded.includes(item.kind)
            ? s.expanded.filter(kind => kind !== item.kind)
            : [...s.expanded, item.kind]
        }
        else {
          this.selectItem(index, group, navigation.tab, (selected) => {
            if (selected?.file && (selected.missing || identifyDocument(selected.path)))
              openFile(this, selected)
            else this.focusPanel('form')
          })
        }
      }
      else if (s.focus === 'form' && editor) {
        const field = this.fields()[editor.index]
        if (!field)
          void save(this)
        else if (field.type !== 'secret')
          confirm(this, field.label, ['Close'], () => {}, fieldValue(editor, field))
      }
      else if (this.isDoctor()) {
        const item = this.activeItem()
        if (item)
          confirm(this, this.t(item.status), ['Close'], () => {}, `${doctorLabel(item, s.language)}\n${item.path || ''}`)
      }
      else if (this.activeItem()?.file) {
        openFile(this, this.activeItem())
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
    if (s.focus === 'form' && editor) {
      editor.index = move(editor.index, this.fields().length + 1)
    }
    else if (s.focus === 'form') {
      s.detailScroll = edge === 'first' ? 0 : Math.max(0, s.detailScroll + delta)
    }
    else {
      const group = focusedGroup(s)
      const navigation = s.groups[group - 1]
      this.selectItem(move(navigation.indices[navigation.tab], this.groupItems(group).length), group)
    }
    this.update()
  }

  async close() {
    if (this.closed)
      return
    this.closed = true
    this.generation++
    this.runner.abortAll()
    await this.inFlight
    await this.webStarting
    await this.webService?.close()
    await this.session?.close()
  }
}
