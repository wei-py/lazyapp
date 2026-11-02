import { createScrollManager } from './scroll.js'
import { createVirtualList } from './virtual-list.js'

const $ = selector => document.querySelector(selector)
const labels = { app: '应用', assets: '资源与资质', android: 'Android', ios: 'iOS', harmony: 'HarmonyOS', windows: 'Windows', macos: 'macOS', miniprogram: '小程序', service: '第三方服务', environment: '环境', store: '商店' }
const statuses = { pass: '通过', missing: '缺失', warning: '警告', error: '错误', unchecked: '未检查' }
let token
let workspace
let current = null
let view = 'overview'
let busy = false
let restoreFocus = null
let actionFocus = null
let previewUrl = null
let collection = 'service'
let expiryDay = ''
let refreshingExpiries = false
const expandedPlatforms = new Set()
const lifecycle = new AbortController()
const scroll = createScrollManager({ root: $('#content'), backToTop: $('#back-to-top') })
const navigationQuery = matchMedia('(max-width: 760px)')
const navigationDrawer = $('#navigation-drawer')
const fileList = createVirtualList({ element: $('#file-list'), scroll, rowHeight: 144, renderRow: renderFile, keyOf: file => file.path, label: '文件与材料清单' })
const doctorList = createVirtualList({ element: $('#doctor-list'), scroll, rowHeight: 112, renderRow: renderDoctor, keyOf: result => `${result.status}:${result.path}:${result.label}`, label: '诊断结果清单' })
const navigationLists = new Map()

function finishNavigation() {
  scroll.unlock(navigationDrawer)
  const slot = $('#navigation-slot')
  const sidebar = $('#workspace-navigation')
  if (sidebar.parentElement !== slot)
    slot.append(sidebar)
  $('#toggle-navigation').setAttribute('aria-expanded', 'false')
}

function closeNavigation() {
  if (navigationDrawer.open) {
    scroll.rememberSections(navigationDrawer)
    navigationDrawer.close()
  }
  finishNavigation()
}

function openNavigation() {
  if (!navigationQuery.matches || navigationDrawer.open)
    return
  navigationDrawer.append($('#workspace-navigation'))
  scroll.lock(navigationDrawer)
  $('#toggle-navigation').setAttribute('aria-expanded', 'true')
  navigationDrawer.showModal()
  scroll.restoreSections(navigationDrawer)
}

function showView(next, route = next) {
  closeNavigation()
  scroll.navigate(route, { restore: next === 'files' || next === 'doctor' })
  view = next
  for (const section of ['overview', 'documents', 'files', 'doctor'])
    $(`#${section}-view`).hidden = section !== view
  for (const entry of $('#workspace-navigation').querySelectorAll('[data-view]'))
    entry.setAttribute('aria-current', entry.dataset.view === view ? 'page' : 'false')
  $('.keyboard-hint').hidden = view !== 'documents'
  if (view !== 'documents')
    restoreFocus = $(`#${view}-title`)
}

async function switchView(next) {
  if (next === view) {
    closeNavigation()
    return
  }
  if (!await guard())
    return
  if (next === 'overview' || next === 'files')
    await loadState()
  // A discarded draft must not reappear when returning to configuration.
  if (current) {
    current.draft = structuredClone(current.base)
    renderEditor()
  }
  showView(next)
  renderDocumentList()
}

async function selectDocument(path, fieldKey) {
  if (view === 'documents' && current?.path === path) {
    closeNavigation()
    focusField(fieldKey)
    return
  }
  if (await guard())
    await openDocument(path, fieldKey)
}

function node(tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined)
    element.textContent = text
  if (className)
    element.className = className
  return element
}

function button(text, action, className = '') {
  const element = node('button', text, className)
  element.type = 'button'
  element.addEventListener('click', () => perform(action))
  return element
}

function notice(message, error = false, issues = []) {
  const target = $('#notice')
  target.replaceChildren(node('p', message))
  target.classList.toggle('error', error)
  target.hidden = false
  if (issues.length) {
    const list = node('ul')
    for (const issue of issues)
      list.append(node('li', issue.message))
    target.append(list)
  }
  scroll.setSectionOffset(target, 0)
}

async function api(route, { method = 'GET', data, body, binary = false } = {}) {
  const headers = {}
  if (token)
    headers['X-Lazyapp-Token'] = token
  if (data !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(data)
  }
  const response = await fetch(route, { method, headers, body, cache: 'no-store' })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ message: `请求失败（${response.status}）` }))
    throw Object.assign(new Error(detail.message), detail)
  }
  return binary ? response : response.json()
}

async function perform(action) {
  if (busy)
    return
  busy = true
  actionFocus = document.activeElement
  const activeList = actionFocus.closest('[role=list]')
  const list = activeList === $('#file-list') ? fileList : activeList === $('#doctor-list') ? doctorList : navigationLists.get(activeList?.id)
  const restoreListFocus = list?.rememberFocus()
  $('#app').inert = true
  $('#workspace-navigation').inert = true
  $('#app').setAttribute('aria-busy', 'true')
  $('#activity').textContent = '处理中…'
  try {
    await scroll.preserve(action)
  }
  catch (error) {
    await scroll.preserve(() => notice(error.message || '操作失败，请显式重试。', true, error.issues))
  }
  finally {
    busy = false
    $('#app').inert = false
    $('#workspace-navigation').inert = false
    $('#app').setAttribute('aria-busy', 'false')
    if (restoreFocus?.isConnected)
      restoreFocus.focus({ preventScroll: true })
    else if (!restoreListFocus?.() && actionFocus?.isConnected && actionFocus.getClientRects().length)
      actionFocus.focus({ preventScroll: true })
    restoreFocus = null
    actionFocus = null
    $('#activity').textContent = isDirty() ? '有未保存修改' : '本地工作区就绪'
  }
}

function modal(title, build) {
  const dialog = $('#modal')
  const previous = actionFocus || document.activeElement
  const body = $('#modal-body')
  body.replaceChildren(node('h2', title))
  body.firstChild.id = 'modal-title'
  return new Promise((resolve) => {
    let result = null
    const finish = (value) => {
      result = value
      dialog.close()
    }
    dialog.addEventListener('close', () => {
      scroll.unlock(dialog)
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        previewUrl = null
      }
      restoreFocus = previous
      resolve(result)
    }, { once: true })
    build(body, finish)
    scroll.lock(dialog)
    dialog.showModal()
    // Cancel is first and always receives initial focus without moving the page behind it.
    dialog.querySelector('button').focus({ preventScroll: true })
  })
}

function choose(title, message, options) {
  return modal(title, (body, finish) => {
    body.append(node('p', message))
    const actions = node('div', undefined, 'modal-actions')
    for (const [value, label, style] of options) {
      const action = node('button', label, style)
      action.type = 'button'
      action.addEventListener('click', () => finish(value))
      actions.append(action)
    }
    body.append(actions)
  })
}

function formDialog(title, description, fields, submitLabel) {
  return modal(title, (body, finish) => {
    if (description)
      body.append(node('p', description))
    const form = node('form', undefined, 'modal-form')
    for (const field of fields) {
      const label = node('label', field.label)
      const input = node(field.options ? 'select' : 'input')
      input.name = field.key
      if (field.options) {
        for (const [value, text] of field.options) {
          const option = node('option', text)
          option.value = value
          input.append(option)
        }
      }
      else {
        input.type = field.type || 'text'
        input.required = Boolean(field.required)
      }
      input.value = field.value || ''
      label.append(input)
      form.append(label)
    }
    const actions = node('div', undefined, 'modal-actions')
    const cancel = node('button', '取消')
    cancel.type = 'button'
    cancel.addEventListener('click', () => finish(null))
    const submit = node('button', submitLabel, 'primary')
    submit.type = 'submit'
    actions.append(cancel, submit)
    form.append(actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      finish(Object.fromEntries(new FormData(form)))
    })
    body.append(form)
  })
}

function isDirty() {
  return current !== null && JSON.stringify(current.draft) !== JSON.stringify(current.base)
}

function updateDirty() {
  const badge = $('#dirty-badge')
  if (badge) {
    badge.textContent = isDirty() ? '未保存' : '无未保存修改'
    badge.classList.toggle('dirty', isDirty())
  }
  $('#activity').textContent = isDirty() ? '有未保存修改' : '本地工作区就绪'
}

async function guard() {
  if (!isDirty())
    return true
  const choice = await choose('未保存的修改', '保存后继续，或放弃当前草稿。取消将保留当前页面与草稿。', [[null, '取消'], ['discard', '放弃修改', 'danger'], ['save', '保存并继续', 'primary']])
  if (choice === 'save')
    await saveCurrent()
  return choice === 'discard' || choice === 'save'
}

function fieldsFor(info) {
  return workspace.fields[info.kind][info.scope || 'all']
}

function cleanDraft(info) {
  if (info.data)
    return structuredClone(info.data)
  const draft = { schemaVersion: 1 }
  for (const field of fieldsFor(info))
    draft[field.key] = field.type === 'files' ? [] : field.type === 'number' ? null : ''
  if (info.kind === 'app') {
    draft.platforms = []
    draft.environments = []
  }
  if (['environment', 'service', 'store'].includes(info.kind))
    draft.name = info.name || ''
  return draft
}

function documentTitle(info) {
  return `${labels[info.kind] || info.kind}${info.name ? ` · ${info.name}` : ''}${info.environment ? ` · ${info.environment}` : ''}${info.scope === 'signing' ? ' · 签名' : ''}`
}

async function loadState() {
  workspace = await api('/api/state')
  expiryDay = localDay()
  $('#root').textContent = workspace.root
  $('#document-count').textContent = workspace.documents.length
  $('#file-count').textContent = workspace.files.length
  renderDocumentList()
  renderFiles()
  renderOverview()
}

function localDay() {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
}

async function refreshExpiries(force = false) {
  if (!workspace || view !== 'overview' || document.hidden || busy || $('#modal').open || refreshingExpiries || (!force && expiryDay === localDay()))
    return
  refreshingExpiries = true
  const previousWorkspace = workspace
  try {
    const state = await api('/api/state')
    if (lifecycle.signal.aborted || workspace !== previousWorkspace || view !== 'overview' || document.hidden || busy || $('#modal').open)
      return
    workspace.expiries = state.expiries
    expiryDay = localDay()
    await scroll.preserve(() => $('#expiry-reminders').replaceWith(renderExpiries()))
  }
  catch {
    const status = $('#expiry-refresh-status')
    if (status)
      status.textContent = '到期提醒更新失败；当前结果可能已过时，可点击重新加载重试。'
  }
  finally {
    refreshingExpiries = false
  }
}

function renderExpiries() {
  const section = node('section', undefined, 'panel expiry-reminders')
  section.id = 'expiry-reminders'
  const heading = node('div', undefined, 'section-heading')
  heading.append(node('h2', '到期提醒'))
  section.append(heading)
  const expiries = workspace.expiries
  const reminders = expiries.filter(expiry => ['soon', 'today', 'expired', 'invalid'].includes(expiry.status))
  if (!reminders.some(expiry => expiry.status !== 'invalid'))
    section.append(node('p', '已填写的日期中，暂无已过期或将在 30 天内到期的凭据或材料。'))
  for (const expiry of reminders) {
    const row = node('div', undefined, 'overview-row')
    const identity = node('div')
    identity.append(node('div', expiry.label, 'file-name'))
    identity.append(node('div', [labels[expiry.kind] || expiry.kind, expiry.environment, expiry.name].filter(Boolean).join(' · '), 'hint'))
    const detail = node('div', undefined, 'overview-row-status')
    const message = expiry.status === 'invalid'
      ? '日期无效，请修正'
      : expiry.status === 'expired'
        ? `截止 ${expiry.value} · 已过期 ${Math.abs(expiry.days)} 天`
        : expiry.status === 'today'
          ? `截止 ${expiry.value} · 今天到期（剩余 0 天）`
          : `截止 ${expiry.value} · 剩余 ${expiry.days} 天`
    detail.append(node('span', message, 'missing'))
    const action = button(expiry.status === 'invalid' ? '修正日期' : '编辑有效期', () => selectDocument(expiry.path, expiry.key), 'small')
    action.setAttribute('aria-label', `${expiry.label} · ${expiry.environment || labels[expiry.kind] || expiry.kind} · ${action.textContent}`)
    row.append(identity, detail, action)
    section.append(row)
  }
  const unset = expiries.filter(expiry => expiry.status === 'unset').length
  if (unset)
    section.append(node('p', `已有文件引用但未设置有效期：${unset} 项；日期未知，不参与到期提醒。`, 'hint'))
  const status = node('p', '仅按手填日期提醒；未填写、长期或暂无提醒均不代表凭据有效。', 'hint')
  status.id = 'expiry-refresh-status'
  section.append(status)
  return section
}

function renderOverview() {
  const target = $('#overview-content')
  const documents = workspace.documents
  const app = documents.find(info => info.kind === 'app')?.data || {}
  const platforms = Array.isArray(app.platforms) ? app.platforms.filter(kind => workspace.platforms.includes(kind)) : []
  const files = workspace.files.filter(file => !file.external)
  const profile = node('section', undefined, 'panel overview-profile')
  const heading = node('div', undefined, 'section-heading')
  heading.append(node('h2', app.name || '未命名 App', 'overview-name'), button('编辑应用信息', () => selectDocument('app.json')))
  profile.append(heading)
  if (app.description)
    profile.append(node('p', app.description, 'overview-description'))
  const metadata = node('dl', undefined, 'overview-metadata')
  for (const [label, value] of [
    ['版本', app.version || '未设置'],
    ['启用平台', platforms.map(kind => labels[kind]).join('、') || '未启用'],
    ['环境', workspace.environments.join('、') || '未设置'],
  ]) {
    const row = node('div')
    row.append(node('dt', label), node('dd', value))
    metadata.append(row)
  }
  profile.append(metadata)
  const stats = node('dl', undefined, 'overview-stats')
  for (const [label, count] of [
    ['已有配置', documents.filter(info => !info.missing).length],
    ['已有工作区文件', files.filter(file => !file.missing).length],
    ['启用平台', platforms.length],
    ['环境', workspace.environments.length],
  ]) {
    const stat = node('div')
    stat.append(node('dt', label), node('dd', String(count)))
    stats.append(stat)
  }
  const configurations = node('section', undefined, 'panel overview-configurations')
  const title = node('div', undefined, 'section-heading')
  title.append(node('h2', '配置清单'), button('新建配置', createDocument, 'small'))
  configurations.append(title)
  for (const kind of ['assets', ...workspace.platforms, 'service', 'environment', 'store']) {
    const entries = documents.filter(info => info.kind === kind)
    const present = entries.filter(info => !info.missing).length
    const label = node('div', undefined, 'overview-row-label')
    label.append(node('span', labels[kind] || kind))
    if (workspace.platforms.includes(kind))
      label.append(node('span', platforms.includes(kind) ? '已启用' : '未启用', 'badge'))
    const counts = node('div', undefined, 'overview-row-status')
    counts.append(node('span', `存在 ${present}`, present ? 'present' : ''))
    if (entries.length > present)
      counts.append(node('span', `缺失 ${entries.length - present}`, 'missing'))
    if (!entries.length)
      counts.append(node('span', '暂无配置'))
    const document = entries.find(info => !info.missing) || entries[0]
    const action = document
      ? button('查看配置', () => selectDocument(document.path), 'small')
      : button('新建配置', () => createDocument(kind), 'small')
    action.setAttribute('aria-label', `${document ? '查看' : '新建'}${labels[kind] || kind}配置`)
    const row = node('div', undefined, 'overview-row')
    row.append(label, counts, action)
    configurations.append(row)
  }
  configurations.append(node('p', '存在仅表示文件已创建，不代表凭据有效或已具备发布条件。', 'hint'))
  const tools = node('section', undefined, 'panel')
  const toolsHeading = node('div', undefined, 'section-heading')
  toolsHeading.append(node('h2', '文件与检查'))
  tools.append(toolsHeading)
  const fileRow = node('div', undefined, 'overview-row')
  const external = workspace.files.filter(file => file.external).length
  fileRow.append(
    node('span', '文件与材料'),
    node('span', `存在 ${files.filter(file => !file.missing).length} · 缺失 ${files.filter(file => file.missing).length}${external ? ` · 外部引用 ${external}` : ''}`, 'overview-row-status'),
    button('查看清单', () => switchView('files'), 'small'),
  )
  const doctorRow = node('div', undefined, 'overview-row')
  doctorRow.append(node('span', 'Doctor'), node('span', '按需运行只读诊断', 'overview-row-status'), button('打开诊断', () => switchView('doctor'), 'small'))
  tools.append(fileRow, doctorRow)
  target.replaceChildren(renderExpiries(), profile, stats, configurations, tools)
}

async function openDocument(path, fieldKey) {
  const info = await api(`/api/document?path=${encodeURIComponent(path)}`)
  const draft = cleanDraft(info)
  current = { ...info, draft, base: structuredClone(draft) }
  if (workspace.platforms.includes(info.kind))
    expandedPlatforms.add(info.kind)
  if (['service', 'environment', 'store'].includes(info.kind))
    collection = info.kind
  showView('documents', `document:${path}`)
  renderDocumentList()
  renderEditor()
  focusField(fieldKey)
}

function focusField(key) {
  const input = key && document.getElementById(`field-${key}`)
  if (input) {
    restoreFocus = input
    scroll.scrollToAnchor(input)
  }
}

function renderDocumentList() {
  const query = $('#document-search').value.trim().toLocaleLowerCase()
  const documents = workspace.documents.filter(info => `${documentTitle(info)} ${info.path}`.toLocaleLowerCase().includes(query))
  const appendEntries = (target, entries, compact = false) => {
    let list = navigationLists.get(target.id)
    if (!list) {
      list = createVirtualList({ element: target, scroll, rowHeight: 44, keyOf: info => info.path, label: '配置清单', renderRow: (info) => {
        const selected = view === 'documents' && current?.path === info.path
        const entry = button('', () => selectDocument(info.path), `document-item ${info.missing ? 'missing' : 'present'}${selected ? ' selected' : ''}`)
        entry.setAttribute('aria-current', selected ? 'page' : 'false')
        entry.title = info.path
        const title = compact ? info.environment ? `${info.environment} · 签名` : '平台信息' : documentTitle(info)
        entry.append(node('span', title, 'entry-title'), node('span', info.missing ? '缺失' : '存在', 'entry-status'))
        return entry
      } })
      navigationLists.set(target.id, list)
    }
    list.setItems(entries)
    if (!entries.length)
      target.append(node('p', query ? '无匹配项' : '暂无配置', 'empty-list'))
  }
  appendEntries($('#app-documents'), documents.filter(info => ['app', 'assets'].includes(info.kind)))
  const platforms = $('#platform-documents')
  for (const [id, list] of navigationLists) {
    if (id.startsWith('platform-')) {
      list.destroy()
      navigationLists.delete(id)
    }
  }
  platforms.replaceChildren()
  for (const kind of workspace.platforms) {
    const entries = documents.filter(info => info.kind === kind)
    if (query && !entries.length)
      continue
    const branch = node('details', undefined, 'platform-branch')
    branch.open = Boolean(query) || expandedPlatforms.has(kind)
    const summary = node('summary', labels[kind])
    summary.append(node('span', `${entries.filter(info => !info.missing).length}/${entries.length}`, 'count'))
    const children = node('div', undefined, 'platform-children')
    children.id = `platform-${kind}-entries`
    appendEntries(children, entries.toSorted((a, b) => Number(Boolean(a.environment)) - Number(Boolean(b.environment)) || a.path.localeCompare(b.path)), true)
    branch.append(summary, children)
    branch.addEventListener('toggle', () => {
      if (branch.open)
        expandedPlatforms.add(kind)
      else
        expandedPlatforms.delete(kind)
    })
    platforms.append(branch)
  }
  for (const kind of ['service', 'environment', 'store']) {
    const target = $(`#${kind}-documents`)
    appendEntries(target.firstElementChild, documents.filter(info => info.kind === kind))
    target.hidden = collection !== kind && !query
    const tab = $(`#${kind}-tab`)
    tab.setAttribute('aria-selected', String(collection === kind))
    tab.tabIndex = collection === kind ? 0 : -1
  }
}

function screenshotReferences(field) {
  const value = current.draft[field.key]
  return Array.isArray(value) ? [...value] : value ? [value] : []
}

function renderScreenshots(field) {
  const group = node('div', undefined, 'field wide screenshot-field')
  const references = screenshotReferences(field)
  const toolbar = node('div', undefined, 'screenshot-toolbar')
  const heading = node('div', undefined, 'screenshot-heading')
  const title = node('h2', field.label, 'field-label')
  title.id = `field-${field.key}`
  title.tabIndex = -1
  heading.append(title, node('span', `${references.length} 张`, 'count'))
  toolbar.append(heading)
  group.append(toolbar)
  const redraw = (index = 0) => {
    renderEditor()
    restoreFocus = document.getElementById(`screenshot-${field.key}-${index}`) || document.getElementById(title.id)
  }
  const setReferences = (values, index) => {
    current.draft[field.key] = values
    redraw(index)
  }
  if (!references.length)
    group.append(node('p', '尚未添加截图。', 'hint'))
  const list = node('ol', undefined, 'screenshot-list')
  list.setAttribute('aria-labelledby', title.id)
  references.forEach((reference, index) => {
    const item = node('li', undefined, 'screenshot-item')
    item.id = `screenshot-${field.key}-${index}`
    item.tabIndex = -1
    const path = typeof reference === 'string' ? internalReference(reference) : ''
    const external = /^(?:\/|[a-z]:[\\/])/i.test(path)
    const file = workspace.files.find(file => file.path === path)
    const present = file && !file.missing && !file.unsafe
    const original = typeof reference === 'string' ? reference : ''
    const filename = original.replaceAll('\\', '/').split('/').at(-1)
    const header = node('div', undefined, 'screenshot-meta')
    header.append(node('span', String(index + 1).padStart(2, '0'), 'screenshot-number'), node('span', external ? '外部 · 只读' : present ? '存在' : '缺失', `file-reference-status ${external ? '' : present ? 'present' : 'missing'}`))
    const visual = !external && present ? fileVisual(file) : node('div', external ? '外部只读图片' : '图片缺失', 'file-visual screenshot-placeholder')
    const name = node('div', filename || '无效引用，请移除后重新添加', 'screenshot-name')
    name.title = filename || ''
    const location = node('details', undefined, 'screenshot-location')
    location.append(node('summary', '文件位置'), node('p', original || '无效引用', 'path'))
    const actions = node('div', undefined, 'screenshot-actions')
    const preview = button('预览', () => showFile(reference), 'small')
    preview.disabled = external || !present
    const move = (offset) => {
      const values = screenshotReferences(field)
      ;[values[index], values[index + offset]] = [values[index + offset], values[index]]
      setReferences(values, index + offset)
    }
    const up = button('↑', () => move(-1), 'small')
    const down = button('↓', () => move(1), 'small')
    up.disabled = index === 0
    down.disabled = index === references.length - 1
    const remove = button('移除', () => setReferences(references.filter((_, position) => position !== index), Math.max(0, index - 1)), 'small danger')
    for (const [action, label] of [[preview, '预览 / 下载'], [up, '上移'], [down, '下移'], [remove, '移除引用']]) {
      action.setAttribute('aria-label', `${label} 截图 ${index + 1}`)
      action.title = label
    }
    actions.append(preview, up, down, remove)
    item.append(header, visual, name, actions, location)
    list.append(item)
  })
  group.append(list)
  const chooser = node('input')
  chooser.type = 'file'
  chooser.id = `upload-${field.key}`
  chooser.multiple = true
  chooser.accept = 'image/png,image/jpeg,image/webp,image/gif'
  chooser.hidden = true
  chooser.addEventListener('change', () => {
    const files = [...chooser.files]
    chooser.value = ''
    if (files.length)
      void perform(() => importScreenshots(field, files))
  })
  const actions = node('div', undefined, 'screenshot-tools')
  actions.append(button('上传截图', () => chooser.click(), 'small primary'), button('添加引用', async () => {
    const answer = await formDialog('添加截图引用', '工作区相对路径，或只读外部绝对路径。不复制或删除文件。', [{ key: 'path', label: '截图文件路径', required: true }], '添加引用')
    if (!answer)
      return
    const values = screenshotReferences(field)
    if (values.includes(answer.path))
      throw new Error('此截图已在列表中。')
    setReferences([...values, answer.path], values.length)
  }, 'small'), chooser)
  toolbar.append(actions)
  group.append(node('p', '支持多选上传，按顺序保存。移除只取消引用，不删除图片；未检查上架规格。', 'hint'))
  return group
}

async function importScreenshots(field, files) {
  const directory = current.kind === 'store' ? `assets/screenshots/${current.name}` : 'assets/screenshots'
  const answer = await formDialog('导入截图', '按所选文件顺序逐张导入；可在列表中调整顺序。文件立即写入，放弃草稿不会撤销已完成的导入；中途失败保留已成功的文件与引用。', [{ key: 'directory', label: '工作区相对目标目录', value: directory, required: true }], `导入 ${files.length} 张截图`)
  if (!answer)
    return
  for (const file of files) {
    const destination = `${answer.directory}/${file.name}`
    if (!await upload(file, destination))
      continue
    const values = screenshotReferences(field)
    if (!values.includes(destination))
      current.draft[field.key] = [...values, destination]
    renderEditor()
  }
  restoreFocus = document.getElementById(`field-${field.key}`)
  notice('截图导入完成。请保存配置以提交顺序和引用；放弃草稿不会删除已导入图片。')
}

function renderEditor() {
  const editor = $('#editor')
  editor.replaceChildren()
  if (!current) {
    const empty = node('div', undefined, 'empty')
    empty.append(node('h2', '选择配置'))
    editor.append(empty)
    return
  }
  const heading = node('div', undefined, 'editor-heading')
  heading.tabIndex = -1
  restoreFocus = heading
  const meta = node('div', undefined, 'editor-meta')
  const dirty = node('span', undefined, 'badge')
  dirty.id = 'dirty-badge'
  meta.append(node('span', current.missing ? '尚未创建' : '已存在', 'badge'), dirty)
  heading.append(node('h1', documentTitle(current)), node('div', current.path, 'path'), meta)
  editor.append(heading)
  const form = node('form')
  form.id = 'document-form'
  const sections = new Map()
  function sectionFor(field) {
    const key = field.type === 'date' ? '凭据有效期' : ['file', 'files'].includes(field.type) ? '文件引用' : field.type === 'secret' || current.scope === 'signing' ? '凭据与签名' : '基本信息'
    if (!sections.has(key)) {
      const card = node('fieldset', undefined, 'editor-section')
      card.append(node('legend', key))
      const grid = node('div', undefined, 'form-grid')
      card.append(grid)
      sections.set(key, { card, grid })
      form.append(card)
    }
    return sections.get(key).grid
  }
  for (const field of fieldsFor(current)) {
    if (field.type === 'files') {
      sectionFor(field).append(renderScreenshots(field))
      continue
    }
    const group = node('div', undefined, `field${field.type === 'file' || /description|notes|variables/i.test(field.key) ? ' wide' : ''}`)
    const label = node('label', field.label, 'field-label')
    label.htmlFor = `field-${field.key}`
    if (field.required)
      label.append(node('span', '*', 'required'))
    group.append(label)
    const input = node(/description|notes|variables/i.test(field.key) && field.type !== 'secret' ? 'textarea' : 'input')
    input.id = `field-${field.key}`
    input.name = field.key
    if (input.tagName === 'INPUT')
      input.type = field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'
    input.autocomplete = 'off'
    input.required = Boolean(field.required)
    input.spellcheck = false
    if (field.type === 'number') {
      input.min = '1'
      input.step = '1'
    }
    const value = current.draft[field.key]
    input.value = Array.isArray(value) ? value.join(', ') : value ?? ''
    if (field.type === 'date') {
      // Keep raw invalid dates visible: native date inputs silently erase them.
      input.placeholder = 'YYYY-MM-DD（留空表示未知）'
      input.pattern = '[0-9]{4}-[0-9]{2}-[0-9]{2}'
      input.maxLength = 10
      const hint = node('p', '选填，格式 YYYY-MM-DD，请填写真实公历日期；留空表示未知，不参与提醒。', 'hint')
      hint.id = `hint-${field.key}`
      input.setAttribute('aria-describedby', hint.id)
      group.append(hint)
      if (field.allowPermanent) {
        const mode = node('select')
        mode.setAttribute('aria-label', `${field.label}填写方式`)
        mode.id = `field-${field.key}-mode`
        mode.setAttribute('aria-describedby', hint.id)
        for (const [value, text] of [['unset', '未知 / 未填写'], ['date', '填写截止日期'], ['never', '长期有效']]) {
          const option = node('option', text)
          option.value = value
          mode.append(option)
        }
        mode.value = value === 'never' ? 'never' : value === '' || value === null || value === undefined ? 'unset' : 'date'
        let datedValue = mode.value === 'date' ? input.value : ''
        const updateMode = () => {
          input.disabled = mode.value !== 'date'
          input.hidden = input.disabled
          input.value = mode.value === 'date' ? datedValue : ''
          label.htmlFor = input.disabled ? mode.id : input.id
        }
        mode.addEventListener('change', () => {
          if (!input.disabled)
            datedValue = input.value
          updateMode()
          current.draft[field.key] = mode.value === 'never' ? 'never' : mode.value === 'date' ? input.value : ''
          updateDirty()
        })
        updateMode()
        group.append(mode)
      }
    }
    input.addEventListener('input', () => {
      if (current.kind === 'app' && ['platforms', 'environments'].includes(field.key))
        current.draft[field.key] = input.value.split(',').map(value => value.trim()).filter(Boolean)
      else
        current.draft[field.key] = field.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value
      updateDirty()
    })
    const row = node('div', undefined, 'input-row')
    row.append(input)
    if (field.type === 'secret') {
      row.append(button('显示', () => {
        input.type = input.type === 'password' ? 'text' : 'password'
        row.lastChild.textContent = input.type === 'password' ? '显示' : '隐藏'
      }, 'small'))
    }
    group.append(row)
    if (field.type === 'file') {
      const actions = node('div', undefined, 'field-actions')
      const chooser = node('input')
      chooser.type = 'file'
      chooser.hidden = true
      chooser.addEventListener('change', () => {
        const file = chooser.files[0]
        chooser.value = ''
        if (file)
          void perform(() => importField(field, file))
      })
      const previewButton = button('预览 / 下载', () => showFile(current.draft[field.key]), 'small')
      actions.append(button('上传并引用', () => chooser.click(), 'small'), previewButton, button('移除引用', () => {
        input.value = ''
        input.dispatchEvent(new Event('input'))
      }, 'small'), chooser)
      const referenceStatus = node('p', undefined, 'file-reference-status')
      const referenceVisual = node('div', undefined, 'field-file-preview')
      const updateReference = () => {
        const path = internalReference(input.value)
        const external = /^(?:\/|[a-z]:[\\/])/i.test(path)
        const file = workspace.files.find(file => file.path === path)
        referenceStatus.textContent = !path ? '未设置' : external ? '外部引用 · 只读（网页不读取）' : file && !file.missing ? '存在' : '缺失'
        referenceStatus.className = `file-reference-status ${!path || external ? '' : file && !file.missing ? 'present' : 'missing'}`
        previewButton.disabled = !path || external || !file || file.missing || file.unsafe
        referenceVisual.replaceChildren()
        referenceVisual.hidden = previewButton.disabled
        if (!referenceVisual.hidden)
          referenceVisual.append(fileVisual(file))
      }
      input.addEventListener('input', updateReference)
      updateReference()
      group.append(actions, referenceStatus, referenceVisual)
    }
    sectionFor(field).append(group)
  }
  const actions = node('div', undefined, 'editor-actions')
  const save = node('button', '保存配置', 'primary')
  save.type = 'submit'
  actions.append(save, button('重新加载', async () => {
    if (await guard())
      await openDocument(current.path)
  }), button('放弃修改', async () => {
    const answer = await choose('放弃当前草稿？', '不会撤回已独立上传的附件；配置文件不会写入。', [[null, '取消'], ['discard', '放弃修改', 'danger']])
    if (answer === 'discard') {
      current.draft = structuredClone(current.base)
      renderEditor()
    }
  }))
  if (current.path !== 'app.json' && !current.missing)
    actions.append(button('删除配置', deleteDocument, 'danger'))
  form.append(actions)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void perform(saveCurrent)
  })
  editor.append(form)
  updateDirty()
}

async function saveCurrent() {
  const form = $('#document-form')
  if (!form.checkValidity()) {
    restoreFocus = form.querySelector(':invalid')
    scroll.scrollToAnchor(restoreFocus)
    throw new Error('请补全必填字段，并检查日期是否符合 YYYY-MM-DD 格式。')
  }
  const focusedId = form.contains(actionFocus) ? actionFocus.id : ''
  const focusedSubmit = form.contains(actionFocus) && actionFocus.type === 'submit'
  const saved = await api('/api/document', { method: 'PUT', data: { path: current.path, data: current.draft, revision: current.revision } })
  current = { ...saved, draft: structuredClone(saved.data), base: structuredClone(saved.data) }
  renderEditor()
  if (focusedId)
    restoreFocus = document.getElementById(focusedId) || restoreFocus
  else if (focusedSubmit)
    restoreFocus = $('#document-form button[type=submit]')
  notice(`已保存 ${saved.path}`)
  await loadState()
}

async function deleteDocument() {
  if (!await guard())
    return
  const answer = await choose('删除这份配置？', `${current.path}\n只删除此文件，示例保留。此操作不能撤销。`, [[null, '取消'], ['delete', '删除配置', 'danger']])
  if (answer !== 'delete')
    return
  await api('/api/document', { method: 'DELETE', data: { path: current.path, revision: current.revision } })
  current = null
  renderEditor()
  await loadState()
  notice('已删除配置；引用可能缺失，请运行诊断。')
}

async function upload(file, destination) {
  if (file.size > 32 * 1024 * 1024)
    throw new Error('文件超过 32 MiB 上传上限。')
  const info = await api(`/api/file-info?path=${encodeURIComponent(destination)}`)
  if (info.revision !== null) {
    const choice = await choose('覆盖已有文件？', `${destination}\n将替换原始文件，不能撤销。`, [[null, '取消'], ['overwrite', '覆盖文件', 'danger']])
    if (choice !== 'overwrite')
      return false
  }
  await api(`/api/file?path=${encodeURIComponent(destination)}&revision=${info.revision}`, { method: 'PUT', body: file })
  await loadState()
  return true
}

async function importField(field, file) {
  const directory = workspace.platforms.includes(current.kind) ? current.path.slice(0, current.path.lastIndexOf('/')) : 'assets/materials'
  const answer = await formDialog('导入并设置引用', '文件立即写入；放弃配置草稿不会撤销导入。', [{ key: 'path', label: '工作区相对目标路径', value: `${directory}/${file.name}`, required: true }], '导入文件')
  if (!answer || !await upload(file, answer.path))
    return
  current.draft[field.key] = answer.path
  renderEditor()
  notice('文件已导入。请保存配置以提交引用；放弃草稿不会撤销文件导入。')
}

function internalReference(value) {
  const root = workspace.root.replaceAll('\\', '/')
  const normalized = value.replaceAll('\\', '/')
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : value
}

async function showFile(path) {
  if (!path)
    throw new Error('尚未设置文件引用。')
  path = internalReference(path)
  if (/^(?:\/|[a-z]:[\\/])/i.test(path))
    throw new Error('外部引用只读，网页不读取或下载外部文件。')
  const response = await api(`/api/file?path=${encodeURIComponent(path)}`, { binary: true })
  const blob = await response.blob()
  const inline = response.headers.get('content-disposition')?.startsWith('inline')
  if (!inline) {
    downloadBlob(blob, path)
    notice(`已请求下载 ${path}`)
    return
  }
  previewUrl = URL.createObjectURL(blob)
  await modal('原始图片预览', (body, finish) => {
    body.append(node('p', path))
    const image = node('img', undefined, 'preview')
    image.src = previewUrl
    image.alt = path
    image.width = 800
    image.height = 600
    body.append(image, node('p', '仅预览原始文件，不验证资料有效性。', 'hint'))
    const actions = node('div', undefined, 'modal-actions')
    const close = node('button', '关闭')
    close.type = 'button'
    close.addEventListener('click', () => finish(null))
    const download = node('button', '下载原文件')
    download.type = 'button'
    download.addEventListener('click', () => downloadBlob(blob, path))
    actions.append(close, download)
    body.append(actions)
  })
}

function downloadBlob(blob, path) {
  const url = URL.createObjectURL(blob)
  const link = node('a')
  link.href = url
  link.download = path.split('/').at(-1)
  document.body.append(link)
  link.click()
  link.remove()
  // The download consumes the URL asynchronously in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function renderFiles() {
  fileList.setItems(workspace.files)
  if (!workspace.files.length)
    $('#file-list').append(node('p', '暂无文件。', 'empty-list'))
}

function fileIcon(path) {
  const extension = path.replace(/\.example$/i, '').split('.').at(-1).toLowerCase()
  const types = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'],
    pdf2: ['pdf'],
    json: ['json'],
    text: ['txt', 'log', 'csv'],
    zip: ['zip', 'gz', 'tar', '7z', 'rar'],
    video: ['mp4', 'mov', 'webm'],
    audio: ['mp3', 'wav', 'ogg', 'm4a'],
    key: ['key', 'keystore', 'jks', 'p12', 'pfx'],
    cert: ['pem', 'cer', 'crt', 'mobileprovision'],
    font: ['ttf', 'otf', 'woff', 'woff2'],
    excel: ['xls', 'xlsx'],
    word: ['doc', 'docx'],
    markdown: ['md'],
    xml: ['xml', 'plist'],
  }
  const type = Object.keys(types).find(type => types[type].includes(extension))
  const icon = node('span', undefined, `file-icon i-vscode-icons-${type ? `file-type-${type}` : 'default-file'}`)
  icon.setAttribute('aria-hidden', 'true')
  return icon
}

function fileVisual(file) {
  const visual = node('div', undefined, 'file-visual')
  visual.append(fileIcon(file.path))
  if (!file.external && !file.missing && /\.(?:png|jpe?g|gif|webp)$/i.test(file.path)) {
    const preview = button('', () => showFile(file.path), 'thumbnail-button')
    preview.setAttribute('aria-label', `预览 ${file.path}`)
    const image = node('img', undefined, 'file-thumbnail')
    image.alt = ''
    image.decoding = 'async'
    preview.append(image)
    void api(`/api/file?path=${encodeURIComponent(file.path)}`, { binary: true }).then(async (response) => {
      if (!response.headers.get('content-disposition')?.startsWith('inline'))
        return
      const blob = await response.blob()
      if (!visual.isConnected)
        return
      const url = URL.createObjectURL(blob)
      image.addEventListener('load', () => {
        URL.revokeObjectURL(url)
        if (visual.isConnected)
          visual.replaceChildren(preview)
      }, { once: true })
      image.addEventListener('error', () => {
        URL.revokeObjectURL(url)
        visual.title = '图片无法解码，可下载原文件。'
      }, { once: true })
      image.src = url
    }).catch(() => {
      visual.title = '图片预览加载失败，可点击预览 / 下载重试。'
    })
  }
  return visual
}

function renderFile(file) {
  const row = node('div', undefined, 'file-row')
  const info = node('div', undefined, 'file-info')
  info.title = file.path
  info.append(node('div', file.path.split('/').at(-1), 'file-name'), node('div', file.path, 'path'), node('p', file.external ? '外部引用 · 只读' : file.missing ? '缺失' : '存在', `file-reference-status ${file.external ? '' : file.missing ? 'missing' : 'present'}`))
  const actions = node('div', undefined, 'file-actions')
  if (!file.external && !file.missing) {
    actions.append(button('预览 / 下载', () => showFile(file.path), 'small'), button('下载', async () => {
      const response = await api(`/api/file?path=${encodeURIComponent(file.path)}&download=1`, { binary: true })
      downloadBlob(await response.blob(), file.path)
    }, 'small'), button('删除', async () => {
      const snapshot = await api(`/api/file-info?path=${encodeURIComponent(file.path)}`)
      const choice = await choose('删除这个文件？', `${file.path}\n只删除此文件，不自动清理配置引用。此操作不能撤销。`, [[null, '取消'], ['delete', '删除文件', 'danger']])
      if (choice !== 'delete')
        return
      await api('/api/file', { method: 'DELETE', data: { path: file.path, revision: snapshot.revision } })
      await loadState()
      notice('已删除文件。配置引用可能缺失，请运行诊断。')
    }, 'small danger'))
  }
  const identity = node('div', undefined, 'file-identity')
  identity.append(fileVisual(file), info)
  row.append(identity, actions)
  return row
}

async function createDocument(initialKind) {
  if (!await guard())
    return
  const safeName = value => value && value === value.trim() && value.length <= 120 && !/^\.|\.$|[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(value)
  const kinds = workspace.kinds.filter(kind => kind !== 'app')
  const answer = await modal('新建配置', (body, finish) => {
    body.append(node('p', '保存后创建配置。'))
    const form = node('form', undefined, 'modal-form')
    const kindLabel = node('label', '配置类型')
    const kindInput = node('select')
    kindInput.name = 'kind'
    for (const kind of kinds) {
      const option = node('option', labels[kind] || kind)
      option.value = kind
      kindInput.append(option)
    }
    if (kinds.includes(initialKind))
      kindInput.value = initialKind
    kindLabel.append(kindInput)
    const nameLabel = node('label', '名称（服务 / 环境 / 商店）')
    const nameInput = node('input')
    nameInput.name = 'name'
    nameInput.autocomplete = 'off'
    nameInput.spellcheck = false
    nameLabel.append(nameInput)
    const environmentLabel = node('label', '签名环境（平台配置可选）')
    const environmentInput = node('input')
    environmentInput.name = 'environment'
    environmentInput.autocomplete = 'off'
    environmentInput.spellcheck = false
    environmentInput.setAttribute('list', 'environment-options')
    const datalist = node('datalist')
    datalist.id = 'environment-options'
    for (const environment of workspace.environments || []) {
      const option = node('option')
      option.value = environment
      datalist.append(option)
    }
    environmentLabel.append(environmentInput)
    form.append(kindLabel, nameLabel, environmentLabel, datalist)
    function refresh() {
      const kind = kindInput.value
      nameLabel.hidden = !['service', 'environment', 'store'].includes(kind)
      environmentLabel.hidden = !workspace.platforms.includes(kind)
      nameInput.required = !nameLabel.hidden
      nameInput.disabled = nameLabel.hidden
      environmentInput.disabled = environmentLabel.hidden
    }
    kindInput.addEventListener('change', refresh)
    refresh()
    const actions = node('div', undefined, 'modal-actions')
    const cancel = node('button', '取消')
    cancel.type = 'button'
    cancel.addEventListener('click', () => finish(null))
    const submit = node('button', '打开草稿', 'primary')
    submit.type = 'submit'
    actions.append(cancel, submit)
    form.append(actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      finish({ kind: kindInput.value, name: nameLabel.hidden ? '' : nameInput.value, environment: environmentLabel.hidden ? '' : environmentInput.value })
    })
    body.append(form)
  })
  if (!answer)
    return
  let path
  if (answer.kind === 'assets') {
    path = 'assets/config.json'
  }
  else if (workspace.platforms.includes(answer.kind)) {
    if (answer.environment && !safeName(answer.environment))
      throw new Error('环境名称必须是安全的单段目录名。')
    path = `platforms/${answer.kind}/${answer.environment ? `${answer.environment}/` : ''}config.json`
  }
  else {
    if (!safeName(answer.name))
      throw new Error('名称必须是安全的单段文件名。')
    const directory = { service: 'services', environment: 'environments', store: 'store' }[answer.kind]
    path = `${directory}/${answer.name}.json`
  }
  await openDocument(path)
  notice(current.missing ? '已打开干净草稿；只有保存才会创建配置。' : '配置已存在，已打开当前版本。')
}

async function runDoctor() {
  const { results } = await api('/api/doctor')
  const summary = $('#doctor-summary')
  summary.replaceChildren()
  const counts = new Map(Object.keys(statuses).map(status => [status, 0]))
  for (const result of results)
    counts.set(result.status, (counts.get(result.status) || 0) + 1)
  for (const [status, label] of Object.entries(statuses))
    summary.append(node('span', `${label} ${counts.get(status)}`, 'badge'))
  doctorList.setItems(results)
}

function renderDoctor(result) {
  const row = node('div', undefined, 'doctor-row')
  const detail = node('div')
  detail.append(node('div', result.label, 'doctor-label'), node('div', result.path, 'path'))
  row.append(node('span', statuses[result.status] || result.status, `doctor-status ${result.status}`), detail)
  return row
}

$('#refresh').addEventListener('click', () => perform(async () => {
  if (!await guard())
    return
  const path = view === 'documents' ? current?.path : null
  await loadState()
  if (path)
    await openDocument(path)
  else if (view === 'doctor')
    await runDoctor()
  notice('已重新加载工作区。')
}))
$('#new-document').addEventListener('click', () => perform(createDocument))
$('#document-search').addEventListener('input', () => {
  void scroll.preserve(renderDocumentList)
})
$('#toggle-navigation').addEventListener('click', openNavigation)
$('#close-navigation').addEventListener('click', closeNavigation)
navigationDrawer.addEventListener('close', finishNavigation)
navigationDrawer.addEventListener('cancel', () => scroll.rememberSections(navigationDrawer))
navigationQuery.addEventListener('change', () => {
  if (!navigationQuery.matches)
    closeNavigation()
}, { signal: lifecycle.signal })
$('.skip').addEventListener('click', (event) => {
  event.preventDefault()
  scroll.scrollToAnchor($('#content'))
  $('#content').focus({ preventScroll: true })
})
$('#collection-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-collection]')
  if (!tab)
    return
  void scroll.preserve(() => {
    collection = tab.dataset.collection
    renderDocumentList()
  })
})
$('#collection-tabs').addEventListener('keydown', (event) => {
  const kinds = ['service', 'environment', 'store']
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
    return
  event.preventDefault()
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (kinds.indexOf(collection) + (event.key === 'ArrowRight' ? 1 : 2)) % 3
  void scroll.preserve(() => {
    collection = kinds[index]
    renderDocumentList()
    $(`#${collection}-tab`).focus({ preventScroll: true })
  })
})
$('#workspace-navigation').addEventListener('click', (event) => {
  const item = event.target.closest('[data-view]')
  if (!item)
    return
  void perform(() => switchView(item.dataset.view))
})
$('#upload-source').addEventListener('change', () => {
  const file = $('#upload-source').files[0]
  if (file)
    $('#upload-destination').value = `assets/materials/${file.name}`
})
$('#upload-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const file = $('#upload-source').files[0]
  const destination = $('#upload-destination').value
  void perform(async () => {
    if (!file)
      return
    const answer = await choose('导入文件？', `${destination}\n文件立即写入；放弃配置草稿不会撤销导入。`, [[null, '取消'], ['import', '导入文件', 'primary']])
    if (answer !== 'import')
      return
    if (file && await upload(file, destination)) {
      $('#upload-form').reset()
      notice(`已上传 ${destination}`)
    }
  })
})
$('#run-doctor').addEventListener('click', () => perform(runDoctor))
window.addEventListener('beforeunload', (event) => {
  if (isDirty()) {
    event.preventDefault()
    event.returnValue = ''
  }
})
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (view === 'documents' && current && !busy && !$('#modal').open)
      $('#document-form').requestSubmit()
  }
})
const expiryTimer = setInterval(() => void refreshExpiries(), 60_000)
lifecycle.signal.addEventListener('abort', () => clearInterval(expiryTimer), { once: true })
document.addEventListener('visibilitychange', () => {
  if (!document.hidden)
    void refreshExpiries(true)
}, { signal: lifecycle.signal })
window.addEventListener('pagehide', (event) => {
  if (event.persisted)
    return
  closeNavigation()
  fileList.destroy()
  doctorList.destroy()
  for (const list of navigationLists.values())
    list.destroy()
  scroll.destroy()
  lifecycle.abort()
}, { signal: lifecycle.signal })
void perform(async () => {
  token = (await api('/api/session')).token
  await loadState()
  showView('overview')
})
