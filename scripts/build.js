import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, cp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { getNodeAssets } from '@opentui/core/node-assets'
import { build } from 'esbuild'
import { releaseTarget } from '../src/config/release.js'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const target = releaseTarget()
const minimumNodeVersion = pkg.engines.node.slice(2).split('.').map(Number)
const nodeVersion = process.versions.node.split('.').map(Number)
const nodeVersionDifference = nodeVersion
  .map((part, index) => part - minimumNodeVersion[index])
  .find(difference => difference !== 0) ?? 0
if (nodeVersionDifference < 0)
  throw new Error(`Node.js ${pkg.engines.node} is required to build releases.`)
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pkg.version}`)
  throw new Error(`Release tag must match package.json: v${pkg.version}`)

const dist = join(root, 'dist')
const buildDirectory = join(dist, '.sea')
const staging = join(dist, `lazyapp-${target.slug}`)
await rm(buildDirectory, { recursive: true, force: true })
await rm(staging, { recursive: true, force: true })
await mkdir(buildDirectory, { recursive: true })
await mkdir(join(staging, 'bin'), { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Command failed (${result.status}): ${command}`)
}

const libc = process.platform === 'linux' && process.env.OPENTUI_LIBC === 'musl' ? 'musl' : 'glibc'
const assets = getNodeAssets({
  platform: process.platform,
  arch: process.arch,
  ...(process.platform === 'linux' ? { libc } : {}),
})
const bundle = join(buildDirectory, 'bundle.mjs')
await build({
  entryPoints: [join(root, 'src/main.js')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node26',
  define: {
    LAZYAPP_COMPILED: 'true',
    LAZYAPP_VERSION: JSON.stringify(pkg.version),
  },
  banner: {
    js: `import { mkdirSync as seaMkdirSync, mkdtempSync as seaMkdtempSync, readdirSync as seaReaddirSync, rmSync as seaRmSync, writeFileSync as seaWriteFileSync } from 'node:fs';
import { tmpdir as seaTmpdir } from 'node:os';
import { dirname as seaDirname, join as seaJoin } from 'node:path';
import { getRawAsset as seaGetRawAsset, isSea as seaIsSea } from 'node:sea';
if (!seaIsSea()) throw new Error('Expected a Node SEA executable');
// Windows keeps loaded DLLs locked until exit. Reclaim only directories whose
// owning process is gone; never remove another active invocation's assets.
if (process.platform === 'win32') {
  for (const seaEntry of seaReaddirSync(seaTmpdir(), { withFileTypes: true })) {
    const seaOwner = /^lazyapp-opentui-(\\d+)-/.exec(seaEntry.name);
    if (!seaEntry.isDirectory() || !seaOwner) continue;
    try {
      process.kill(Number(seaOwner[1]), 0);
    } catch (seaError) {
      if (seaError.code === 'ESRCH')
        seaRmSync(seaJoin(seaTmpdir(), seaEntry.name), { recursive: true, force: true });
      else if (seaError.code !== 'EPERM')
        throw seaError;
    }
  }
}
const seaAssetRoot = seaMkdtempSync(seaJoin(seaTmpdir(), 'lazyapp-opentui-' + process.pid + '-'));
if (process.platform !== 'win32')
  process.once('exit', () => seaRmSync(seaAssetRoot, { recursive: true, force: true }));
try {
  for (const seaKey of ${JSON.stringify(assets.map(({ key }) => key))}) {
    const seaTarget = seaJoin(seaAssetRoot, seaKey);
    seaMkdirSync(seaDirname(seaTarget), { recursive: true, mode: 0o700 });
    seaWriteFileSync(seaTarget, new Uint8Array(seaGetRawAsset(seaKey)), { mode: 0o600 });
  }
} catch (seaError) {
  seaRmSync(seaAssetRoot, { recursive: true, force: true });
  throw seaError;
}
process.env.OTUI_ASSET_ROOT = seaAssetRoot;
${process.platform === 'linux' ? `process.env.OPENTUI_LIBC = ${JSON.stringify(libc)};` : ''}`,
  },
})

const output = join(staging, 'bin', target.binaryName)
const configPath = join(buildDirectory, 'sea-config.json')
await writeFile(configPath, `${JSON.stringify({
  main: bundle,
  mainFormat: 'module',
  executable: process.execPath,
  output,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgv: ['--experimental-ffi', '--no-warnings'],
  execArgvExtension: 'none',
  assets: Object.fromEntries(assets.map(({ key, source }) => [key, source])),
}, null, 2)}\n`)
run(process.execPath, ['--build-sea', configPath])
if (process.platform === 'darwin')
  run('codesign', ['--sign', '-', '--force', output])
if (process.platform !== 'win32')
  await chmod(output, 0o755)

// The Web interface is local and ships beside the SEA without a CDN.
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
await copyNotices(target.nativePackage, root)

// bsdtar and GNU tar infer the archive format from the suffix with -a.
const archive = join(dist, target.archiveName)
run('tar', ['-a', '-cf', archive, '-C', staging, 'bin', 'licenses'])
const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
await writeFile(join(dist, 'SHA256SUMS'), `${checksum}  ${target.archiveName}\n`)
await rm(buildDirectory, { recursive: true, force: true })
process.stdout.write(`Release v${pkg.version}: ${archive}\n`)
