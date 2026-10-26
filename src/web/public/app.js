import { createScrollManager } from './scroll.js'
import { createVirtualList } from './virtual-list.js'

const $ = selector => document.querySelector(selector)
const labels = { app: '应用', assets: '资源与资质', android: 'Android', ios: 'iOS', harmony: 'HarmonyOS', windows: 'Windows', macos: 'macOS', miniprogram: '小程序', service: '第三方服务', environment: '环境', store: '商店' }
const statuses = { pass: '通过', missing: '缺失', warning: '警告', error: '错误', unchecked: '未检查' }
let token
let workspace
let current = null
let view = 'documents'
let busy = false
let restoreFocus = null
let actionFocus = null
let previewUrl = null
let collection = 'service'
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
  scroll.navigate(route, { restore: next !== 'documents' })
  view = next
  for (const section of ['documents', 'files', 'doctor'])
    $(`#${section}-view`).hidden = section !== view
  for (const entry of $('#navigation').children)
    entry.setAttribute('aria-current', entry.dataset.view === view ? 'page' : 'false')
  if (view !== 'documents')
    restoreFocus = $(`#${view}-title`)
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
    draft[field.key] = field.type === 'number' ? null : ''
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
  $('#root').textContent = workspace.root
  $('#document-count').textContent = workspace.documents.length
  $('#file-count').textContent = workspace.files.length
  renderDocumentList()
  renderFiles()
}

async function openDocument(path) {
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
}

function renderDocumentList() {
  const query = $('#document-search').value.trim().toLocaleLowerCase()
  const documents = workspace.documents.filter(info => `${documentTitle(info)} ${info.path}`.toLocaleLowerCase().includes(query))
  const appendEntries = (target, entries, compact = false) => {
    let list = navigationLists.get(target.id)
    if (!list) {
      list = createVirtualList({ element: target, scroll, rowHeight: 44, keyOf: info => info.path, label: '配置清单', renderRow: (info) => {
        const selected = view === 'documents' && current?.path === info.path
        const entry = button('', async () => {
          if (view === 'documents' && current?.path === info.path)
            return
          if (await guard())
            await openDocument(info.path)
        }, `document-item ${info.missing ? 'missing' : 'present'}${selected ? ' selected' : ''}`)
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
    const key = field.type === 'file' ? '文件引用' : field.type === 'secret' || current.scope === 'signing' ? '凭据与签名' : '基本信息'
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
    const group = node('div', undefined, `field${field.type === 'file' || /description|notes|variables/i.test(field.key) ? ' wide' : ''}`)
    const label = node('label', field.label, 'field-label')
    label.htmlFor = `field-${field.key}`
    if (field.required)
      label.append(node('span', '*', 'required'))
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
    input.addEventListener('input', () => {
      if (current.kind === 'app' && ['platforms', 'environments'].includes(field.key))
        current.draft[field.key] = input.value.split(',').map(value => value.trim()).filter(Boolean)
      else
        current.draft[field.key] = field.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value
      updateDirty()
    })
    group.append(label)
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
      actions.append(button('上传并引用', () => chooser.click(), 'small'), button('预览 / 下载', () => showFile(current.draft[field.key]), 'small'), button('移除引用', () => {
        input.value = ''
        input.dispatchEvent(new Event('input'))
      }, 'small'), chooser)
      const referenceStatus = node('p', undefined, 'file-reference-status')
      const updateReference = () => {
        const path = input.value
        const external = /^(?:\/|[a-z]:[\\/])/i.test(path)
        const file = workspace.files.find(file => file.path === path)
        referenceStatus.textContent = !path ? '未设置' : external ? '外部引用 · 只读' : file && !file.missing ? '存在' : '缺失'
        referenceStatus.className = `file-reference-status ${!path || external ? '' : file && !file.missing ? 'present' : 'missing'}`
      }
      input.addEventListener('input', updateReference)
      updateReference()
      group.append(actions, referenceStatus)
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
    throw new Error('请补全标记的必填字段。')
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

async function showFile(path) {
  if (!path)
    throw new Error('尚未设置文件引用。')
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
  row.append(info, actions)
  return row
}

async function createDocument() {
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
$('#navigation').addEventListener('click', (event) => {
  const item = event.target.closest('[data-view]')
  if (!item || item.dataset.view === view)
    return
  void perform(async () => {
    if (!await guard())
      return
    if (item.dataset.view === 'files')
      await loadState()
    // A discarded draft must not reappear when returning to configuration.
    if (current) {
      current.draft = structuredClone(current.base)
      renderEditor()
    }
    showView(item.dataset.view)
    renderDocumentList()
  })
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
  await openDocument('app.json')
})
