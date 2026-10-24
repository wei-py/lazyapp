import process from 'node:process'
import { expect, test } from '../support/node-test.js'
import { createJobRunner } from '../vendor/lazy-kit/jobs.js'

test('process jobs drain output and report the actual failing exit status', async () => {
  const runner = createJobRunner()
  const job = await runner.submit({
    cmd: [process.execPath, '-e', 'process.stdout.write("first\\nlast"); process.stderr.write("problem\\n"); process.exitCode = 7'],
  })
  expect(job).toMatchObject({ state: 'failed', exitCode: 7 })
  expect(runner.log()).toContain('first')
  expect(runner.log()).toContain('last')
  expect(runner.log()).toContain('problem')
})

test('a missing executable settles as failure without an unhandled spawn rejection', async () => {
  const runner = createJobRunner()
  const job = await runner.submit({ cmd: ['/nonexistent/lazyapp-test-helper'] })
  expect(job).toMatchObject({ state: 'failed', exitCode: null })
})

test('canceling a running process preserves canceled state when its pipes close', async () => {
  const runner = createJobRunner({
    onPatch(job) {
      if (job.lastLine === 'ready')
        runner.abort(job.id)
    },
  })
  const job = await runner.submit({
    cmd: [process.execPath, '-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'],
  })
  expect(job.state).toBe('canceled')
  expect(runner.abort(job.id)).toBe(false)
})
