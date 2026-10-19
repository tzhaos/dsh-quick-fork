# dsh-quick-fork

[简体中文](README.md) | English

Select text in a conversation and **one capsule with two buttons** appears above the selection:

- **Add to chat** — attach the passage to the current composer as a numbered **annotation chip**;
  hover a chip to read the full text, and the annotation rides along as context on the next prompt
- **Ask in side chat** — open a **temporary side conversation** in the right sidebar with the
  passage quoted into the first prompt

> Version `0.6.0`. The side chat uses a native right-sidebar tab but its own compact panel; it does
> not clone the main conversation component tree.

## Why

While reviewing code or a plan, it is often useful to ask about one passage without interrupting the
main thread — and just as often you only want that passage attached to the composer before typing a
follow-up. `dsh-quick-fork` puts both actions above the selection:

1. select a passage in the main conversation
2. the floating capsule offers two actions:
   - **Add to chat** adds `1. annotation ×`-style chips inside the composer card; hover shows the
     full passage, × removes one chip, and more chips can be added
   - **Ask in side chat** opens a temporary conversation in the right sidebar with the passage
     quoted
3. when the message is sent, pending annotations travel as a leading `Selected text N:` context
   block; they clear after the Host accepts the message
4. closing the tab or the app makes the temporary conversation disappear

## Current implementation

- listens to the selection in `shell.overlay` and shows a two-segment capsule above it (one capsule,
  two buttons, a divider between them)
- add-to-chat stores the passage in a browser-local **annotation store** (bucketed per Session and
  persisted to `localStorage`)
- a composer annotation layer mounts through the `conversation.input.overlay` slot and inserts its
  row inside `[data-composer-card]`, directly before the editor; the row is restored if the card
  re-renders or remounts
- each chip shows its index and “annotation”; hovering or focusing it opens a floating panel with
  the full passage, and removing a chip renumbers the rest
- sending wraps the current Session's `prompt`: annotations are optimistically removed from the
  composer and prepended as a text block; a rejected prompt restores them in their original order
- **Ask in side chat** creates a child Session through `sessions.create({ cwd })`
- registers a native right-sidebar tab type and opens a `quick-fork` tab
- the panel shows the quote, a message list, a composer and send/stop
- the first message carries the quote; later messages do not repeat it
- archives and drops local metadata when the tab closes
- a tab restored after an app restart has no live run marker, so it closes itself instead of forking
  another child
- selections inside the side-chat panel or any editable composer are ignored

## Data and boundaries

- annotations live only in browser `localStorage`; they are not written to the host draft or Session
  data, and they survive a page reload
- annotation context enters the Session log as the leading text of the user message (DSH has no
  native text-annotation attachment type), so it is visible to both the user and the model after
  sending
- the temporary conversation is still a real DSH Session and is written to host session storage
- closing archives rather than physically deletes; it can be restored from the archive
- selected text stays in tab navigation/local metadata and the annotation store; it never changes
  the main draft text
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

- annotation context is visible as plain text at the start of the sent message
- at most 20 annotations per Session, 20000 characters each; side-chat quotes still carry the first
  2000 characters only
- annotation clearing is optimistic: once the Host accepts the message the chips clear; withdrawing
  the queued message afterwards does not restore them
- the chip row depends on the composer DOM contract (`[data-composer-card]` / `[data-input-scroll]`)
  and needs adaptation if DSH changes that layout
- depends on the right-sidebar tab, Session create and prompt APIs; DSH upgrades may need
  compatibility updates
- a tab open at app shutdown closes automatically on the next start; the child remains archived
- the side chat inherits no parent history; its context is the quote plus follow-up questions
- no recursion: the selection capsule is hidden inside the side-chat panel

## Development and tests

```sh
node scripts/check.mjs
```

The zero-dependency suite covers manifest/patch/locale/icon, parameter parsing, node-to-message
mapping, tab definition, the selection gate, quote formatting, annotation context, the annotation
store (add/remove/persist), prompt injection/restore, the capsule and composer annotation layer, and
the factory surface — 20 checks.

## License

[MIT](LICENSE)
