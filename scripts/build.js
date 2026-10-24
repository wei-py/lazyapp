import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, cp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { getNodeAssets } from '@opentui/core/node-assets'
import { build } from 'esbuild'
import { releaseTarget } from '../src/config/release.js'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const target = releaseTarget()
if (process.versions.node.split('.').map(Number)[0] < 26)
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
    js: `import { mkdirSync as seaMkdirSync, mkdtempSync as seaMkdtempSync, rmSync as seaRmSync, writeFileSync as seaWriteFileSync } from 'node:fs';
import { tmpdir as seaTmpdir } from 'node:os';
import { dirname as seaDirname, join as seaJoin } from 'node:path';
import { getRawAsset as seaGetRawAsset, isSea as seaIsSea } from 'node:sea';
if (!seaIsSea()) throw new Error('Expected a Node SEA executable');
const seaAssetRoot = seaMkdtempSync(seaJoin(seaTmpdir(), 'lazyapp-opentui-'));
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
  const direct = join(root, 'node_modules', name)
  try {
    return await realpath(direct)
  }
  catch {
    const require = createRequire(join(from, 'package.json'))
    let current = dirname(require.resolve(name))
    while (current !== dirname(current)) {
      try {
        const metadata = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'))
        if (metadata.name === name)
          return current
      }
      catch {}
      current = dirname(current)
    }
    throw new Error(`Cannot locate package metadata for ${name}.`)
  }
}
async function copyNotices(name, from) {
  if (visited.has(name))
    return
  visited.add(name)
  const directory = await packageDirectory(name, from)
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  const destination = join(staging, 'licenses', name)
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
