import process from 'node:process'

// Release targets built by scripts/build.js and .github/workflows/release.yml.
const SUPPORTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'windows-x64',
])

/** Describe the release target for a platform/architecture pair. Throws on unshipped targets. */
export function releaseTarget(platform = process.platform, arch = process.arch) {
  const slug = `${platform === 'win32' ? 'windows' : platform}-${arch}`
  if (!SUPPORTED_TARGETS.has(slug))
    throw new Error(`Unsupported release target: ${slug}.`)
  const windows = platform === 'win32'
  return {
    slug,
    archiveName: `lazyapp-${slug}.${windows ? 'zip' : 'tar.gz'}`,
    binaryName: windows ? 'lazyapp.exe' : 'lazyapp',
    bunTarget: `bun-${slug}`,
    nativePackage: `@opentui/core-${platform}-${arch}`,
  }
}
