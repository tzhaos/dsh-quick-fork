# dsh-quick-fork

[简体中文](README.md) | English

Select text in a conversation and **one capsule with two buttons** appears above the selection:

- **Add to chat** — quote the passage into the current conversation composer, ready for a follow-up
- **Ask in side chat** — open a **temporary side conversation** in the right sidebar with the
  passage quoted into the first prompt

> Version `0.5.0`. The side chat uses a native right-sidebar tab but its own compact panel; it does
> not clone the main conversation component tree.

## Why

While reviewing code or a plan, it is often useful to ask about one passage without interrupting the
main thread — and just as often you only want that passage quoted into the composer before typing a
follow-up. `dsh-quick-fork` puts both actions above the selection:

1. select a passage in the main conversation
2. the floating capsule offers two actions:
   - **Add to chat** writes a Markdown quote into the main composer (one undoable edit) and returns
     focus to it
   - **Ask in side chat** opens a temporary conversation in the right sidebar with the passage
     quoted
3. the quote is carried into the first side-chat prompt only
4. closing the tab or the app makes the temporary conversation disappear

## Current implementation

- listens to the selection in `shell.overlay` and shows a two-segment capsule above it (one capsule,
  two buttons, a divider between them)
- add-to-chat writes through the Session input shell (`captureInsertion()` / `insertText()`) as one
  undoable plain-text edit; a stale insertion point falls back to `setDraft`
- the selection becomes a Markdown blockquote; an existing draft is separated by blank lines
- **Ask in side chat** creates a child Session through `sessions.create({ cwd })`
- registers a native right-sidebar tab type and opens a `quick-fork` tab
- the panel shows the quote, a message list, a composer and send/stop
- the first message carries the quote; later messages do not repeat it
- archives and drops local metadata when the tab closes
- a tab restored after an app restart has no live run marker, so it closes itself instead of forking
  another child
- selections inside the side-chat panel or any editable composer are ignored

## Data and boundaries

- the temporary conversation is still a real DSH Session and is written to host session storage
- closing archives rather than physically deletes; it can be restored from the archive
- selected text stays in tab navigation/local metadata and never enters the main conversation
- **Add to chat** only edits the current draft; it never sends a message
- the panel does not yet implement attachments, approvals or model selection

## Install

```text
plugin_manager(action="install_bundle", target="<monorepo>/packages/dsh-quick-fork")
```

Or install the whole monorepo:

```powershell
node scripts/install-all.mjs
```

Fully quit and relaunch DSH after installing.

## Known limitations

- the selection is capped at 2000 characters; the remainder is not quoted
- **Add to chat** depends on the Host input shell; when the composer is temporarily not writable the
  capsule only shows a notice and leaves the draft untouched
- depends on the right-sidebar tab, Session create and input-shell APIs; DSH upgrades may need
  compatibility updates
- a tab open at app shutdown closes automatically on the next start; the child remains archived
- the side chat inherits no parent history; its context is the quote plus follow-up questions
- no recursion: the selection capsule is hidden inside the side-chat panel

## Development and tests

```sh
node scripts/check.mjs
```

The zero-dependency suite covers manifest/patch/locale/icon, parameter parsing, node-to-message
mapping, tab definition, the selection gate, quote formatting, the add-to-chat insertion text, the
capsule structure and the factory surface — 17 checks.

## License

[MIT](LICENSE)
