# Repository Guidelines

## Project Overview

lazyapp is a personal, offline TUI for organizing App metadata, assets, platform credentials, services, environments, and store materials. Initial scope: prompt-first initialization, configuration editing, file management, and read-only Doctor checks. No cloud service, telemetry, database, or build/sign/release execution.

**Current state:** first-stage application implemented in JavaScript with Bun and direct OpenTUI Core. The workspace uses a narrow left column (workspace, categories, list) and a large right detail pane with status below. Numbered inset titles, square borders (ASCII for `TERM=dumb`), transparent backgrounds with `#1F2438` dialog fills, blue focus borders, full-row dark selections, and position counters follow the supplied lazygit visual reference. Missing file/configuration rows are red; existing rows are green, including selected rows. Panel switching uses `Tab`/`Shift+Tab`, `1/2/3`, and `h`/`l`; `Enter` descends categories → list → detail editor → field. The 60–99-column layout stacks the focused panel and related preview beneath workspace information, with numbers in border titles rather than a separate tab strip. Includes a pre-render terminal initialization prompt, configuration editors, managed file imports/deletion, external read-only references, and read-only Doctor. Standalone macOS arm64 packaging is verified locally; Linux/Windows runtime compatibility is not claimed.

## Architecture & Data Flow

Dependency direction: `src/main.js → app → features → storage / config`. Lower layers must not depend on application or feature modules; coordinate features through `app`, not direct access to another feature's internal state.

- UI handles presentation and input; business logic validates and performs operations; `storage` owns disk effects. Controls must not write files or launch processes directly.
- Data flow: workspace files → validated disk snapshot → editable draft → validation → storage commit → updated snapshot. Only successful saves clear dirty state; failures preserve drafts and cancellation never writes.
- Keep persisted configuration, edit drafts, and transient focus/selection/scroll state separate, each with one owner.
- User data lives in `<project>/lazyapp/`, distinct from this source repository. Discover `<cwd>/lazyapp/app.json`; do not silently scan or write parent projects.
- Internal file references are relative to the workspace root; explicit external references are absolute and read-only. Use temporary-file replacement for single-file saves, a workspace write lock, and external-change detection. Validate path traversal and symlink boundaries. Reject unsupported schema versions; never overwrite corrupt JSON as empty configuration.

## Key Directories

`docs/` holds specifications and product notes. Current source organization:

| Path            | Responsibility                                                       |
| --------------- | -------------------------------------------------------------------- |
| `src/app/`      | Application shell, navigation, focus, lifecycle                      |
| `src/features/` | Document loading, validated saves, safe errors, read-only Doctor     |
| `src/storage/`  | Configuration I/O, imports, paths, write protection                  |
| `src/config/`   | Shared schema, field definitions, defaults, canonical document paths |
| `tests/`        | Bun behavioral tests for models, storage, features, and interactions |

Avoid parallel pages/components/layouts/stores hierarchies that duplicate these responsibilities. Assistant-skill assets are not application source or application tests.

## Development Commands

Install with `bun install --frozen-lockfile`; Bun must be on `PATH`.

| Command                         | Purpose                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `bun run dev /absolute/project` | Open that project's TUI; omit the path to use cwd                                           |
| `bun run lint`                  | ESLint checks                                                                               |
| `bun run lint:fix`              | ESLint fixes                                                                                |
| `bun test`                      | Behavior tests using `bun:test`                                                             |
| `bun run build`                 | Build the current platform's executable, release archive, and SHA256SUMS                    |
| `bun run smoke:release`         | Exercise the extracted release in a PTY with no Bun on PATH (checkout read denied on macOS) |

`package.json` declares `lazyapp` as the executable entry point. `bun src/main.js --help` prints usage without requiring a TTY. `scripts/build.js` bundles Bun and OpenTUI native assets; `dist/` is ignored. `.github/workflows/release.yml` validates and publishes GitHub Release assets on `v*` tags matching `package.json`; manual runs validate without publishing. After publication, install with `mise use -g github:wei-py/lazyapp@latest`. See `docs/spec.md` for release instructions and verification limits.

## Code Conventions & Common Patterns

- JavaScript ES Modules; kebab-case filenames, camelCase functions/variables, PascalCase classes, UPPER_SNAKE_CASE fixed module constants.
- ESLint with `@antfu/eslint-config` is the formatting authority. JSON data uses UTF-8, two-space indentation, and a trailing newline. Markdown product/reference notes are outside application lint scope.
- JSDoc documents exported functions, shared shapes, and non-obvious constraints—not every local variable or callback.
- Prefer built-ins and direct module composition. Extract genuine reuse; do not introduce speculative abstractions, plugin systems, or dependency-injection containers.
- File/process operations are asynchronous. Ignore stale async results; distinguish loading, empty, success, failure, and cancellation. Never swallow errors, fake success, or automatically retry writes.
- Vim-style navigation applies outside text input. Characters such as `jq/?` remain text while editing. Dispatch input through modal → control → page → global, stopping after consumption. Maintain one focus target and restore focus after closing a modal.
- Focus lives in one of the `nav` / `list` / `form` panels. Panel switching (`Tab`, `Shift+Tab`, `1/2/3`, `h`/`l`) never prompts for a dirty draft; only changing category, item, search, or creation target does. `Esc` walks detail → list → categories.
- Modal render nodes are created after every panel node: node creation order is z-order in OpenTUI, so a dialog declared earlier is painted over by the panels.
- `Settings / 设置` selects `中文` or `English` with immediate application after a successful save. UI templates live in `src/config/i18n.js`; translate labels before interpolating user data, never translate stored keys, paths, or values. Personal preferences live outside App workspaces in `$XDG_CONFIG_HOME/lazyapp/settings.json` or `~/.config/lazyapp/settings.json`; `src/storage/preferences.js` owns persistence. Missing preferences default to English without writes; corrupt preferences must not be overwritten. Tests inject preferences or use isolated directories, never the user's home settings.
- Initialization is prompt-first: before the renderer/raw mode/alternate screen, ask `No lazyapp workspace found. Create one? (y/N): ` using the saved language. Only `y`/`yes` accepts; No/empty/EOF never write, Ctrl+C exits 130. Yes atomically creates the scaffold and enters the TUI directly, without a wizard. Only `app.json` is active configuration; its enabled platforms/environments start empty. `src/config/initialization.js` supplies default templates for all platforms and development/production, including typed resource/signing `<filename>.example` instructions. TUI projects examples as missing canonical rows without parsing their contents; red means missing, green means an actual file exists, never credential validity. Enter missing configs to edit clean drafts; Enter missing resources to confirm an import; deletion of actual files retains examples. Doctor excludes templates and references reject `.example`. Do not restore wizard pages or create fake binary files.
- Confirm destructive operations with cancel selected by default. Leaving dirty forms offers save/discard/cancel.
- The renderer owns terminal output: no `console.log` or direct subprocess output while the TUI is active. Use executable-plus-argument arrays, not shell-concatenated user input. Restore terminal state idempotently on exit and catchable failures.
- Secrets may be stored locally in plaintext but are not encrypted. Mask display, redact logs, and never use real credentials in tests. New POSIX data directories use `0700`; configuration, credential, and temporary files use `0600`. External referenced files must not be modified or deleted.
- Doctor is read-only. Distinguish file existence, actual validation, and “not checked”; never imply signing/release readiness from existence alone.

## Important Files

- `docs/spec.md`: authoritative development contract, including detailed keyboard, layout, storage, safety, and acceptance requirements.
- `docs/lazyapp.md`: product proposal and data organization examples; defer to `spec.md` for conflicting security, Git-ignore, or path guidance.
- `docs/other-spec.md`: reference from a different Web project, not this project's technology or coding policy.
- `docs/skill.md`: brief TUI interaction notes; `docs/todo.md`: planning checklist, not implementation evidence.
- `jsconfig.json`: editor/IntelliSense config only (no `tsc` step, `checkJs` off); it does not make the project TypeScript or add a build.
- `src/main.js`: startup, argument parsing, TTY guard, signal handling, and idempotent terminal cleanup.

## Runtime/Tooling Preferences

Use Bun for runtime, dependency installation, and tests; keep `bun.lock` synchronized with `package.json`. Do not mix npm/pnpm/yarn lockfiles. Use JavaScript, not TypeScript, and `@opentui/core` directly without React/Vue rendering layers. `string-width` supports terminal-column clipping.

Verified versions: Bun 1.4.2 and OpenTUI 0.5.11 on macOS arm64 and in a Linux arm64 container. These are pinned in `package.json` and `bun.lock`. Release targets additionally cover macOS x86_64, Linux x86_64/arm64, and Windows x86_64; the release workflow builds and smoke-tests each on its own OS. Managing an App platform's configuration does not establish tool runtime support for that OS. Require stdin/stdout TTY before entering raw mode. Update the verified versions only after testing startup, input, resize, and cleanup.

## Testing & QA

Tests use `bun:test` in `tests/`; no coverage threshold or CI requirement is imposed.

- Test observable contracts: validation, schema rejection, corrupt-file preservation, safe paths, write failures/conflicts, draft transitions, and secret redaction. Use isolated temporary workspaces and fictional credentials.
- TUI changes require actual terminal verification, not only state tests: text-input isolation, focus restoration, resize, Chinese display widths, long paths, layout variants, and terminal restoration after normal exit and catchable errors.
- Minimum end-to-end flow: initialize a temporary project → edit/save → exit/reopen with data intact → cancel edits without writes → Doctor distinguishes missing and unchecked items.
- Run `bun test` and `bun run lint` after changes. For documentation-only work, verify consistency and paths. See `docs/spec.md` section 12 for implemented data contracts and recorded terminal verification.
