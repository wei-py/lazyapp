import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { defaultInitialization } from './config/initialization.js'
import { documentFields, documentKinds, platformKinds, validateDocument } from './config/model.js'
import { releaseTarget } from './config/release.js'
import { VERSION } from './config/version.js'
import { identifyDocument, loadDocuments, runDoctor } from './features/workspace.js'
import { initializeWorkspace, openWorkspace, workspaceExists } from './storage/workspace.js'

/** Print JSON to stdout with trailing newline. */
function json(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

/** Print error to stderr and return exit code. */
function fail(message, code = 1) {
  process.stderr.write(`lazyapp: ${message}\n`)
  return code
}

async function cmdInit(projectDir, options = {}) {
  const dir = resolve(projectDir)
  if (await workspaceExists(dir)) {
    return fail(
      `Workspace already exists at ${dir}/.lazyapp; use the TUI or other CLI commands to manage it.`,
      1,
    )
  }
  const name = options.name || basename(dir) || 'My App'
  try {
    const { app, examples } = defaultInitialization(name)
    const session = await initializeWorkspace(dir, app, { examples })
    await session.close()
    json({ status: 'ok', project: dir, name: app.name })
    return 0
  }
  catch (error) {
    return fail(error.message, 1)
  }
}

async function cmdDoctor(projectDir) {
  const dir = resolve(projectDir)
  let session
  try {
    session = await openWorkspace(dir)
  }
  catch (error) {
    return fail(error.message, 1)
  }
  try {
    const results = await runDoctor(session, 'en')
    json({ project: dir, results })
    const errors = results.filter(r => r.status === 'error' || r.status === 'missing').length
    return errors > 0 ? 1 : 0
  }
  catch (error) {
    return fail(error.message, 1)
  }
  finally {
    await session.close()
  }
}

async function cmdList(projectDir, options = {}) {
  const dir = resolve(projectDir)
  let session
  try {
    session = await openWorkspace(dir)
  }
  catch (error) {
    return fail(error.message, 1)
  }
  try {
    const documents = await loadDocuments(session, { includeExamples: false })
    const kindFilter = options.kind
    const filtered = kindFilter ? documents.filter(d => d.kind === kindFilter) : documents

    const items = []
    for (const doc of filtered) {
      if (!doc.data) {
        items.push({
          path: doc.path,
          kind: doc.kind,
          scope: doc.scope,
          name: doc.name,
          environment: doc.environment,
          missing: true,
        })
        continue
      }
      const summary = {}
      const fields = documentFields(doc.kind, { scope: doc.scope })
      for (const field of fields) {
        const value = doc.data[field.key]
        if (value !== undefined && value !== null && value !== '') {
          if (field.type === 'secret')
            summary[field.key] = '***'
          else summary[field.key] = value
        }
      }
      items.push({
        path: doc.path,
        kind: doc.kind,
        scope: doc.scope,
        name: doc.name,
        environment: doc.environment,
        fields: summary,
      })
    }
    json(items)
    return 0
  }
  catch (error) {
    return fail(error.message, 1)
  }
  finally {
    await session.close()
  }
}

async function cmdGet(projectDir, docPath, key) {
  const dir = resolve(projectDir)
  let session
  try {
    session = await openWorkspace(dir)
  }
  catch (error) {
    return fail(error.message, 1)
  }
  try {
    const { data } = await session.read(docPath)
    if (!data)
      return fail(`Document not found: ${docPath}`, 1)
    if (key) {
      if (!(key in data))
        return fail(`Field '${key}' not found in ${docPath}`, 1)
      process.stdout.write(`${data[key]}\n`)
    }
    else {
      json(data)
    }
    return 0
  }
  catch (error) {
    return fail(error.message, 1)
  }
  finally {
    await session.close()
  }
}

async function cmdValidate(projectDir, docPath) {
  const dir = resolve(projectDir)
  const identified = identifyDocument(docPath)
  if (!identified)
    return fail(`Not a recognized document path: ${docPath}`, 1)
  let session
  try {
    session = await openWorkspace(dir)
  }
  catch (error) {
    return fail(error.message, 1)
  }
  try {
    const { data } = await session.read(docPath)
    if (!data)
      return fail(`Document not found: ${docPath}`, 1)
    const issues = validateDocument(identified.kind, data, { scope: identified.scope })
    if (issues.length === 0) {
      json({ path: docPath, kind: identified.kind, scope: identified.scope, status: 'valid' })
      return 0
    }
    json({
      path: docPath,
      kind: identified.kind,
      scope: identified.scope,
      status: 'invalid',
      issues,
    })
    return 1
  }
  catch (error) {
    return fail(error.message, 1)
  }
  finally {
    await session.close()
  }
}

async function cmdUpdate() {
  let target
  try {
    target = releaseTarget()
  }
  catch (error) {
    return fail(error.message, 1)
  }

  // Refuse to self-update when running from source checkout.
  if (basename(process.execPath) !== target.binaryName) {
    return fail(
      '--update requires a compiled lazyapp binary. Run the compiled release or update manually.',
      1,
    )
  }

  const current = VERSION
  process.stderr.write(`Current version: ${current}\nChecking for updates...\n`)

  let release
  try {
    const res = await fetch('https://api.github.com/repos/wei-py/lazyapp/releases/latest', {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'lazyapp-update' },
    })
    if (!res.ok) {
      if (res.status === 403 || res.status === 429)
        return fail('GitHub API rate-limited. Try again later or update manually.', 1)
      return fail(`GitHub API returned ${res.status}.`, 1)
    }
    release = await res.json()
  }
  catch {
    return fail('Network error fetching release info. Check your connection.', 1)
  }

  const latest = release.tag_name.replace(/^v/, '')
  if (latest === current) {
    process.stderr.write(`Already up to date (v${current}).\n`)
    return 0
  }

  const assetName = target.archiveName
  const asset = release.assets?.find(a => a.name === assetName)
  if (!asset)
    return fail(`No ${assetName} asset found in the latest release.`, 1)

  if (process.execPath.replaceAll('\\', '/').includes('mise/installs/lazyapp')) {
    return fail(
      `lazyapp is managed by mise. Run:\n  mise upgrade lazyapp\nLatest: v${latest}  Current: v${current}`,
      1,
    )
  }

  process.stderr.write(`Updating from v${current} to v${latest}...\n`)

  const tmpDir = join(tmpdir(), `lazyapp-update-${Date.now()}`)
  const archive = join(tmpDir, assetName)
  try {
    await mkdir(tmpDir, { recursive: true })

    // Download
    const blob = await fetch(asset.browser_download_url).then((r) => {
      if (!r.ok)
        throw new Error(`Download failed: ${r.status}`)
      return r.blob()
    })
    await writeFile(archive, new Uint8Array(await blob.arrayBuffer()))

    // Extract (.tar.gz or .zip; both bsdtar and GNU tar read the local tar.gz)
    const extract = Bun.spawnSync(['tar', '-xf', archive, '-C', tmpDir])
    if (extract.exitCode !== 0)
      throw new Error('Extraction failed')

    // Replace binary
    const newBinary = join(tmpDir, 'bin', target.binaryName)
    const fileStat = await stat(newBinary).catch(() => null)
    if (!fileStat?.isFile())
      throw new Error('Binary not found in release archive')

    await chmod(newBinary, 0o755)
    if (process.platform === 'win32') {
      // Windows cannot replace a running executable in place.
      await rm(`${process.execPath}.old`, { force: true })
      await rename(process.execPath, `${process.execPath}.old`)
    }
    await rename(newBinary, process.execPath)

    process.stderr.write(`Updated to v${latest}.\n`)
    return 0
  }
  catch (error) {
    return fail(`Update failed: ${error.message}. Reinstall manually.`, 1)
  }
  finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function printUsage() {
  process.stdout.write(`lazyapp — local App configuration manager

Usage: lazyapp [project-directory]      Open the TUI (requires interactive terminal)
  lazyapp --help, -h                    Show this help
  lazyapp --version, -v                 Print version
  lazyapp --update                      Check and install latest release
  lazyapp init <project-dir>            Initialize a new workspace
           [--name <name>]              App name (default: directory name)
  lazyapp doctor <project-dir>          Run completeness checks (JSON output)
  lazyapp list <project-dir>            List all workspace documents
           [--kind <kind>]              Filter by document kind
  lazyapp get <project-dir> <path>      Read a document (JSON output)
           [<key>]                      Read a single field (raw value)
  lazyapp validate <project-dir> <path> Validate a document (JSON output)

Document kinds: ${documentKinds.join(', ')}
Platform kinds: ${platformKinds.join(', ')}

Common paths:
  app.json                             App metadata
  assets/config.json                   Icon, splash, screenshots
  platforms/<kind>/config.json         Platform identity
  platforms/<kind>/<env>/config.json   Per-environment signing
  services/<name>.json                 Third-party service credentials
  environments/<name>.json             API/Web/CDN endpoints
  store/<name>.json                    Store listing materials

CLI commands do not require a terminal. Secrets are redacted in list output;
use get with a key to read raw values. Doctor reports existence only;
credential validity, expiry, and compatibility are not checked.
`)
}

const COMMANDS = {
  init: {
    parse(args) {
      let name = null
      const positional = []
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--name' && i + 1 < args.length) {
          name = args[++i]
        }
        else if (!args[i].startsWith('-')) {
          positional.push(args[i])
        }
        else {
          return { error: `Unknown option: ${args[i]}` }
        }
      }
      if (positional.length !== 1)
        return { error: 'Usage: lazyapp init <project-dir> [--name <name>]' }
      return { projectDir: positional[0], options: { name } }
    },
    async run({ projectDir, options }) {
      return cmdInit(projectDir, options)
    },
  },
  doctor: {
    parse(args) {
      const positional = args.filter(a => !a.startsWith('-'))
      if (positional.length !== 1)
        return { error: 'Usage: lazyapp doctor <project-dir>' }
      return { projectDir: positional[0] }
    },
    async run({ projectDir }) {
      return cmdDoctor(projectDir)
    },
  },
  list: {
    parse(args) {
      let kind = null
      const positional = []
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--kind' && i + 1 < args.length) {
          kind = args[++i]
        }
        else if (!args[i].startsWith('-')) {
          positional.push(args[i])
        }
        else {
          return { error: `Unknown option: ${args[i]}` }
        }
      }
      if (positional.length !== 1)
        return { error: 'Usage: lazyapp list <project-dir> [--kind <kind>]' }
      if (kind && !documentKinds.includes(kind)) {
        return {
          error: `Unknown document kind: ${kind}. Valid kinds: ${documentKinds.join(', ')}`,
        }
      }
      return { projectDir: positional[0], options: { kind } }
    },
    async run({ projectDir, options }) {
      return cmdList(projectDir, options)
    },
  },
  get: {
    parse(args) {
      const positional = args.filter(a => !a.startsWith('-'))
      if (positional.length < 2 || positional.length > 3)
        return { error: 'Usage: lazyapp get <project-dir> <path> [<key>]' }
      return { projectDir: positional[0], docPath: positional[1], key: positional[2] || null }
    },
    async run({ projectDir, docPath, key }) {
      return cmdGet(projectDir, docPath, key)
    },
  },
  validate: {
    parse(args) {
      const positional = args.filter(a => !a.startsWith('-'))
      if (positional.length !== 2)
        return { error: 'Usage: lazyapp validate <project-dir> <path>' }
      return { projectDir: positional[0], docPath: positional[1] }
    },
    async run({ projectDir, docPath }) {
      return cmdValidate(projectDir, docPath)
    },
  },
  update: {
    parse(args) {
      if (args.length > 0)
        return { error: 'Usage: lazyapp --update' }
      return {}
    },
    async run() {
      return cmdUpdate()
    },
  },
}

/** Parse args and run CLI command. Returns exit code, or null if args are for TUI mode. */
export async function runCli(args) {
  if (args.length === 0)
    return null

  const command = args[0]

  if (command === '--help' || command === '-h') {
    printUsage()
    return 0
  }
  if (command === '--update') {
    return cmdUpdate()
  }

  const handler = COMMANDS[command]
  if (!handler)
    return null

  const parsed = handler.parse(args.slice(1))
  if (parsed.error)
    return fail(parsed.error, 1)

  return handler.run(parsed)
}
