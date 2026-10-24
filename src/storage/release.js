import fs from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'

async function statOrNull(target) {
  try {
    return await fs.lstat(target)
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return null
    throw error
  }
}

async function validateRelease(directory, binaryName) {
  if (!(await statOrNull(join(directory, binaryName)))?.isFile())
    throw new Error('Binary not found in release archive')
  if (!(await statOrNull(join(directory, 'web')))?.isDirectory())
    throw new Error('Web directory not found in release archive')
  for (const name of ['index.html', 'app.js', 'style.css']) {
    if (!(await statOrNull(join(directory, 'web', name)))?.isFile())
      throw new Error(`Web file ${name} not found in release archive`)
  }
}

/** Install a release's bin directory and adjacent Web files, restoring both on commit failure. */
export async function installRelease(directory, executablePath) {
  const binaryName = basename(executablePath)
  await validateRelease(directory, binaryName)
  const installation = dirname(executablePath)
  const staging = await fs.mkdtemp(join(installation, '.lazyapp-update-'))
  const stagedBinary = join(staging, binaryName)
  const stagedWeb = join(staging, 'web')
  const webPath = join(installation, 'web')
  // Windows permits renaming the running executable, but cannot delete it until exit.
  const previousBinary = process.platform === 'win32' ? `${executablePath}.old` : join(staging, 'previous-binary')
  const previousWeb = join(staging, 'previous-web')
  const rollback = []
  let preserveRecovery = false
  try {
    // Copy first: downloads may be on another filesystem, while every commit rename is local.
    await fs.copyFile(join(directory, binaryName), stagedBinary)
    await fs.cp(join(directory, 'web'), stagedWeb, { recursive: true })
    await fs.chmod(stagedBinary, 0o755)
    await validateRelease(staging, binaryName)

    if (process.platform === 'win32')
      await fs.rm(previousBinary, { force: true })
    await fs.rename(executablePath, previousBinary)
    rollback.push(() => fs.rename(previousBinary, executablePath))
    if (await statOrNull(webPath)) {
      await fs.rename(webPath, previousWeb)
      rollback.push(() => fs.rename(previousWeb, webPath))
    }
    await fs.rename(stagedWeb, webPath)
    rollback.push(() => fs.rename(webPath, stagedWeb))
    await fs.rename(stagedBinary, executablePath)
  }
  catch (error) {
    const errors = [error]
    for (const restore of rollback.reverse()) {
      try {
        await restore()
      }
      catch (restoreError) {
        errors.push(restoreError)
      }
    }
    if (errors.length > 1) {
      preserveRecovery = true
      throw new AggregateError(
        errors,
        `${error.message}; rollback failed. Recovery files retained at ${staging} and ${previousBinary}`,
      )
    }
    throw error
  }
  finally {
    // Cleanup is not part of the commit; never report a completed installation as failed.
    if (!preserveRecovery) {
      try {
        await fs.rm(staging, { recursive: true, force: true })
      }
      catch (error) {
        process.emitWarning(`Could not remove release staging directory ${staging}: ${error.message}`, {
          code: 'LAZYAPP_UPDATE_CLEANUP',
        })
      }
    }
  }
}
