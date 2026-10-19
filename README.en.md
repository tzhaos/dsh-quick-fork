# dsh-quick-fork

[简体中文](README.md) | English

Select text in a conversation, click **Fork**, and open a **temporary side
conversation** in the right sidebar.

> `0.2.0` is an early usable version. It opens a native right-sidebar tab but
> uses its own compact side-chat panel; it does not clone the main conversation
> component tree.

## Why

While reviewing code or a plan, it is often useful to ask about one passage
without interrupting the main thread. `dsh-quick-fork` turns that into:

1. select a passage in the main conversation
2. click the floating **Fork** action
3. a temporary conversation appears in the right sidebar with the selected text
   as a quote
4. closing the tab or the app makes it disappear

## Current implementation

- listens to the selection in `shell.overlay` and shows a **Fork** button above it
- creates a child Session through `sessions.fork({ sessionId })`
- registers a native right-sidebar tab type and opens a `quick-fork` tab
- the panel shows the quote, a message list, a composer and send/stop
- archives the child after creation so it does not pollute the normal list
- archives and drops local metadata when the tab closes
- a tab restored after an app restart has no live run marker, so it closes itself
  instead of forking another child
- selections inside the side-chat panel are ignored, preventing recursive forks

## Data and boundaries

- the temporary conversation is still a real DSH Session and is written to host
  session storage
- closing archives rather than physically deletes; it can be restored from the
  archive
- selected text stays in tab navigation/local metadata and never enters the main
  conversation
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

- `0.2.0` is a compact side chat, not a full replica of the main conversation
- depends on the right-sidebar tab and Session fork APIs; DSH upgrades may need
  compatibility updates
- a tab open at app shutdown closes automatically on the next start; the child
  remains archived
- forking can fail when the current conversation has no completed turn
- no recursion: the selection action is hidden inside the side-chat panel

## Development and tests

```sh
node scripts/check.mjs
```

The zero-dependency suite covers manifest/patch/locale/icon, parameter parsing,
node-to-message mapping, tab definition, selection gating and the factory
surface — 11 checks.

## License

[MIT](LICENSE)
