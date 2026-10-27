/* global Bun */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, cp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { releaseTarget } from '../src/config/release.js'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const target = releaseTarget()
if (!process.versions.bun || Bun.semver.satisfies(process.versions.bun, pkg.engines.bun) === false)
  throw new Error(`Bun ${pkg.engines.bun} is required to build releases.`)
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pkg.version}`)
  throw new Error(`Release tag must match package.json: v${pkg.version}`)

const dist = join(root, 'dist')
const staging = join(dist, `lazyapp-${target.slug}`)
await rm(staging, { recursive: true, force: true })
await mkdir(join(staging, 'bin'), { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Command failed (${result.status}): ${command}`)
}

const libc = process.platform === 'linux' && process.env.OPENTUI_LIBC === 'musl' ? 'musl' : 'glibc'
const output = join(staging, 'bin', target.binaryName)
const bunTarget = `bun-${target.slug}${process.platform === 'linux' && libc === 'musl' ? '-musl' : ''}`
// Bun embeds OpenTUI's native library and runtime assets and signs macOS output.
const result = await Bun.build({
  entrypoints: [join(root, 'src/main.js')],
  target: 'bun',
  compile: { target: bunTarget, outfile: output },
  define: {
    'LAZYAPP_COMPILED': 'true',
    'LAZYAPP_VERSION': JSON.stringify(pkg.version),
    'process.env.OPENTUI_LIBC': JSON.stringify(libc),
  },
})
if (!result.success)
  throw new AggregateError(result.logs, 'Bun executable compilation failed.')
if (process.platform === 'darwin')
  run('codesign', ['--verify', '--strict', output])
if (process.platform !== 'win32')
  await chmod(output, 0o755)

// The Web interface is local and ships beside the executable without a CDN.
await cp(join(root, 'src/web/public'), join(staging, 'bin/web'), { recursive: true })

// Retain notices from the installed production dependency graph, including native code.
const visited = new Set()
async function packageDirectory(name, from = root) {
  const require = createRequire(join(from, 'package.json'))
  // Locate installed metadata without resolving an entry point: dependencies may
  // export only ESM or Bun entries, while their notices still belong in releases.
  for (const directory of require.resolve.paths(name) ?? []) {
    try {
      return await realpath(join(directory, name))
    }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
        throw error
    }
  }
  throw new Error(`Cannot locate package metadata for ${name}.`)
}
async function copyNotices(name, from) {
  const directory = await packageDirectory(name, from)
  if (visited.has(directory))
    return
  visited.add(directory)
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  const destination = join(staging, 'licenses', name, metadata.version)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:licen[cs]e|copying|notice|patents|authors)(?:[.-]|$)/i.test(entry.name)) {
      await mkdir(destination, { recursive: true })
      await copyFile(join(directory, entry.name), join(destination, entry.name))
    }
  }
  for (const dependency of Object.keys({ ...metadata.dependencies, ...metadata.peerDependencies })) {
    if (metadata.peerDependenciesMeta?.[dependency]?.optional) {
      try {
        await packageDirectory(dependency, directory)
      }
      catch {
        continue
      }
    }
    await copyNotices(dependency, directory)
  }
}
for (const dependency of Object.keys(pkg.dependencies)) await copyNotices(dependency, root)
// Native packages are optional dependencies of OpenTUI; resolve from its directory.
const coreDirectory = await packageDirectory('@opentui/core', root)
const nativePackage = `${target.nativePackage}${process.platform === 'linux' && libc === 'musl' ? '-musl' : ''}`
await copyNotices(nativePackage, coreDirectory)

// bsdtar and GNU tar infer the archive format from the suffix with -a.
const archive = join(dist, target.archiveName)
run('tar', ['-a', '-cf', archive, '-C', staging, 'bin', 'licenses'])
const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
await writeFile(join(dist, 'SHA256SUMS'), `${checksum}  ${target.archiveName}\n`)
process.stdout.write(`Release v${pkg.version}: ${archive}\n`)
