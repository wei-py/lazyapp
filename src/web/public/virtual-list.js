const THRESHOLD = 100
const OVERSCAN = 4
const CONTROL_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** Render normal short lists or fixed-height windows while retaining keyed focus. */
export function createVirtualList({ element, scroll, rowHeight, renderRow, keyOf, label }) {
  const document = element.ownerDocument
  const original = {
    role: element.getAttribute('role'),
    label: element.getAttribute('aria-label'),
    tabindex: element.getAttribute('tabindex'),
    section: element.getAttribute('data-scroll-section'),
    virtual: element.classList.contains('virtual-list'),
    height: element.style.getPropertyValue('--virtual-row-height'),
    heightPriority: element.style.getPropertyPriority('--virtual-row-height'),
  }
  const childTag = /^(?:UL|OL)$/.test(element.tagName) ? 'li' : 'div'
  let items = []
  let keys = []
  let indexByKey = new Map()
  let rows = new Map()
  let records = new WeakMap()
  let drawn = []
  let cursor = 0
  let virtual = false
  let invalidated = false
  let destroyed = false

  function restoreAttribute(name, value) {
    if (value === null)
      element.removeAttribute(name)
    else
      element.setAttribute(name, value)
  }

  function rowRecord(target) {
    for (let node = target; node && node !== element; node = node.parentElement) {
      const record = records.get(node)
      if (record)
        return record
    }
    return null
  }

  function controls(row) {
    return [...row.querySelectorAll(CONTROL_SELECTOR)]
  }

  function captureFocus() {
    const active = document.activeElement
    const record = rowRecord(active)
    if (!record)
      return null
    return {
      key: record.key,
      index: record.index,
      control: controls(record.node).indexOf(active),
    }
  }

  function focusedIndex(focus) {
    if (!focus || !items.length)
      return -1
    return indexByKey.has(focus.key) ? indexByKey.get(focus.key) : Math.min(focus.index, items.length - 1)
  }

  function focusRow(index, control = 0) {
    const row = rows.get(keys[index])?.node
    if (!row)
      return
    const candidates = controls(row)
    const target = control < 0 ? row : candidates[control] || candidates[0] || row
    target.focus({ preventScroll: true })
    cursor = index
  }

  function spacer(height) {
    const node = document.createElement(childTag)
    node.className = 'virtual-list-spacer'
    node.setAttribute('aria-hidden', 'true')
    node.setAttribute('role', 'presentation')
    node.style.height = `${height}px`
    node.style.flexShrink = '0'
    node.style.listStyle = 'none'
    return node
  }

  function makeRow(index) {
    const node = document.createElement(childTag)
    node.className = 'virtual-list-row'
    node.setAttribute('role', 'listitem')
    node.setAttribute('aria-posinset', String(index + 1))
    node.setAttribute('aria-setsize', String(items.length))
    node.tabIndex = -1
    if (virtual) {
      node.style.height = `${rowHeight}px`
      node.style.boxSizing = 'border-box'
      node.style.flexShrink = '0'
    }
    node.append(renderRow(items[index], index))
    const record = { key: keys[index], index, node }
    records.set(node, record)
    return record
  }

  function render({ force = false, focus = captureFocus(), offset = element.scrollTop } = {}) {
    if (destroyed || (items.length && !element.getClientRects().length))
      return
    force ||= invalidated
    const indices = []
    if (virtual) {
      const maximum = Math.max(0, items.length * rowHeight - element.clientHeight)
      const top = Math.max(0, Math.min(offset, maximum))
      const first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN)
      const last = Math.min(items.length, Math.ceil((top + element.clientHeight) / rowHeight) + OVERSCAN)
      for (let index = first; index < last; index++)
        indices.push(index)
      // Retain at most one focused row outside the window, not every intervening row.
      const pinned = focusedIndex(focus)
      if (pinned >= 0 && (pinned < first || pinned >= last)) {
        indices.push(pinned)
        indices.sort((a, b) => a - b)
      }
    }
    else {
      for (let index = 0; index < items.length; index++)
        indices.push(index)
    }
    if (!force && indices.length === drawn.length && indices.every((index, position) => index === drawn[position]))
      return

    const nextRows = new Map()
    const children = []
    let previous = 0
    for (const index of indices) {
      if (virtual && index > previous)
        children.push(spacer((index - previous) * rowHeight))
      const record = (!force && rows.get(keys[index])) || makeRow(index)
      nextRows.set(record.key, record)
      children.push(record.node)
      previous = index + 1
    }
    if (virtual && previous < items.length)
      children.push(spacer((items.length - previous) * rowHeight))
    rows = nextRows
    drawn = indices
    invalidated = false
    element.replaceChildren(...children)
    if (focus) {
      const index = focusedIndex(focus)
      if (index < 0) {
        if (!element.hasAttribute('tabindex'))
          element.tabIndex = -1
        element.focus({ preventScroll: true })
      }
      else {
        focusRow(index, focus.control)
      }
    }
  }

  function onFocus(event) {
    const record = rowRecord(event.target)
    if (record)
      cursor = record.index
  }

  function onKey(event) {
    if (destroyed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !items.length)
      return
    if (event.target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])'))
      return
    const record = rowRecord(document.activeElement)
    const current = record ? record.index : Math.min(cursor, items.length - 1)
    const page = Math.max(1, Math.floor(element.clientHeight / rowHeight))
    let index
    switch (event.key) {
      case 'ArrowUp':
        index = Math.max(0, current - 1)
        break
      case 'ArrowDown':
        index = Math.min(items.length - 1, current + 1)
        break
      case 'PageUp':
        index = Math.max(0, current - page)
        break
      case 'PageDown':
        index = Math.min(items.length - 1, current + page)
        break
      case 'Home':
        index = 0
        break
      case 'End':
        index = items.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    if (virtual) {
      const top = index * rowHeight
      const bottom = top + rowHeight
      const offset = top < element.scrollTop
        ? top
        : bottom > element.scrollTop + element.clientHeight ? bottom - element.clientHeight : element.scrollTop
      scroll.setSectionOffset(element, offset)
      render()
    }
    focusRow(index)
    if (virtual)
      render()
    else
      scroll.scrollToAnchor(rows.get(keys[index]).node, { smooth: false })
  }

  element.setAttribute('role', 'list')
  element.setAttribute('aria-label', label)
  element.addEventListener('keydown', onKey)
  element.addEventListener('focusin', onFocus)
  const unsubscribe = scroll.observeSection(element, () => render())
  const resize = new document.defaultView.ResizeObserver(() => render())
  resize.observe(element)

  return {
    // Capture before the app makes its content inert during an asynchronous operation.
    rememberFocus() {
      const focus = captureFocus()
      if (!focus)
        return null
      return () => {
        if (destroyed || !element.isConnected || !element.getClientRects().length)
          return false
        render({ focus })
        const index = focusedIndex(focus)
        if (index >= 0) {
          focusRow(index, focus.control)
        }
        else {
          element.tabIndex = -1
          element.focus({ preventScroll: true })
        }
        return true
      }
    },
    setItems(nextItems) {
      if (destroyed)
        return
      const focus = captureFocus()
      const offset = element.scrollTop
      const cursorKey = keys[cursor]
      invalidated = true
      items = nextItems
      keys = items.map((item, index) => keyOf(item, index))
      indexByKey = new Map(keys.map((key, index) => [key, index]))
      cursor = indexByKey.has(cursorKey) ? indexByKey.get(cursorKey) : Math.max(0, Math.min(cursor, items.length - 1))
      virtual = items.length > THRESHOLD
      element.classList.toggle('virtual-list', virtual || original.virtual)
      if (virtual) {
        element.setAttribute('data-scroll-section', '')
        element.tabIndex = 0
        element.style.setProperty('--virtual-row-height', `${rowHeight}px`)
      }
      else {
        restoreAttribute('data-scroll-section', original.section)
        restoreAttribute('tabindex', original.tabindex)
        if (original.height)
          element.style.setProperty('--virtual-row-height', original.height, original.heightPriority)
        else
          element.style.removeProperty('--virtual-row-height')
      }
      render({ force: true, focus, offset })
      if (element.getClientRects().length)
        scroll.setSectionOffset(element, offset)
    },
    destroy() {
      if (destroyed)
        return
      destroyed = true
      unsubscribe()
      resize.disconnect()
      element.removeEventListener('keydown', onKey)
      element.removeEventListener('focusin', onFocus)
      element.replaceChildren()
      element.classList.toggle('virtual-list', original.virtual)
      restoreAttribute('role', original.role)
      restoreAttribute('aria-label', original.label)
      restoreAttribute('tabindex', original.tabindex)
      restoreAttribute('data-scroll-section', original.section)
      if (original.height)
        element.style.setProperty('--virtual-row-height', original.height, original.heightPriority)
      else
        element.style.removeProperty('--virtual-row-height')
      items = []
      keys = []
      indexByKey.clear()
      rows.clear()
      records = new WeakMap()
      drawn = []
    },
  }
}
