export function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

/** Scroll offset that keeps `cursor` inside the `visible` rows of `length`. */
export function followOffset(cursor, visible, length, offset) {
  if (visible <= 0)
    return offset
  let next = offset
  if (cursor < next)
    next = cursor
  if (cursor >= next + visible)
    next = cursor - visible + 1
  return clamp(next, 0, Math.max(0, length - visible))
}
