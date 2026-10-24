# lazyapp

[English](README.md) · [中文](README.zh-CN.md)

A personal, offline App workspace with both an OpenTUI terminal interface and a local Node.js Web editor. Organize metadata, assets, platform credentials, services, environments, and store materials.

No cloud, telemetry, or database. Both interfaces use the same plain JSON and original files in `<project>/.lazyapp/`.

## Features

### One workspace for everything

All of your app's configuration in a single, browsable structure:

| Category     | What it holds                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| App          | name, description, version, enabled platforms & environments                                                |
| Assets       | icon, splash, screenshots, promo images, waiver, business license, software copyright and supplements       |
| Platforms    | Android / iOS / HarmonyOS / Windows / macOS / mini-program identity and signing credentials per environment |
| Services     | third-party credentials (Apple, Google, Huawei, WeChat, maps, push, …)                                      |
| Environments | per-environment API/Web/CDN endpoints and variables                                                         |
| Store        | store listings, copy, links, and images                                                                     |

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

`Enter` descends category → list → detail editor → field. Edit a clean draft, then save with `s` or the `[ Save document ]` row. Leaving a dirty form always offers **save / discard / cancel**; failed saves keep your draft; canceling never writes.

### Managed file import

Missing resources (`source.png`, `certificate.p12`, …) show red. Press `Enter` on one, confirm the source path, and it's copied into the workspace. Alternatively reference an external file read-only. Deleting a real file keeps its `.example` placeholder so the entry stays visible.

### Read-only Doctor

One keypress runs an integrity check across field completeness, reference existence, and config consistency. It distinguishes _exists_ from _valid_, and reports "not checked" rather than "pass" when a credential can't actually be parsed.

### `中文` / `English`

Switch UI language from `Settings / 设置`; it applies immediately after saving and persists across launches.

## Quick start

```sh
# install
pnpm install

# TUI + Web — the local Web service follows the TUI lifecycle
lazyapp tui /absolute/project
lazyapp tui /absolute/project --port 3210

# TUI only (backward-compatible entry)
lazyapp /absolute/project

# Web only; no TTY required
lazyapp web /absolute/project --port 3210
```

For source runs, replace `lazyapp` above with
`node --experimental-ffi src/main.js`; Web-only mode does not require the FFI
flag. Press `W` inside the TUI to start the Web editor on port 3210. Its URL is
shown in the status line, and quitting the TUI closes the service it started.
Initialize new projects through the TUI prompt; Web-only mode never initializes.

Web uses a newspaper-style interface with local CSS and JavaScript: no CDN,
remote fonts, or network connection is required. It edits configuration and
manages original attachments (not image pixels or OCR). Images can be previewed;
other file types are downloaded. Absolute external references remain read-only.
TUI and Web can stay open together; each write takes the workspace lock and stale
configuration/attachment revisions are rejected. Reload explicitly after a conflict.

Published releases install via mise:

```sh
mise use -g github:wei-py/lazyapp@latest
lazyapp /absolute/project
```

## Using it

### Navigation

| Key                                              | Action                                           |
| ------------------------------------------------ | ------------------------------------------------ |
| `j`/`k`, `↓`/`↑`                                 | move selection in the focused panel              |
| `h`/`l`, `←`/`→`, `Tab`/`Shift+Tab`, `1`/`2`/`3` | switch focus between category/list/detail panels |
| `Enter`                                          | descend: category → list → detail editor → field |
| `Esc`                                            | walk back detail → list → category               |
| `?`                                              | context help                                     |

### Editing & files

| Key | Action                             |
| --- | ---------------------------------- |
| `a` | create a new config                |
| `e` | edit the focused field             |
| `f` | open the managed file list         |
| `D` | delete the selected file (confirm) |
| `y` | copy the focused value             |
| `/` | path search                        |
| `s` | save the current draft             |
| `:` | settings (language/theme)          |
| `L` | switch 中文 / English              |
| `q` | quit (y/n while jobs run)          |

While editing text, `j`/`k`/`h`/`l`/`q`/`?`/`g`/`G`/`/` are plain characters — Vim-style navigation only applies outside text input.

### Typical flow

1. Run `lazyapp /path/to/project`; accept initialization on first use.
2. In the **App** category, enable the platforms and environments you need.
3. Browse each platform — missing configs/resources render red. `Enter` a red config to fill a clean draft and save; `Enter` a red resource to import the file.
4. Add third-party services and per-environment variables as you go.
5. Run the **Doctor** to spot anything missing or inconsistent.
6. `q` to quit; data persists in `.lazyapp/` and reopens intact in either interface.

## Data & security

- Secrets may be stored in plaintext locally, but this is **not an encrypted vault**. Backups, sync tools, malicious processes, and accidental commits can still leak them.
- Sensitive values are masked in summaries, logs, and the Doctor; input is hidden by default.
- New POSIX data directories use `0700`; config/credential/temp files use `0600`; a `.gitignore` containing `*` is created inside the workspace.
- Saves use temp-file replacement, an exclusive write lock, and external-change detection. Corrupt JSON and unsupported schema versions are never overwritten.

## Docs & development

| Command                                                    | Purpose                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `node --experimental-ffi src/main.js tui /absolute/project` | run TUI and Web together                                               |
| `pnpm run dev -- /absolute/project`                        | run TUI only; press `W` inside it to start Web                         |
| `pnpm run web -- /absolute/project`                        | run the Web-only service (default port 3210)                           |
| `pnpm run lint` / `pnpm run lint:fix`                      | ESLint checks / fixes                                                  |
| `pnpm test`                                                | behavior tests using `node:test`                                       |
| `pnpm run build`                                           | build the current platform's Node SEA archive and checksums            |
| `pnpm run smoke:release`                                   | exercise the extracted SEA release in a PTY                            |

- `docs/spec.md` — authoritative development contract (keyboard, layout, storage, safety, acceptance).
- `docs/lazyapp.md` — product proposal and data-organization examples.

Verified locally: Node.js `26.7.0`, pnpm `12.5.1`, OpenTUI `0.5.11`, and
Node SEA on macOS arm64. Release workflows build macOS (arm64/x86_64), Linux
(x86_64/arm64), and Windows (x86_64) on their matching runners.

OpenTUI requires Node.js >=26.4.0 and `--experimental-ffi` for source TUI runs
and renderer tests. SEA releases embed Node.js, the FFI flag, OpenTUI native
assets, and local Web assets; users do not need a separate Node.js installation.
