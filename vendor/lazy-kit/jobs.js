/**
 * Background job runner shared by the lazy TUIs. Jobs stream output line by
 * line into the status bar; `serialized` jobs (package DB locks, config
 * writes) run one at a time on a process-wide chain. Abort SIGTERMs the whole
 * process group when `setsid` exists so children never outlive their row.
 */

export const JOB_GLYPH = {
  queued: '·',
  running: '▶',
  done: '✓',
  failed: '✗',
  canceled: '⊘',
}

const ANSI_RE = /\x1B\[[0-9;]*[a-z]/gi
const LOG_LIMIT = 200
const SETSID = typeof Bun !== 'undefined' ? Bun.which('setsid') : null

// One process-wide chain: every runner shares the serialized queue.
let chain = Promise.resolve()

async function pump(stream, onLine) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done)
      break
    carry += decoder.decode(value, { stream: true }).replace(ANSI_RE, '')
    const parts = carry.split(/\r\n|\r|\n/)
    carry = parts.pop() ?? ''
    for (const part of parts) onLine(part)
  }
  carry += decoder.decode()
  if (carry)
    onLine(carry)
}

export function createJobRunner({ onPatch = () => {} } = {}) {
  const jobs = []
  const logs = []
  const killers = new Map()
  let seq = 0

  function log(line) {
    logs.push(line)
    if (logs.length > LOG_LIMIT)
      logs.shift()
  }

  function spawn(job, op) {
    const argv = SETSID ? [SETSID, ...op.cmd] : op.cmd
    const proc = Bun.spawn({
      cmd: argv,
      stdout: 'pipe',
      stderr: 'pipe',
      env: op.env ? { ...Bun.env, ...op.env } : undefined,
    })
    killers.set(job.id, () => {
      try {
        if (SETSID)
          process.kill(-proc.pid, 'SIGTERM')
        else proc.kill('SIGTERM')
      }
      catch {
        // already exited
      }
    })
    const onLine = (line) => {
      job.lastLine = line
      log(line)
      onPatch(job)
    }
    return (async () => {
      await Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine)])
      return await proc.exited
    })()
  }

  async function runFunction(job, op) {
    const api = {
      setLast(line) {
        job.lastLine = String(line)
        log(job.lastLine)
        onPatch(job)
      },
      log(line) {
        log(String(line))
      },
    }
    await op.run(api)
    return 0
  }

  async function execute(job, op) {
    if (job.state === 'canceled')
      return job
    job.state = 'running'
    job.startedAt = Date.now()
    onPatch(job)
    try {
      const code = op.cmd ? await spawn(job, op) : await runFunction(job, op)
      if (job.state === 'canceled')
        return job
      job.state = code === 0 ? 'done' : 'failed'
      job.exitCode = code
      job.endedAt = Date.now()
      log(`exit ${code}`)
    }
    catch (error) {
      if (job.state === 'canceled')
        return job
      const message = error instanceof Error ? error.message : String(error)
      job.state = 'failed'
      job.exitCode = null
      job.endedAt = Date.now()
      job.lastLine = message
      log(`error: ${message}`)
    }
    finally {
      killers.delete(job.id)
      onPatch(job)
    }
    return job
  }

  /**
   * Queue one job: `op.cmd` (argv array) runs as a child process, `op.run`
   * receives `{ setLast, log }` — exactly one of the two is required.
   * `serialized: true` waits for earlier serialized jobs (`queued` state).
   * Resolves with the settled job and never rejects, so callers can chain
   * refreshes without blocking the key handler.
   */
  function submit(op) {
    const hasCmd = op != null && op.cmd != null
    const hasRun = op != null && op.run != null
    if (hasCmd === hasRun)
      throw new TypeError('job op requires exactly one of cmd or run')
    if (hasCmd && !Array.isArray(op.cmd))
      throw new TypeError('job op cmd must be an argv array')
    if (hasRun && typeof op.run !== 'function')
      throw new TypeError('job op run must be a function')
    seq += 1
    const job = {
      id: seq,
      kind: op.kind ?? 'task',
      label: op.label ?? '',
      state: 'queued',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastLine: '',
    }
    jobs.push(job)
    log(`$ ${hasCmd ? op.cmd.join(' ') : job.label}`)
    onPatch(job)
    if (op.serialized) {
      job.lastLine = 'waiting for other jobs'
      const settled = chain.then(() => execute(job, op))
      chain = settled.then(
        () => {},
        () => {},
      )
      return settled
    }
    return execute(job, op)
  }

  /** Settle one queued/running job as canceled; settled jobs are a no-op. */
  function abort(id) {
    const job = jobs.find(candidate => candidate.id === id)
    if (!job || (job.state !== 'queued' && job.state !== 'running'))
      return false
    job.state = 'canceled'
    job.endedAt = Date.now()
    const kill = killers.get(id)
    killers.delete(id)
    if (kill)
      kill()
    log('canceled')
    onPatch(job)
    return true
  }

  function abortAll() {
    for (const job of [...jobs]) abort(job.id)
  }

  return {
    submit,
    abort,
    abortAll,
    list: () => jobs,
    log: () => [...logs],
  }
}
