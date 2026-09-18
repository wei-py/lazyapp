# lazyapp

[English](README.md) · [中文](README.zh-CN.md)

A personal, offline TUI for organizing App metadata, assets, platform credentials, services, environments, and store materials — everything you keep forgetting to write down when you build and ship an app.

No cloud, no telemetry, no database. Data lives in plain JSON and raw files inside a `lazyapp/` directory next to your project.

## Features

### One workspace for everything

All of your app's configuration in a single, browsable structure:

| Category | What it holds |
| --- | --- |
| App | name, description, version, enabled platforms & environments |
| Assets | icon, splash, screenshots, promo images |
| Platforms | Android / iOS / HarmonyOS / Windows / macOS / mini-program identity and signing credentials per environment |
| Services | third-party credentials (Apple, Google, Huawei, WeChat, maps, push, …) |
| Environments | per-environment API/Web/CDN endpoints and variables |
| Store | store listings, copy, links, and images |

Environments are created on demand with custom names — nothing forces `development`/`production` on a platform that doesn't need it.

### Prompt-first initialization

First launch asks in plain terminal — before raw mode or the alternate screen:

```
No lazyapp workspace found. Create one? (y/N):
```

Only `y`/`yes` creates a scaffold (in your saved language); empty, `No`, or EOF writes nothing and exits cleanly. After `y`, you land directly in the TUI — no wizard.

### Three-panel workspace

A narrow left column (workspace info, categories, list) and a large right detail pane with a status bar below. At 60–99 columns it stacks into a single column so it never breaks on a smaller terminal.

Colors carry meaning: **red** = missing config/resource, **green** = file exists (existence only — never a claim that a credential is valid).

### Field-level config editing

`Enter` descends category → list → detail editor → field. Edit a clean draft, then save with `Ctrl+s` or the `[ Save document ]` row. Leaving a dirty form always offers **save / discard / cancel**; failed saves keep your draft; canceling never writes.

### Managed file import

Missing resources (`source.png`, `certificate.p12`, …) show red. Press `Enter` on one, confirm the source path, and it's copied into the workspace. Alternatively reference an external file read-only. Deleting a real file keeps its `.example` placeholder so the entry stays visible.

### Read-only Doctor

One keypress runs an integrity check across field completeness, reference existence, and config consistency. It distinguishes *exists* from *valid*, and reports "not checked" rather than "pass" when a credential can't actually be parsed.

### `中文` / `English`

Switch UI language from `Settings / 设置`; it applies immediately after saving and persists across launches.

## Quick start

```sh
# install
bun install --frozen-lockfile

# run
bun run dev /absolute/project   # manage /absolute/project/lazyapp/
bun run dev                     # manage ./lazyapp/ in the current directory
```

Bun must be on `PATH`. A TTY is required.

Published releases install via mise:

```sh
mise use -g github:wei-py/lazyapp@latest
lazyapp /absolute/project
```

## Using it

### Navigation

| Key | Action |
| --- | --- |
| `j`/`k`, `↓`/`↑` | move selection in the focused panel |
| `h`/`l`, `←`/`→`, `Tab`/`Shift+Tab`, `1`/`2`/`3` | switch focus between category/list/detail panels |
| `Enter` | descend: category → list → detail editor → field |
| `Esc` | walk back detail → list → category |
| `?` | context help |

### Editing & files

| Key | Action |
| --- | --- |
| `n` | create a new config |
| `v` | view full field value |
| `f` | open the managed file list |
| `d` | delete the selected file |
| `/` | path search |
| `Ctrl+s` | save the current draft |
| `q` | quit (with unsaved-check) |

While editing text, `j`/`k`/`h`/`l`/`q`/`?`/`g`/`G`/`/` are plain characters — Vim-style navigation only applies outside text input.

### Typical flow

1. Run `lazyapp /path/to/project`; accept initialization on first use.
2. In the **App** category, enable the platforms and environments you need.
3. Browse each platform — missing configs/resources render red. `Enter` a red config to fill a clean draft and save; `Enter` a red resource to import the file.
4. Add third-party services and per-environment variables as you go.
5. Run the **Doctor** to spot anything missing or inconsistent.
6. `q` to quit; data persists in `lazyapp/` and reopens intact.

## Data & security

- Secrets may be stored in plaintext locally, but this is **not an encrypted vault**. Backups, sync tools, malicious processes, and accidental commits can still leak them.
- Sensitive values are masked in summaries, logs, and the Doctor; input is hidden by default.
- New POSIX data directories use `0700`; config/credential/temp files use `0600`; a `.gitignore` containing `*` is created inside the workspace.
- Saves use temp-file replacement, an exclusive write lock, and external-change detection. Corrupt JSON and unsupported schema versions are never overwritten.

## Docs & development

| Command | Purpose |
| --- | --- |
| `bun run dev` | run the TUI |
| `bun run lint` / `bun run lint:fix` | ESLint checks / fixes |
| `bun test` | behavior tests using `bun:test` |
| `bun run build` | build macOS arm64 executable + release archive + SHA256SUMS |
| `bun run smoke:release` | exercise the extracted release in a PTY |

- `docs/spec.md` — authoritative development contract (keyboard, layout, storage, safety, acceptance).
- `docs/lazyapp.md` — product proposal and data-organization examples.

Verified: macOS arm64, Bun `1.4.2`, `@opentui/core` `0.5.11`. Linux/Windows runtime compatibility is not claimed.
