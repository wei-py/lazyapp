# lazyapp — Agent Skill

lazyapp is a local TUI for managing mobile App metadata, platform credentials, services, environments, and store materials. Agents interact with lazyapp **by reading and writing its JSON data files directly** — the TUI is for humans. There is no CLI headless mode (yet).

## When to Use This Skill

- User asks you to read, update, or validate lazyapp workspace data
- User asks about App configuration (Bundle ID, signing certs, API keys, environments)
- User wants a Doctor completeness check
- User needs to initialize a new lazyapp workspace for a project

## Workspace Layout

A lazyapp workspace lives at `<project>/.lazyapp/`. Discovery: check `<cwd>/lazyapp/app.json`. Never scan parent directories.

```
<project>/.lazyapp/
├── app.json                          # App metadata (name, version, platforms, environments)
├── .gitignore                        # Contains "*" — workspace is local-only
├── .lazyapp.lock                     # Write lock (don't touch)
│
├── assets/
│   ├── config.json                   # Icon, splash, screenshots, promotional images
│   ├── icon/source.png               # Actual image files (imported or referenced)
│   ├── splash/source.png
│   ├── screenshots/screenshot.png
│   └── promotional/source.png
│
├── platforms/
│   ├── android/
│   │   ├── config.json               # Platform identity (applicationId, versionCode, etc.)
│   │   ├── development/
│   │   │   ├── config.json           # Signing config (keystore, passwords)
│   │   │   └── signing.keystore      # Actual keystore file
│   │   └── production/
│   │       ├── config.json
│   │       └── signing.keystore
│   ├── ios/
│   │   ├── config.json               # Platform identity (bundleId, teamId, capabilities)
│   │   ├── development/
│   │   │   ├── config.json           # Signing (certificate, provisioningProfile)
│   │   │   ├── certificate.p12
│   │   │   └── provisioning.mobileprovision
│   │   └── production/
│   ├── harmony/                      # Same pattern: config.json + signing
│   ├── windows/
│   ├── macos/
│   └── miniprogram/                  # provider, appId, appSecret, privateKey
│
├── services/
│   ├── apple.json                    # Third-party service credentials
│   ├── google.json
│   ├── wechat.json
│   └── <name>.json
│
├── environments/
│   ├── development.json              # API/Web/CDN URLs, tokens, variables
│   ├── production.json
│   └── <name>.json
│
└── store/
    ├── app-store.json                # Store listing materials
    └── <name>.json
```

## Data Model

All configs are JSON with `schemaVersion: 1`. Every document has a `kind` determining its fields and canonical path.

### Document Kinds & Fields

Field types: `text`, `number`, `file`, `secret`. `file` = workspace-relative or absolute path to a real file. `secret` = plaintext credential (masked in UI, never logged).

**app** (`app.json`)
| Key | Type | Required | Note |
|-----|------|----------|------|
| `name` | text | yes | |
| `description` | text | | |
| `version` | text | | |
| `platforms` | text | | comma-separated: android,ios,harmony,windows,macos,miniprogram |
| `environments` | text | | comma-separated names, e.g. "development,production" |

**assets** (`assets/config.json`)
All `file` type: `icon`, `splash`, `screenshots`, `promotionalImage`.

**android** (`platforms/android/config.json` — platform scope)
| Key | Type | Required |
|-----|------|----------|
| `applicationId` | text | yes |
| `versionCode` | number | |
| `versionName` | text | |
| `keystore` | file | yes (signing) |
| `storePassword` | secret | yes (signing) |
| `alias` | text | yes (signing) |
| `keyPassword` | secret | yes (signing) |
| `serviceAccount` | file | |
| `googleServices` | file | |
| `firebaseAppId` | text | |
| `fcmCredentials` | secret | |

Signing fields live in `platforms/android/<env>/config.json` per environment.

**ios** (`platforms/ios/config.json` — platform scope)
| Key | Type | Required |
|-----|------|----------|
| `bundleId` | text | yes |
| `teamId` | text | yes |
| `appleId` | text | |
| `capabilities` | text | |
| `certificate` | file | yes (signing) |
| `certificatePassword` | secret | |
| `provisioningProfile` | file | yes (signing) |
| `issuerId` | text | |
| `keyId` | text | |
| `privateKey` | file | App Store Connect .p8 |
| `apnsKey` | file | APNs .p8 |
| `apnsKeyId` | text | |

**harmony** — `bundleName`, `bundleType`, `certificate` (.cer), `profile` (.p7b), `keystore` (.p12), `alias`, `storePassword`, `keyPassword`.

**windows** — `packageIdentity`, `publisher`, `version`, `certificate` (.pfx), `certificatePassword`.

**macos** — `bundleId`, `teamId`, `developerId`, `certificate` (.p12), `certificatePassword`, `provisioningProfile`.

**miniprogram** — `provider`, `appId`, `appSecret`, `privateKey`.

**service** (`services/<name>.json`)
`name`, `provider`, `category`, `appId`, `clientId`, `apiKey` (secret), `apiSecret` (secret), `clientSecret` (secret), `token` (secret), `endpoint`, `credentials` (file), `privateKey` (file), `notes`.

**environment** (`environments/<name>.json`)
`name` (required), `apiUrl`, `webUrl`, `cdnUrl`, `downloadUrl`, `privacyUrl`, `termsUrl`, `token` (secret), `variables` (secret).

**store** (`store/<name>.json`)
`name` (required), `appName`, `appId`, `subtitle`, `description`, `keywords`, `privacyUrl`, `supportUrl`, `marketingUrl`, `screenshots` (file), `promotionalImage` (file), `consoleUrl`, `notes`.

### Canonical Paths

Derive paths with these rules (`name` must be a safe single directory name):
- `app` → `app.json`
- `assets` → `assets/config.json`
- Platform `kind` platform scope → `platforms/<kind>/config.json`
- Platform `kind` signing scope → `platforms/<kind>/<environment>/config.json`
- `service` → `services/<name>.json`
- `environment` → `environments/<name>.json`
- `store` → `store/<name>.json`

## Reading Workspace Data

### Check if workspace exists

```javascript
// Read app.json — if it parses with schemaVersion: 1, workspace exists
const appJson = JSON.parse(await Bun.file('<project>/.lazyapp/app.json').text())
```

### Load all documents

For each enabled platform in `app.platforms`, read platform config + per-environment signing configs. For each `app.environments` name, read `services/<name>.json` and `environments/<name>.json`. Also read `assets/config.json` and any `store/*.json`.

**Important:** `.example` files are instructional templates, never active config. Ignore them when loading documents. A real file at the target path takes precedence over any `.example` at that path.

### Read a specific document

Given kind and optional name/environment, compute canonical path, then `JSON.parse(await Bun.file(workspaceRoot + '/' + path).text())`.

## Writing Workspace Data

### Safety rules

- Always read the current file first to get `schemaVersion` and unedited fields
- Preserve unknown fields (merge, don't replace)
- Files must be UTF-8, 2-space indent, trailing newline
- Write to a temp file then rename atomically (`Bun.write(tmp, content); await Bun.write(target, content)` — Bun handles atomic rename for small files, but for safety use: write temp, verify, rename)
- Never write to `.example` files
- Never touch `.lazyapp.lock`
- After editing `app.json` platforms/environments, check that referenced sub-configs exist

### Creating new documents

1. Validate the `name` with `isSafeName()`: no path separators, no control chars, no leading dot, ≤120 chars
2. Create the parent directory if needed
3. Write `{ "schemaVersion": 1, ...fields }` to the canonical path
4. If adding a platform to `app.platforms`, create both platform config + signing configs for each environment
5. If adding an environment to `app.environments`, create signing configs for each platform + an environment config

## Validation

Agents should validate before writing. Key rules:

- `schemaVersion` must be `1`
- Required text fields must be non-empty after trim
- `number` fields must be positive safe integers (≥1)
- `file` fields: must be either an absolute path OR a workspace-relative path with no `..`, no `\`, no `:`, no dot-prefixed components, no control chars
- `name` values: single directory name, ≤120 chars, no path separators (`/`, `\`, `:`), no control chars, no leading/trailing dot, not a Windows reserved name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
- Document kinds must be one of: `app`, `android`, `ios`, `harmony`, `windows`, `macos`, `miniprogram`, `service`, `environment`, `assets`, `store`

## Doctor Completeness Checks

Doctor is read-only. When asked to check workspace health, verify:

1. **app.json** — exists, valid JSON, `schemaVersion: 1`, `name` non-empty
2. **Platform configs** — each platform in `app.platforms` has `platforms/<kind>/config.json`
3. **Signing configs** — each platform × environment has `platforms/<kind>/<env>/config.json`
4. **Signing files** — each `file` field in signing configs points to an existing file
5. **Environment configs** — each name in `app.environments` has `environments/<name>.json`
6. **Assets** — `assets/config.json` exists
7. **Referenced files** — all `file` fields reference files that exist on disk (resolve relative to workspace root)

Report each check as: pass (exists + valid), fail (missing/invalid), or unchecked (can't verify — e.g., certificate validity, remote endpoints).

**Never claim** a file's existence implies the credential is valid, unexpired, or sufficient for signing/publishing.

## File Import

When asked to import a file into the workspace:
1. Copy the source file to the target workspace-relative path (never move)
2. Update the referencing config's `file` field to the workspace-relative path
3. External references (absolute paths) are valid but won't travel with the workspace

## Secret Handling

- `secret` type fields contain plaintext credentials — treat as sensitive
- Never log, echo, or include secret values in summaries
- Never commit lazyapp workspaces to Git (`.gitignore` = `*` blocks this)
- Workspace files use restrictive permissions: directories `0700`, files `0600`

## Initialization

To create a new workspace:

1. Create `<project>/.lazyapp/` directory (mode `0700`)
2. Write `app.json`:
```json
{
  "schemaVersion": 1,
  "name": "<project directory name>",
  "description": "",
  "version": "1.0.0",
  "platforms": "",
  "environments": ""
}
```
3. Write `.gitignore` containing `*`
4. Create directory structure: `assets/icon/`, `assets/splash/`, `assets/screenshots/`, `assets/promotional/`, `platforms/<each>/`, `services/`, `environments/`, `store/`
5. Platforms and environments start empty — user enables them in TUI later

## Common Agent Tasks

### "Check my workspace health"
→ Read `app.json`, enumerate all docs, check existence + schemaVersion + required fields. Report missing/invalid/unchecked.

### "What's my iOS Bundle ID?"
→ Read `platforms/ios/config.json` → `bundleId` field.

### "Add a new environment called 'staging'"
→ Update `app.json` `environments` to include "staging", then create signing configs for each platform under `platforms/<kind>/staging/config.json` and `environments/staging.json`.

### "Update the production API URL"
→ Read `environments/production.json`, update `apiUrl`, write back preserving other fields.

### "Import a new keystore for Android production"
→ Copy keystore to `platforms/android/production/signing.keystore`, update `keystore` field in `platforms/android/production/config.json` to `platforms/android/production/signing.keystore`.

### "List all my third-party services"
→ List files in `services/` directory, read each `.json` for `name` and `provider` fields.

## Limitations

- No CLI headless mode — agents work with files directly
- Certificate parsing/expiry checks are marked "unchecked" — agents cannot verify these either unless they invoke platform tools
- The TUI is the authoritative UI; file edits appear immediately on next TUI refresh
- Write lock (`.lazyapp.lock`) is TUI-managed; agents editing files while TUI is open may trigger external-modification detection