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
