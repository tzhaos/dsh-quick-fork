## [0.5.0] - 2026-10-19

### Changed

- The single “复创 / Fork” selection action is now one compact capsule split into two buttons:
  **添加到对话 / Add to chat** quotes the selected passage into the current conversation composer;
  **添加到临时对话 / Ask in side chat** keeps the temporary right-sidebar conversation.
- Renamed the side-chat tab from “复创 / Fork” to “临时对话 / Side chat”, and the plugin display
  name from “快速复创 / Quick Fork” to “选中操作 / Selection Actions”.

### Added

- Add-to-chat writes through the Host input shell (`captureInsertion()` + `insertText()`), so the
  quote lands at the caret as one undoable plain-text edit and focus returns to the composer. A
  stale insertion point falls back to rewriting the draft with `setDraft`.
- Selected text is formatted as a Markdown blockquote and separated from an existing draft by blank
  lines.
- The capsule is measured before paint and clamped inside the viewport.

### Fixed

- The selection capsule no longer appears for selections inside editable composers (the main
  composer, queue editors and the side-chat input), which made “add to chat” meaningless or
  recursive.

### Verified

- `node scripts/check.mjs`: 17 checks green.

## [0.4.0] - 2026-10-19

### Added

- Register a right-sidebar guide entry (`临时侧聊` / `Side chat`) through the tab definition's
  official `guide` metadata, so the side chat can be opened from the new-tab guide without a
  selection. Guide-opened chats derive the parent Session from the current main view and start with
  an empty quote.

### Verified

- `node scripts/check.mjs`: 14 checks green.
- Right-sidebar guide lists the new entry and opens a clean side-chat panel.

## [0.3.1] - 2026-10-19

### Fixed

- Restored side tabs close cleanly after a page reload instead of attempting to re-create a child
  and showing "临时会话创建失败"; tab remounts within the same page still reattach.
- Fall back to the plain session binding (and unarchive) when the retained reference is gone.

### Verified

- `node scripts/check.mjs`: 13 checks green.

## [0.3.0] - 2026-10-19

### Changed

- Side chats now use a fresh blank `sessions.create` child instead of `sessions.fork`; they work while
  the parent turn is running and no longer show the inherited parent transcript.
- The child stays active (not archived) while its tab is open, so prompts stream; closing the tab
  archives it. `dsh-sidebar-sections` hides tracked side children from the sidebar.
- Tool output is collapsed into a `<details>` block with a bounded scroll area.
- The transcript auto-scrolls as messages and streaming updates arrive.
- The run id survives a page reload via `sessionStorage` but still rotates on app restart.

### Verified

- `node scripts/check.mjs`: 13 checks green.

## [0.2.0] - 2026-10-19

### Added

- The selected passage is included as a Markdown quote in the first side-chat prompt, then not
  repeated on later messages.
- Assistant messages render through the Host `MarkdownText` primitive.
- The composer focuses when the side panel binds to its child Session.

### Verified

- `node scripts/check.mjs`: 12 checks green.

# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-19

### Added

- Selection-driven “Fork” action above text selected in the main conversation.
- Native right-sidebar tab type for temporary side conversations.
- Fork creation through the public Session fork API, with archive-on-open.
- Compact side-chat panel: quote, transcript, composer, send and stop.
- Run-marker cleanup so a tab restored after an app restart closes itself.
- Selection gating inside the side panel to prevent recursive forks.

### Verified

- `node scripts/check.mjs`: 11 checks green.
