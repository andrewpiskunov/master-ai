# Assistant Image Actions and Entity Picker Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and meaningful RED→GREEN tests. Root coordinates the independent backend and picker work and integrates chat UI.

**Goal:** Give workshop, document and session assistants the same image actions, and replace the session's long native entity select with a searchable visual picker.

**Architecture:** Reuse the campaign-owned media service and safe generated-file importer. Extend structured `imageAttachments` requests with a third exclusive source, `prompt`, for server-side Codex generation, optional `referenceImageIds` (up to four, only with prompt) for edits and optional `setAsAvatar: true`. Confirm actions only through stored result metadata, including `isAvatar: true` after successful avatar assignment. Server enriches document/game prompts with trusted entity IDs, gallery metadata and supported actions; saves processed replies and outcomes. Frontend shares result previews and manual attachment controls, refreshes image metadata without overwriting text drafts, and hides control JSON during streaming.

**Tech Stack:** Existing TypeScript, React, Fastify, SQLite, Zod, Codex image generator, shared lightbox and modal. No new dependencies.

**Design decisions:** Keep the app's dark styling. A compact current-entity card opens a modal with search, type filters and avatar previews. Default to entities with images and choose a useful pictured entity when the session itself has no images. Allow all entities explicitly; retain selected entity across refreshes. A permanent large list would consume the narrow play panel, while another native select would retain the reported problem.

## Global Constraints

- Keep README, compose and existing entity text unchanged.
- Preserve campaign ownership checks, generated-directory boundaries, duplicate image deduplication, background completion, stop and deleted-entity handling.
- Only one source (`imageId`, `path`, `prompt`) per request; up to 50 actions. Caption and player-screen privacy behavior remain unchanged.
- `PlayImages` accepts optional `refreshKey?: number` to reload galleries after assistant actions.
- Node 22 and existing pnpm shim; serialize package checks to avoid unrelated CLI fixture startup contention.

## Review Focus

- Cross-campaign and deleted targets never gain images or avatar assignments.
- Generation cancellation during finalization cannot import files after stop.
- Background image errors appear as confirmed failures, not fabricated success.
- Navigation and late responses do not replace a different document's avatar or unsaved prose.
- Picker search/filter works with many entities, keyboard and narrow screens; initial empty session does not hide available campaign pictures.

## Task 1: Shared server image actions

**Files:** Shared image schemas, server workshop-image service and prompt, assistant route, app wiring and focused tests.

- [x] Write failing tests for prompt generation, attachment + avatar, trusted context, assistant/game result persistence, ownership, cancellation and failed actions.
- [x] Extend `WorkshopImageRequest` with `prompt?: string` (1–10,000 trimmed chars) and `setAsAvatar?: boolean`; result has `isAvatar?: boolean`.
- [x] Reuse one generator instance for direct generation and shared actions. Support asynchronous assistant finalization while keeping its job running. Preserve game log metadata and ordinary doc/edit-doc fences.
- [x] Verify focused shared/server tests and type checks.

## Task 2: Visual session entity picker

**Files:** `PlayImages.tsx`, its tests/CSS, and focused picker component/CSS if useful.

- [x] Write failing tests for search, type filter, with-images default, empty states, selected entity, stale gallery protection and refreshKey.
- [x] Replace native select with keyboard-accessible modal and pictured entities, using `Document.avatar` as the existing-gallery signal. Preserve master lightbox, show/clear, caption opt-in and existing player controller.
- [x] Verify focused web tests/type checks and desktop/mobile browser behavior.

## Task 3: Chat integration and delivery

**Files:** DocumentAssistant, GameChat, DocumentPage, PlaySession, shared image-result UI, assistant block parsing and tests; configuration docs.

- [x] Show confirmed attachment/generation/avatar results in all assistant responses, and manual attachment actions on pasted/uploaded chat images.
- [x] Refresh metadata after completed image actions, preserving drafts, current route and session gallery selection. Hide only image control JSON from streaming output.
- [x] Verify paste/upload in all three chats and the image action path using isolated fixtures; no private images published or paid generation needed for tests.
- [x] Run full checks, fresh independent review, fix important findings with regression tests, commit and push to existing PR #8.

**Verification:** Full `pnpm check` passed: 518 tests (50 shared, 245 server, 223 web), type checks, production build, documentation links and demo transfer. Fresh review found three P2 issues: raw controls after a game log, missing confirmation on manual avatar failure after successful attachment, and stale mounted document galleries. All received failing regression tests and fixes. Additional checks cover empty image-only replies and compact/unfinished control fences. Browser verification caught the generic modal backdrop below the play screen; a scoped portal layer fixes pointer access and visibility. Search/type filtering, focus restoration and 390px layout were verified against real campaign metadata. A temporary campaign verified a live Codex request from a document assistant: uploaded image attached and assigned as avatar, control JSON removed, avatar updated without reload and prose unchanged; the fixture was deleted. Paste/upload flows in all three chats are covered by their existing integration tests.

**Follow-ups during implementation:** Types now reuse the main interface's `TypeBadge` icons and colors in filters and entity cards; Images remains before Combat. A real edit request exposed missing reference passthrough to the separate image generator. References now pass campaign ownership checks, decode into private files in the job workspace and reach Codex through `--image`. A bounded final-message file distinguishes safe failures without exposing transcripts; final status takes precedence over echoed prompt keywords. RED→GREEN tests cover reference validation/ownership in all three assistants, CLI input bytes/arguments/cleanup and error diagnostics. A live edit of the supplied cover completed in 48 seconds; visual inspection confirmed the title removed. The edited version was added to the existing session gallery while preserving prose and the chosen avatar. Source/result art stays local and is excluded from the PR.
