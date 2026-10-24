import { spawn } from 'node:child_process'
import process from 'node:process'

/** Copy text through the platform clipboard; rejects when the helper exits non-zero. */
export async function copy(text) {
  const cmd
    = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'linux' ? 'wl-copy' : 'clip'
  const proc = spawn(cmd, [], {
    stdio: ['pipe', 'ignore', 'pipe'],
    env: { ...process.env },
  })
  const exited = new Promise((resolve, reject) => {
    proc.once('error', reject)
    proc.stdin.once('error', reject)
    proc.once('close', (code) => {
      if (code === 0)
        resolve()
      else
        reject(new Error('Clipboard helper failed.'))
    })
  })
  proc.stderr.resume()
  proc.stdin.end(text)
  await exited
}
