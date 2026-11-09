# Workshop Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Attach images from the workshop directly to entity galleries and recover existing Codex portraits without rewriting entity text.

**Architecture:** The assistant returns `imageAttachments` beside document proposals. The server validates campaign ownership, imports actual generated files or reuses uploaded media, and records attachment results in message metadata. The workshop displays verified previews and entity links; uploaded message images also have a manual target picker.

**Tech Stack:** Existing TypeScript, Fastify, SQLite, Zod and React packages; no new dependency or database migration.

**Spec:** This document records the requested behavior and interface decisions.

## Global Constraints

- Keep README unchanged and keep personal images and recovery files outside Git.
- Image requests: `{ documentId, imageId }` or `{ documentId, path }`, exclusively one source; UUID identifiers; maximum 50 requests.
- Results: `{ documentId, documentTitle, image?, error? }`; success requires a real stored attachment. Preserve entity content and fields.
- Read local files only from the configured generated-images directory, default `~/.codex/generated_images`; validate canonical paths, file type, signature and 10 MiB size limit.
- Repeated imports reuse identical campaign media and existing links. Cross-campaign sources and targets are rejected.
- Persist results in `MessageMeta.imageAttachments`; remap image and document IDs during campaign import.

## Review Focus

- File traversal, symlinks, missing or invalid images must produce errors without exposing arbitrary files.
- A failed item must not prevent other batch attachments; repeated execution must not duplicate media.
- Background completion must await attachment storage; stop and shutdown must not leave unobserved work.
- Existing messages, document proposals, pasted images and export/import must retain their behavior.
- Gallery previews, error states and the manual picker must work after navigation and on narrow screens.

### Task 1: Server attachment execution

**Files:** Shared image schemas/message metadata; server proposal parser, workshop service/routes, media service, transfer service, assistant job completion; adjacent tests.

- [x] Add failing tests for response parsing and API attachments using real temporary images and SQLite.
- [x] Add the shared request/result types and safe generated-file importer.
- [x] Execute parsed attachments, persist verified results and await background completion.
- [x] Remap result references during import; include saved image IDs in workshop context.
- [x] Verify malicious paths, ownership, duplicates, partial failure, cancellation and export/import.

### Task 2: Workshop image UI

**Files:** Workshop panel, new focused image components, image-message rendering and styles; adjacent tests.

- [x] Reproduce missing attachment results with a rendered workshop message.
- [x] Show server-confirmed image previews, target links and per-item errors.
- [x] Add a target-card picker for uploaded message images using the existing attachment API.
- [x] Verify successful attachment, errors, correct target selection and narrow layouts.

### Task 3: Integration and recovery

- [x] Run `pnpm check`, browser checks and an independent code review.
- [x] Back up the local database and attach the existing 15 mapped portraits through the verified API.
- [x] Verify gallery persistence without entity-text changes; keep recovery assets ignored.
- [x] Commit the implementation and update the existing PR.
