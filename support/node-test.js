import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  test,
} from 'node:test'
import { expect } from 'expect'

expect.extend({
  toBeArray(received) {
    const pass = Array.isArray(received)
    return {
      message: () => `expected ${this.utils.printReceived(received)} ${pass ? 'not ' : ''}to be an array`,
      pass,
    }
  },
})

export { after, afterEach, before, beforeEach, describe, expect, it, test }
