# lazyapp

[English](README.md) · [中文](README.zh-CN.md)

A personal, offline App workspace with both an OpenTUI terminal interface and a local Bun Web editor. Organize metadata, assets, platform credentials, services, environments, and store materials.

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

HarmonyOS platform configuration supports an optional `material` file reference, normally `platforms/harmony/material.zip`. Zip an existing `material/` directory with that top-level folder preserved, then import the archive through the file field. New workspaces include an inert `material.zip.example` instruction file, not a generated ZIP. The archive may contain sensitive signing material; keep it private. Importing and downloading do not extract or validate its contents.

### Read-only Doctor

One keypress runs an integrity check across field completeness, reference existence, and config consistency. It distinguishes _exists_ from _valid_, and reports "not checked" rather than "pass" when a credential can't actually be parsed.

### `中文` / `English`

Switch UI language from `Settings / 设置`; it applies immediately after saving and persists across launches.

## Quick start

```sh
# install
bun install

# TUI + Web — the local Web service follows the TUI lifecycle
lazyapp tui /absolute/project
lazyapp tui /absolute/project --port 3210

# TUI only (backward-compatible entry)
lazyapp /absolute/project

# Web only; no TTY required
lazyapp web /absolute/project --port 3210
```

For source runs, replace `lazyapp` above with `bun src/main.js`.
Press `W` inside the TUI to start the Web editor on port 3210. Its URL is
shown in the status line, and quitting the TUI closes the service it started.
Initialize new projects through the TUI prompt; Web-only mode never initializes.

Web uses grouped workspace navigation, expandable platforms, and a shared editor
with field sections and a sticky save bar. Narrow screens collapse navigation behind
the Navigation button. CSS and JavaScript are local; no CDN or remote fonts.

Web opens on **Overview**, with App metadata, existing configuration/file counts,
enabled platforms and environments, and a compact per-category presence list.
Open configuration drafts, files, or Doctor directly from it. Counts come from the
disk snapshot, not unsaved edits; opening Overview never runs Doctor automatically
or treats file existence as credential validity.

Original attachments can be imported, previewed, downloaded, replaced, or deleted;
absolute external references remain read-only.
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
| `1`–`4` | focus App/assets, platforms, collections, or files/Doctor |
| `0` | focus the shared detail editor |
| `Tab`/`Shift+Tab` | cycle navigation groups and detail without discarding drafts |
| `[`/`]` | switch service/environment/store or files/Doctor tabs |
| `h`/`l`, `←`/`→` | expand/collapse platform trees or enter/leave detail |
| `Enter` | expand a platform, open the selected item, view a value, or save on the final row |
| `Esc` | cancel input/modal, or return from detail to the remembered group |
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

The default **Gruvbox Light** theme is a fixed, opaque light palette, regardless of terminal light/dark detection. Missing preferences and the old generic `default` value use Gruvbox Light without rewriting settings; existing named choices stay selected. Press `:` to choose another palette or explicitly select **Auto (terminal)** (`auto`), which follows terminal mode changes and uses an opaque dark fallback when detection is unavailable. Semantic text and file-status colors in Gruvbox Light remain readable on both panels and selected rows.

Available dark/light pairs: **Gruvbox**, **Catppuccin Mocha / Latte**, **Tokyo Night / Tokyo Night Day**, and **Solarized**. To switch: `:` opens settings → `j` selects Theme → `Enter`/`l` for next or `h` for previous; changes apply and save immediately, `Esc` closes. Preferences are stored in `~/.config/lazyapp/settings.json` (or under `XDG_CONFIG_HOME`). English and Chinese built-in help (`?`) lists these steps in Actions and the palettes/default in Notes.

Press `?` for a categorized reference: **Navigation**, **Actions**, and **Notes** (also available in Chinese). Use `←`/`→` or `[`/`]` to change category, `↑`/`↓` or `PgUp`/`PgDn` to scroll, and `Esc`/`Enter` to close and restore the previous focus. Each category remembers its scroll position while open; descriptions wrap into a separate column at narrow terminal widths. Safety and storage explanations live in Notes instead of crowding the shortcut list.

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
| `bun src/main.js tui /absolute/project`                    | run TUI and Web together                                               |
| `bun run dev /absolute/project`                            | run TUI only; press `W` inside it to start Web                         |
| `bun run web /absolute/project`                            | run the Web-only service (default port 3210)                           |
| `bun run lint` / `bun run lint:fix`                         | ESLint checks / fixes under Bun                                        |
| `bun test`                                                 | behavior tests using Bun's `node:test` compatibility                   |
| `bun run build`                                            | build the current platform's Bun standalone archive and checksums     |
| `bun run smoke:source` / `bun run smoke:release`             | locally exercise source / extracted release in a real PTY             |

- `docs/spec.md` — authoritative development contract (keyboard, layout, storage, safety, acceptance).
- `docs/lazyapp.md` — product proposal and data-organization examples.

Tooling is pinned to Bun `1.4.2` and OpenTUI `0.5.11`. Use Bun >=1.4.2 for
source execution; no experimental FFI flag is needed. `bunfig.toml` disables
lockfile writes under the repository's no-lockfile policy.

Release workflows build macOS (arm64/x86_64), Linux (x86_64/arm64, glibc), and
Windows (x86_64) on matching runners. Bun standalone releases embed the runtime
and OpenTUI native assets, with local Web files alongside the executable;
users do not need a separate Bun or Node.js installation. CI/CD never runs
smoke tests; run both smoke commands locally. See `docs/spec.md` for actual
verification scope and target-platform limitations.
