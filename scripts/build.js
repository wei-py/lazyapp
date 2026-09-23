import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import * as Bun from 'bun'
import { releaseTarget } from '../src/config/release.js'

const root = join(import.meta.dir, '..')
const pkg = await Bun.file(join(root, 'package.json')).json()
const target = releaseTarget()
if (`bun@${Bun.version}` !== pkg.packageManager)
  throw new Error(`Build with ${pkg.packageManager}; found bun@${Bun.version}.`)
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pkg.version}`)
  throw new Error(`Release tag must match package.json: v${pkg.version}`)

const dist = join(root, 'dist')
const staging = join(dist, `lazyapp-${target.slug}`)
await rm(staging, { recursive: true, force: true })
await mkdir(join(staging, 'bin'), { recursive: true })

async function run(command) {
  const child = Bun.spawn(command, {
    cwd: root,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await child.exited) !== 0)
    throw new Error(`Command failed: ${command[0]}`)
}

// Bun embeds OpenTUI's native file imports alongside the runtime and application.
await run([
  process.execPath,
  'build',
  '--compile',
  `--target=${target.bunTarget}`,
  '--define',
  `LAZYAPP_VERSION:"${pkg.version}"`,
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  './src/main.js',
  '--outfile',
  join(staging, 'bin', target.binaryName),
])

// Retain notices from the installed production dependency graph, including native code.
const visited = new Set()
async function copyNotices(name) {
  if (visited.has(name))
    return
  visited.add(name)
  const directory = join(root, 'node_modules', name)
  const metadata = await Bun.file(join(directory, 'package.json')).json()
  const destination = join(staging, 'licenses', name)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.isFile()
      && /^(?:licen[cs]e|copying|notice|patents|authors)(?:[.-]|$)/i.test(entry.name)
    ) {
      await mkdir(destination, { recursive: true })
      await copyFile(join(directory, entry.name), join(destination, entry.name))
    }
  }
  for (const dependency of Object.keys({
    ...metadata.dependencies,
    ...metadata.peerDependencies,
  })) {
    if (
      metadata.peerDependenciesMeta?.[dependency]?.optional
      && !(await Bun.file(join(root, 'node_modules', dependency, 'package.json')).exists())
    ) {
      continue
    }
    await copyNotices(dependency)
  }
}
for (const dependency of Object.keys(pkg.dependencies)) await copyNotices(dependency)
await copyNotices(target.nativePackage)

// bsdtar and GNU tar both infer the format from the suffix with -a (.tar.gz or .zip).
const archive = join(dist, target.archiveName)
await run(['tar', '-a', '-cf', archive, '-C', staging, 'bin', 'licenses'])
const checksum = createHash('sha256')
  .update(await Bun.file(archive).bytes())
  .digest('hex')
await Bun.write(join(dist, 'SHA256SUMS'), `${checksum}  ${target.archiveName}\n`)
process.stdout.write(`Release v${pkg.version}: ${archive}\n`)
