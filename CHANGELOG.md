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
