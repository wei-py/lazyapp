# Repository Guidelines

## Project Overview

lazyapp is a personal, offline TUI for organizing App metadata, assets, platform credentials, services, environments, and store materials. Initial scope: initialization wizard, configuration editing, file management, and read-only Doctor checks. No cloud service, telemetry, database, or build/sign/release execution.

**Current state:** first-stage application implemented in JavaScript with Bun and direct OpenTUI Core. Includes a staged initialization wizard, category-based configuration editors, managed file imports/deletion, external read-only references, and read-only Doctor. No standalone native executable packaging or Linux/Windows runtime compatibility is claimed.

## Architecture & Data Flow

Dependency direction: `src/main.js → app → features → storage / config`. Lower layers must not depend on application or feature modules; coordinate features through `app`, not direct access to another feature's internal state.

- UI handles presentation and input; business logic validates and performs operations; `storage` owns disk effects. Controls must not write files or launch processes directly.
- Data flow: workspace files → validated disk snapshot → editable draft → validation → storage commit → updated snapshot. Only successful saves clear dirty state; failures preserve drafts and cancellation never writes.
- Keep persisted configuration, edit drafts, and transient focus/selection/scroll state separate, each with one owner.
- User data lives in `<project>/lazyapp/`, distinct from this source repository. Discover `<cwd>/lazyapp/app.json`; do not silently scan or write parent projects.
- Internal file references are relative to the workspace root; explicit external references are absolute and read-only. Use temporary-file replacement for single-file saves, a workspace write lock, and external-change detection. Validate path traversal and symlink boundaries. Reject unsupported schema versions; never overwrite corrupt JSON as empty configuration.

## Key Directories

`docs/` holds specifications and product notes. Current source organization:

| Path | Responsibility |
| --- | --- |
| `src/app/` | Application shell, navigation, focus, lifecycle |
| `src/features/` | Document loading, validated saves, safe errors, read-only Doctor |
| `src/storage/` | Configuration I/O, imports, paths, write protection |
| `src/config/` | Shared schema, field definitions, defaults, canonical document paths |
| `tests/` | Bun behavioral tests for models, storage, features, and interactions |

Avoid parallel pages/components/layouts/stores hierarchies that duplicate these responsibilities. Assistant-skill assets are not application source or application tests.

## Development Commands

Install with `bun install --frozen-lockfile`; Bun must be on `PATH`.

| Command | Purpose |
| --- | --- |
| `bun run dev /absolute/project` | Open that project's TUI; omit the path to use cwd |
| `bun run lint` | ESLint checks |
| `bun run lint:fix` | ESLint fixes |
| `bun test` | Behavior tests using `bun:test` |

`package.json` declares `lazyapp` as the executable entry point. `bun src/main.js --help` prints usage without requiring a TTY. No build or distribution command is defined; choose one only after validating native dependency packaging.

## Code Conventions & Common Patterns

- JavaScript ES Modules; kebab-case filenames, camelCase functions/variables, PascalCase classes, UPPER_SNAKE_CASE fixed module constants.
- ESLint with `@antfu/eslint-config` is the formatting authority. JSON data uses UTF-8, two-space indentation, and a trailing newline. Markdown product/reference notes are outside application lint scope.
- JSDoc documents exported functions, shared shapes, and non-obvious constraints—not every local variable or callback.
- Prefer built-ins and direct module composition. Extract genuine reuse; do not introduce speculative abstractions, plugin systems, or dependency-injection containers.
- File/process operations are asynchronous. Ignore stale async results; distinguish loading, empty, success, failure, and cancellation. Never swallow errors, fake success, or automatically retry writes.
- Vim-style navigation applies outside text input. Characters such as `jq/?` remain text while editing. Dispatch input through modal → control → page → global, stopping after consumption. Maintain one focus target and restore focus after closing a modal.
- Confirm destructive operations with cancel selected by default. Leaving dirty forms offers save/discard/cancel.
- The renderer owns terminal output: no `console.log` or direct subprocess output while the TUI is active. Use executable-plus-argument arrays, not shell-concatenated user input. Restore terminal state idempotently on exit and catchable failures.
- Secrets may be stored locally in plaintext but are not encrypted. Mask display, redact logs, and never use real credentials in tests. New POSIX data directories use `0700`; configuration, credential, and temporary files use `0600`. External referenced files must not be modified or deleted.
- Doctor is read-only. Distinguish file existence, actual validation, and “not checked”; never imply signing/release readiness from existence alone.

## Important Files

- `docs/spec.md`: authoritative development contract, including detailed keyboard, layout, storage, safety, and acceptance requirements.
- `docs/lazyapp.md`: product proposal and data organization examples; defer to `spec.md` for conflicting security, Git-ignore, or path guidance.
- `docs/other-spec.md`: reference from a different Web project, not this project's technology or coding policy.
- `docs/skill.md`: brief TUI interaction notes; `docs/todo.md`: planning checklist, not implementation evidence.
- `skills-lock.json`: assistant-skill metadata, not an application dependency lock or runtime version pin.
- `jsconfig.json`: editor/IntelliSense config only (no `tsc` step, `checkJs` off); it does not make the project TypeScript or add a build.
- `src/main.js`: startup, argument parsing, TTY guard, signal handling, and idempotent terminal cleanup.

## Runtime/Tooling Preferences

Use Bun for runtime, dependency installation, and tests; keep `bun.lock` synchronized with `package.json`. Do not mix npm/pnpm/yarn lockfiles. Use JavaScript, not TypeScript, and `@opentui/core` directly without React/Vue rendering layers. `string-width` supports terminal-column clipping.

Verified versions: Bun 1.4.2 and OpenTUI 0.5.11 on macOS arm64. These are pinned in `package.json` and `bun.lock`. Managing Windows/Linux App configuration does not establish tool runtime compatibility. Require stdin/stdout TTY before entering raw mode. Update the verified versions only after testing startup, input, resize, and cleanup.

## Testing & QA

Tests use `bun:test` in `tests/`; no coverage threshold or CI requirement is imposed.

- Test observable contracts: validation, schema rejection, corrupt-file preservation, safe paths, write failures/conflicts, draft transitions, and secret redaction. Use isolated temporary workspaces and fictional credentials.
- TUI changes require actual terminal verification, not only state tests: text-input isolation, focus restoration, resize, Chinese display widths, long paths, layout variants, and terminal restoration after normal exit and catchable errors.
- Minimum end-to-end flow: initialize a temporary project → edit/save → exit/reopen with data intact → cancel edits without writes → Doctor distinguishes missing and unchecked items.
- Run `bun test` and `bun run lint` after changes. For documentation-only work, verify consistency and paths. See `docs/spec.md` section 12 for implemented data contracts and recorded terminal verification.
