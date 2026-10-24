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
  $('#app').inert = true
  $('#app').setAttribute('aria-busy', 'true')
  $('#activity').textContent = '处理中…'
  try {
    await action()
  }
  catch (error) {
    notice(error.message || '操作失败，请显式重试。', true, error.issues)
  }
  finally {
    busy = false
    $('#app').inert = false
    $('#app').setAttribute('aria-busy', 'false')
    if (restoreFocus?.isConnected)
      restoreFocus.focus()
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
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        previewUrl = null
      }
      restoreFocus = previous
      resolve(result)
    }, { once: true })
    build(body, finish)
    dialog.showModal()
    // Cancel is first and always receives initial focus.
    dialog.querySelector('button').focus()
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
  renderDocumentList()
  renderEditor()
}

function renderDocumentList() {
  const list = $('#document-list')
  list.replaceChildren()
  const query = $('#document-search').value.toLocaleLowerCase()
  let previousKind
  for (const info of workspace.documents) {
    if (!`${documentTitle(info)} ${info.path}`.toLocaleLowerCase().includes(query))
      continue
    if (previousKind !== info.kind) {
      list.append(node('div', labels[info.kind] || info.kind, 'list-heading'))
      previousKind = info.kind
    }
    const entry = button('', async () => {
      if (current?.path === info.path || !await guard())
        return
      await openDocument(info.path)
    }, `document-item${current?.path === info.path ? ' selected' : ''}`)
    entry.setAttribute('aria-current', current?.path === info.path ? 'true' : 'false')
    const heading = node('strong', documentTitle(info))
    if (info.missing)
      heading.append(node('span', '缺失', 'missing-tag'))
    entry.append(heading, node('small', info.path))
    list.append(entry)
  }
  if (!list.childNodes.length)
    list.append(node('p', '没有匹配的配置。', 'hint'))
}

function renderEditor() {
  const editor = $('#editor')
  editor.replaceChildren()
  if (!current) {
    const empty = node('div', undefined, 'empty')
    empty.append(node('h2', '选择一份配置'), node('p', '从左侧打开配置，或创建新的配置文件。'))
    editor.append(empty)
    return
  }
  const heading = node('div', undefined, 'editor-heading')
  const meta = node('div', undefined, 'editor-meta')
  const dirty = node('span', undefined, 'badge')
  dirty.id = 'dirty-badge'
  meta.append(node('span', current.missing ? '尚未创建 · 保存后生效' : '已存在 · 文件不代表凭据有效', 'badge'), dirty)
  heading.append(node('h2', documentTitle(current)), node('div', current.path, 'path'), meta)
  editor.append(heading)
  const form = node('form')
  form.id = 'document-form'
  const grid = node('div', undefined, 'form-grid')
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
        current.draft[field.key] = ''
        input.value = ''
        updateDirty()
      }, 'small'), chooser)
      group.append(actions, node('p', '可输入工作区相对路径或外部绝对路径。外部引用只读，网页不会读取其内容。上传立即提交；配置引用需另行保存。', 'hint'))
    }
    grid.append(group)
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
  form.append(grid, actions)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void perform(saveCurrent)
  })
  editor.append(form)
  updateDirty()
}

async function saveCurrent() {
  const saved = await api('/api/document', { method: 'PUT', data: { path: current.path, data: current.draft, revision: current.revision } })
  current = { ...saved, draft: structuredClone(saved.data), base: structuredClone(saved.data) }
  renderEditor()
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
  const answer = await formDialog('导入并设置引用', '上传是独立提交，放弃后续配置草稿不会删除此文件。目标路径必须位于工作区内。', [{ key: 'path', label: '工作区相对目标路径', value: `assets/materials/${file.name}`, required: true }], '导入文件')
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
  const list = $('#file-list')
  list.replaceChildren()
  for (const file of workspace.files) {
    const row = node('div', undefined, 'file-row')
    const info = node('div', undefined, 'file-info')
    info.append(node('div', file.path.split('/').at(-1), 'file-name'), node('div', file.path, 'path'), node('p', file.external ? '外部引用 · 只读 · 不通过网页读取' : file.missing ? '缺失 · 示例不是实际文件' : '已存在 · 仅表示文件存在', 'hint'))
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
    list.append(row)
  }
  if (!workspace.files.length)
    list.append(node('p', '暂无附件，使用上方表单上传原始文件。', 'hint'))
}

async function createDocument() {
  if (!await guard())
    return
  const answer = await formDialog('新建配置', '平台根配置不填环境；平台签名配置填环境。服务、环境、商店需填写安全的单段名称。', [
    { key: 'kind', label: '配置类型', options: workspace.kinds.filter(kind => kind !== 'app').map(kind => [kind, labels[kind]]) },
    { key: 'name', label: '名称（服务 / 环境 / 商店）' },
    { key: 'environment', label: '签名环境（平台配置可选）' },
  ], '打开草稿')
  if (!answer)
    return
  const safeName = value => value && value === value.trim() && value.length <= 120 && !/^\.|\.$|[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(value)
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
  const target = $('#doctor-results')
  target.replaceChildren()
  const summary = node('div', undefined, 'doctor-summary')
  for (const [status, label] of Object.entries(statuses))
    summary.append(node('span', `${label} ${results.filter(result => result.status === status).length}`, 'badge'))
  target.append(summary)
  for (const result of results) {
    const row = node('div', undefined, 'doctor-row')
    const detail = node('div')
    detail.append(node('div', result.label, 'doctor-label'), node('div', result.path, 'path'))
    row.append(node('span', statuses[result.status] || result.status, `doctor-status ${result.status}`), detail)
    target.append(row)
  }
}

$('#refresh').addEventListener('click', () => perform(async () => {
  if (!await guard())
    return
  const path = current?.path
  await loadState()
  if (path)
    await openDocument(path)
  notice('已重新加载工作区。')
}))
$('#new-document').addEventListener('click', () => perform(createDocument))
$('#document-search').addEventListener('input', renderDocumentList)
$('#navigation').addEventListener('click', (event) => {
  const item = event.target.closest('[data-view]')
  if (!item || item.dataset.view === view)
    return
  void perform(async () => {
    if (!await guard())
      return
    // A discarded draft must not reappear when returning to configuration.
    if (current) {
      current.draft = structuredClone(current.base)
      renderEditor()
    }
    view = item.dataset.view
    for (const section of ['documents', 'files', 'doctor'])
      $(`#${section}-view`).hidden = section !== view
    for (const entry of $('#navigation').children)
      entry.setAttribute('aria-current', entry === item ? 'page' : 'false')
    if (view === 'files')
      await loadState()
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
void perform(async () => {
  token = (await api('/api/session')).token
  await loadState()
  await openDocument('app.json')
})
