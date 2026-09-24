import process from 'node:process'

/** Copy text through the platform clipboard; rejects when the helper exits non-zero. */
export async function copy(text) {
  const cmd
    = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'linux' ? 'wl-copy' : 'clip'
  const proc = Bun.spawn([cmd], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: process.env })
  proc.stdin.write(text)
  proc.stdin.end()
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0)
    throw new Error(stderr.trim() || `clipboard exited with code ${exitCode}`)
}
