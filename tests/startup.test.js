import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { prepareStartup, promptForInitialization } from '../src/app/startup.js'
import { loadPreferences } from '../src/storage/preferences.js'
import { initializeWorkspace, openWorkspace, workspaceExists } from '../src/storage/workspace.js'

let project
let messages
let errors
let signals
let options
beforeEach(async () => {
  project = await fs.mkdtemp(join(tmpdir(), 'lazyapp-startup-'))
  messages = []
  errors = []
  signals = new EventEmitter()
  options = {
    output: { write: message => messages.push(message) },
    errorOutput: { write: message => errors.push(message) },
    signals,
    preferences: { load: () => loadPreferences({ directory: join(project, 'preferences') }) },
  }
})
afterEach(async () => {
  await fs.rm(project, { recursive: true, force: true })
})

function lineInput() {
  const input = new PassThrough()
  input.setRawMode = () => {
    throw new Error('Startup must remain cooked')
  }
  return input
}

describe('plain-terminal startup', () => {
  for (const answer of ['', 'n', 'no', 'NO', 'anything', null]) {
    test(`declines ${JSON.stringify(answer)} without writes`, async () => {
      let asked = 0
      const result = await prepareStartup(project, {
        ...options,
        prompt: async (message) => {
          asked++
          expect(message).toBe('No lazyapp workspace found. Create one? (y/N): ')
          return answer
        },
      })
      expect(result).toBe(0)
      expect(asked).toBe(1)
      expect(await fs.readdir(project)).toEqual([])
      expect(errors).toEqual([])
      expect(signals.listenerCount('SIGINT')).toBe(0)
    })
  }

  for (const answer of ['y', 'Y', 'yes', 'YeS']) {
    test(`accepts ${answer}, publishes examples and releases the lock before TUI entry`, async () => {
      let asked = 0
      expect(
        await prepareStartup(project, {
          ...options,
          prompt: async () => {
            asked++
            return answer
          },
        }),
      ).toBeNull()
      expect(asked).toBe(1)
      expect(await fs.readdir(project)).toEqual(['.lazyapp'])
      const session = await openWorkspace(project)
      try {
        const app = (await session.read('app.json')).data
        expect(app.name).toBe(basename(project))
        expect(app.platforms).toEqual([])
        expect(app.environments).toEqual([])
        const files = await session.list()
        expect(files).toContain('platforms/ios/development/config.json.example')
        expect(files).toContain('platforms/android/production/config.json.example')
        expect(files.filter(path => !path.endsWith('.example'))).toEqual(['app.json'])
      }
      finally {
        await session.close()
      }
    })
  }

  test('uses saved language without changing preferences', async () => {
    const directory = join(project, 'preferences')
    await fs.mkdir(directory)
    const text = '{"schemaVersion":1,"language":"zh","retained":true}\n'
    await fs.writeFile(join(directory, 'settings.json'), text)
    let asked
    expect(
      await prepareStartup(project, {
        ...options,
        prompt: async (message) => {
          asked = message
          return ''
        },
      }),
    ).toBe(0)
    expect(asked).toContain('(y/N): ')
    expect(asked).not.toContain('No lazyapp workspace found.')
    expect(await fs.readFile(join(directory, 'settings.json'), 'utf8')).toBe(text)
    expect(await fs.readdir(directory)).toEqual(['settings.json'])
  })

  test('reports invalid preferences and creation errors independently without leaking exception details', async () => {
    const directory = join(project, 'preferences')
    await fs.mkdir(directory)
    await fs.writeFile(join(directory, 'settings.json'), 'invalid')
    expect(
      await prepareStartup(project, {
        ...options,
        prompt: async () => 'yes',
        storage: {
          exists: workspaceExists,
          initialize: async () => {
            throw Object.assign(new Error('secret-value'), { code: 'EACCES' })
          },
        },
      }),
    ).toBe(1)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('preference is invalid')
    expect(errors[1]).toContain('Permission denied')
    expect(errors.join('')).not.toContain('secret-value')
    expect(await fs.readFile(join(directory, 'settings.json'), 'utf8')).toBe('invalid')
    expect(await workspaceExists(project)).toBe(false)
  })

  for (const kind of ['file', 'directory', 'symlink', 'corrupt']) {
    test(`reserves an existing ${kind} without prompting or adopting it`, async () => {
      const root = join(project, '.lazyapp')
      if (kind === 'file') {
        await fs.writeFile(root, 'untouched')
      }
      else if (kind === 'symlink') {
        await fs.symlink(join(project, 'absent'), root)
      }
      else {
        await fs.mkdir(root)
        if (kind === 'corrupt')
          await fs.writeFile(join(root, 'app.json'), 'invalid')
      }
      expect(await workspaceExists(project)).toBe(true)
      expect(
        await prepareStartup(project, {
          ...options,
          preferences: {
            load: async () => {
              throw new Error('Existing startup must leave preference handling to the application')
            },
          },
          prompt: async () => {
            throw new Error('Existing target must not prompt')
          },
        }),
      ).toBeNull()
      expect(errors).toEqual([])
      await expect(openWorkspace(project)).rejects.toThrow()
      expect(await fs.readdir(project)).toEqual(['.lazyapp'])
      if (kind === 'file')
        expect(await fs.readFile(root, 'utf8')).toBe('untouched')
      else if (kind === 'directory')
        expect(await fs.readdir(root)).toEqual([])
      else if (kind === 'corrupt')
        expect(await fs.readFile(join(root, 'app.json'), 'utf8')).toBe('invalid')
      else expect(await fs.readlink(root)).toBe(join(project, 'absent'))
    })
  }

  test('opens an existing valid workspace without confirmation or preference writes', async () => {
    expect(await prepareStartup(project, { ...options, prompt: async () => 'yes' })).toBeNull()
    expect(
      await prepareStartup(project, {
        ...options,
        prompt: async () => {
          throw new Error('Must not prompt twice')
        },
      }),
    ).toBeNull()
    expect(errors).toEqual([])
    expect(await fs.readdir(project)).toEqual(['.lazyapp'])
  })

  test('does not adopt a parent workspace', async () => {
    await fs.mkdir(join(project, '.lazyapp'))
    const child = join(project, 'child')
    await fs.mkdir(child)
    expect(await workspaceExists(child)).toBe(false)
    let asked = 0
    expect(
      await prepareStartup(child, {
        ...options,
        prompt: async () => {
          asked++
          return 'n'
        },
      }),
    ).toBe(0)
    expect(asked).toBe(1)
    expect(await fs.readdir(child)).toEqual([])
  })

  test('never overwrites a target appearing after confirmation', async () => {
    expect(
      await prepareStartup(project, {
        ...options,
        prompt: async () => {
          await fs.mkdir(join(project, '.lazyapp'))
          return 'yes'
        },
      }),
    ).toBe(1)
    expect(await fs.readdir(join(project, '.lazyapp'))).toEqual([])
    expect(errors.join('')).toContain('already exists')
  })

  test('EOF, including an unterminated yes, declines and detaches cooked input', async () => {
    for (const unfinished of ['', 'yes']) {
      const input = lineInput()
      const answer = promptForInitialization('prompt: ', { input, output: options.output })
      input.end(unfinished)
      expect(await answer).toBeNull()
      expect(input.listenerCount('data')).toBe(0)
    }
    expect(messages).toEqual(['prompt: ', '\n', 'prompt: ', '\n'])
  })

  test('input closing before a complete line declines without creating files', async () => {
    const input = lineInput()
    const pending = prepareStartup(project, {
      ...options,
      input,
      prompt: (message, streams) => {
        const answer = promptForInitialization(message, streams)
        input.destroy()
        return answer
      },
    })
    expect(await pending).toBe(0)
    expect(messages.at(-1)).toBe('\n')
    expect(await fs.readdir(project)).toEqual([])
  })

  test('reads only the first cooked line', async () => {
    const input = lineInput()
    const answer = promptForInitialization('prompt: ', { input, output: options.output })
    input.write('Ye')
    input.write('S\nno\n')
    expect(await answer).toBe('YeS')
    expect(messages).toEqual(['prompt: '])
    expect(input.listenerCount('data')).toBe(0)
  })

  test('Ctrl+C cancels the pending prompt with newline and no writes', async () => {
    const input = lineInput()
    const asked = Promise.withResolvers()
    const pending = prepareStartup(project, {
      ...options,
      input,
      prompt: (message, streams) => {
        const result = promptForInitialization(message, streams)
        asked.resolve()
        return result
      },
    })
    await asked.promise
    signals.emit('SIGINT')
    expect(await pending).toBe(130)
    expect(messages.at(-1)).toBe('\n')
    expect(input.listenerCount('data')).toBe(0)
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(await fs.readdir(project)).toEqual([])
  })

  test('signals wait for initialization and lock release rather than racing writes', async () => {
    const entered = Promise.withResolvers()
    const resume = Promise.withResolvers()
    let closed = false
    let settled = false
    const pending = prepareStartup(project, {
      ...options,
      prompt: async () => 'yes',
      storage: {
        exists: workspaceExists,
        initialize: async (...args) => {
          entered.resolve()
          await resume.promise
          const session = await initializeWorkspace(...args)
          return {
            close: async () => {
              await session.close()
              closed = true
            },
          }
        },
      },
    })
    pending.then(() => {
      settled = true
    })
    await entered.promise
    signals.emit('SIGTERM')
    signals.emit('SIGINT')
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(closed).toBe(false)
    resume.resolve()
    expect(await pending).toBe(143)
    expect(closed).toBe(true)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
    const session = await openWorkspace(project)
    await session.close()
    expect((await fs.readdir(join(project, '.lazyapp'))).includes('.lazyapp.lock')).toBe(false)
  })
})
