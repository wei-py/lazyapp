/** Own the layout scroll root, temporary route positions and nested overlay locks. */
export function createScrollManager({ root, backToTop }) {
  const document = root.ownerDocument
  const window = document.defaultView
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const routes = new Map()
  const overlaySections = new Map()
  const observers = new Map()
  const dirtySections = new Set()
  const owners = new Set()
  const lockedStyles = new Map()
  const overflowProperties = ['overflow', 'overflow-x', 'overflow-y']
  const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '])
  let currentKey
  let hasRoute = false
  let routeReady = false
  let generation = 0
  let layoutRevision = 0
  let layoutFrame = 0
  let scrollFrame = 0
  let pendingLayout = null
  let lockSnapshot = null
  let destroyed = false

  function visible(element) {
    if (!element.isConnected || !element.getClientRects().length || element.closest('[hidden]'))
      return false
    const visibility = window.getComputedStyle(element).visibility
    return visibility !== 'hidden' && visibility !== 'collapse'
  }

  function ownerElement(owner) {
    return typeof owner === 'string' ? document.getElementById(owner) : owner?.nodeType === 1 ? owner : null
  }

  function belongsToOverlay(element) {
    if (element.closest('dialog'))
      return true
    for (const owner of owners) {
      const overlay = ownerElement(owner)
      if (overlay?.contains(element))
        return true
    }
    return false
  }

  function sections() {
    return document.querySelectorAll('[data-scroll-section][id]')
  }

  function position(element) {
    return { top: element.scrollTop, left: element.scrollLeft }
  }

  function capture() {
    if (lockSnapshot?.generation === generation)
      return lockSnapshot.positions
    const captured = new Map()
    for (const element of sections()) {
      if (visible(element) && !belongsToOverlay(element))
        captured.set(element.id, position(element))
    }
    return { root: position(root), sections: captured }
  }

  function rememberRoute() {
    // A superseded RAF has not displayed that route's intended position yet.
    if (!hasRoute || !routeReady)
      return
    const captured = capture()
    const remembered = new Map(routes.get(currentKey)?.sections)
    for (const [id, offset] of captured.sections)
      remembered.set(id, offset)
    routes.set(currentKey, { root: captured.root, sections: remembered })
  }

  function scroll(element, offset, smooth = false) {
    element.scrollTo({
      top: Math.max(0, Math.min(offset.top, element.scrollHeight - element.clientHeight)),
      left: offset.left,
      behavior: smooth && !reducedMotion.matches ? 'smooth' : 'instant',
    })
  }

  function applyPositions(snapshot) {
    for (const [id, offset] of snapshot.sections) {
      const element = document.getElementById(id)
      if (element?.matches('[data-scroll-section]') && visible(element) && !belongsToOverlay(element))
        scroll(element, offset)
    }
    scroll(root, snapshot.root)
    scheduleScroll()
  }

  function applyAnchor(target, smooth) {
    const element = typeof target === 'string' ? document.getElementById(target) : target
    if (!element || !visible(element))
      return
    let container = element === root ? root : element.parentElement
    while (container && container !== root) {
      if (container.matches('[data-scroll-section], dialog[open]')
        && /auto|scroll/.test(window.getComputedStyle(container).overflowY)) {
        break
      }
      container = container.parentElement
    }
    if (!container)
      return
    const margin = Number.parseFloat(window.getComputedStyle(element).scrollMarginTop) || 0
    const top = element === container ? 0 : container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - margin
    scroll(container, { top, left: container.scrollLeft }, smooth)
  }

  function scheduleLayout() {
    if (destroyed || layoutFrame || !pendingLayout || owners.size)
      return
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0
      if (destroyed || owners.size)
        return
      const task = pendingLayout
      pendingLayout = null
      if (!task || task.generation !== generation)
        return
      if (task.kind === 'anchor') {
        applyAnchor(task.target, task.smooth)
      }
      else if (task.snapshot) {
        applyPositions(task.snapshot)
      }
      else {
        // The sibling navigation keeps its position on ordinary document entry.
        for (const element of sections()) {
          if (root.contains(element) && visible(element) && !belongsToOverlay(element))
            scroll(element, { top: 0, left: 0 })
        }
        scroll(root, { top: 0, left: 0 })
        scheduleScroll()
      }
      routeReady = true
    })
  }

  function queueLayout(task) {
    pendingLayout = { ...task, generation }
    layoutRevision += 1
    scheduleLayout()
  }

  function updateBackToTop() {
    if (backToTop)
      backToTop.hidden = root.scrollTop <= 400
  }

  function scheduleScroll() {
    if (destroyed || scrollFrame)
      return
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0
      if (destroyed)
        return
      updateBackToTop()
      const pending = Array.from(dirtySections)
      dirtySections.clear()
      for (const element of pending) {
        const entry = observers.get(element)
        if (!entry)
          continue
        for (const subscription of Array.from(entry.subscriptions)) {
          if (!destroyed && observers.get(element) === entry && entry.subscriptions.has(subscription))
            subscription.callback(element.scrollTop)
        }
      }
    })
  }

  function blockBackground(event) {
    if (!owners.size || (event.type === 'keydown' && !scrollKeys.has(event.key)))
      return
    const path = event.composedPath()
    for (const owner of owners) {
      const overlay = ownerElement(owner)
      if (overlay && path.includes(overlay))
        return
    }
    if (path.some(element => element?.nodeType === 1 && element.matches('dialog[open]')))
      return
    event.preventDefault()
  }

  function saveOverflow(element) {
    if (!element || lockedStyles.has(element))
      return
    lockedStyles.set(element, overflowProperties.map(name => ({
      name,
      value: element.style.getPropertyValue(name),
      priority: element.style.getPropertyPriority(name),
    })))
    element.style.setProperty('overflow', 'hidden', 'important')
  }

  function restoreOverflow(element, properties) {
    for (const name of overflowProperties)
      element.style.removeProperty(name)
    for (const { name, value, priority } of properties) {
      if (value)
        element.style.setProperty(name, value, priority)
    }
  }

  function updateLockStyles() {
    // A later owner can promote a previously background section to an overlay.
    for (const [element, properties] of lockedStyles) {
      if (element !== root && element !== document.body && belongsToOverlay(element)) {
        restoreOverflow(element, properties)
        lockedStyles.delete(element)
      }
    }
    saveOverflow(document.body)
    saveOverflow(root)
    for (const element of sections()) {
      if (visible(element) && !belongsToOverlay(element))
        saveOverflow(element)
    }
  }

  function releaseLock() {
    for (const [element, properties] of lockedStyles)
      restoreOverflow(element, properties)
    lockedStyles.clear()
    const snapshot = lockSnapshot
    lockSnapshot = null
    if (snapshot) {
      // A route or anchor requested behind an overlay wins over the old view.
      if (snapshot.generation === generation && !pendingLayout)
        applyPositions(snapshot.positions)
      for (const [element, offset] of snapshot.documentPositions) {
        if (element !== root)
          scroll(element, offset)
      }
    }
    scheduleLayout()
    scheduleScroll()
  }

  function navigate(key, { restore = false } = {}) {
    if (destroyed || (hasRoute && key === currentKey))
      return
    rememberRoute()
    currentKey = key
    hasRoute = true
    routeReady = false
    generation += 1
    queueLayout({ kind: 'navigate', snapshot: restore ? routes.get(key) : null })
  }

  async function preserve(action) {
    const capturedGeneration = generation
    const capturedRevision = layoutRevision
    const snapshot = capture()
    try {
      return await action()
    }
    finally {
      if (!destroyed && capturedGeneration === generation && capturedRevision === layoutRevision && !pendingLayout)
        queueLayout({ kind: 'preserve', snapshot })
    }
  }

  function lock(owner) {
    if (destroyed || owners.has(owner))
      return
    const firstOwner = !owners.size
    owners.add(owner)
    if (firstOwner) {
      lockSnapshot = {
        generation,
        positions: capture(),
        documentPositions: new Map([document.documentElement, document.body].filter(Boolean).map(element => [element, position(element)])),
      }
    }
    const backgroundSections = new Map(lockSnapshot.positions.sections)
    for (const id of backgroundSections.keys()) {
      const element = document.getElementById(id)
      if (element && belongsToOverlay(element))
        backgroundSections.delete(id)
    }
    lockSnapshot.positions = { root: lockSnapshot.positions.root, sections: backgroundSections }
    updateLockStyles()
  }

  function unlock(owner) {
    if (destroyed || !owners.delete(owner))
      return
    if (owners.size)
      updateLockStyles()
    else
      releaseLock()
  }

  function scrollToAnchor(target, { smooth = false } = {}) {
    if (destroyed)
      return
    const element = typeof target === 'string' ? document.getElementById(target) : target
    if (owners.size && element && belongsToOverlay(element))
      applyAnchor(element, smooth)
    else
      queueLayout({ kind: 'anchor', target, smooth })
  }

  function setSectionOffset(element, top) {
    if (destroyed)
      return
    scroll(element, { top, left: element.scrollLeft })
    if (observers.has(element)) {
      dirtySections.add(element)
      scheduleScroll()
    }
  }

  function rememberSections(container) {
    if (destroyed)
      return
    const snapshot = new Map()
    for (const element of container.querySelectorAll('[data-scroll-section][id]')) {
      if (visible(element))
        snapshot.set(element.id, position(element))
    }
    overlaySections.set(container, snapshot)
  }

  function restoreSections(container) {
    if (destroyed)
      return
    for (const [id, offset] of overlaySections.get(container) || []) {
      const element = document.getElementById(id)
      if (element && container.contains(element) && visible(element)) {
        scroll(element, offset)
        if (observers.has(element))
          dirtySections.add(element)
      }
    }
    scheduleScroll()
  }

  function observeSection(element, callback) {
    if (destroyed)
      return () => {}
    let entry = observers.get(element)
    if (!entry) {
      const listener = () => {
        dirtySections.add(element)
        scheduleScroll()
      }
      entry = { listener, subscriptions: new Set() }
      observers.set(element, entry)
      element.addEventListener('scroll', listener, { passive: true })
    }
    const subscription = { callback }
    entry.subscriptions.add(subscription)
    dirtySections.add(element)
    scheduleScroll()
    return () => {
      entry.subscriptions.delete(subscription)
      if (!entry.subscriptions.size && observers.get(element) === entry) {
        element.removeEventListener('scroll', entry.listener)
        observers.delete(element)
        dirtySections.delete(element)
      }
    }
  }

  function onBackToTop(event) {
    event.preventDefault()
    scrollToAnchor(root, { smooth: true })
  }

  function destroy() {
    if (destroyed)
      return
    destroyed = true
    if (layoutFrame)
      window.cancelAnimationFrame(layoutFrame)
    if (scrollFrame)
      window.cancelAnimationFrame(scrollFrame)
    layoutFrame = 0
    scrollFrame = 0
    pendingLayout = null
    owners.clear()
    releaseLock()
    root.removeEventListener('scroll', scheduleScroll)
    backToTop?.removeEventListener('click', onBackToTop)
    document.removeEventListener('wheel', blockBackground, true)
    document.removeEventListener('touchmove', blockBackground, true)
    document.removeEventListener('keydown', blockBackground, true)
    for (const [element, entry] of observers)
      element.removeEventListener('scroll', entry.listener)
    observers.clear()
    dirtySections.clear()
    routes.clear()
    overlaySections.clear()
  }

  root.addEventListener('scroll', scheduleScroll, { passive: true })
  backToTop?.addEventListener('click', onBackToTop)
  document.addEventListener('wheel', blockBackground, { capture: true, passive: false })
  document.addEventListener('touchmove', blockBackground, { capture: true, passive: false })
  document.addEventListener('keydown', blockBackground, true)
  updateBackToTop()

  return { navigate, preserve, lock, unlock, scrollToAnchor, setSectionOffset, rememberSections, restoreSections, observeSection, destroy }
}
