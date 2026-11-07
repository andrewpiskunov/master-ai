# Image Viewer and Entity Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open attached pictures in an in-app viewer and give every entity type an avatar in its header and list cards.

**Architecture:** One reusable image viewer serves galleries and chat attachments. Documents expose a resolved, read-only `avatar` image: the valid selected gallery image or the first gallery image by default. Explicit selection lives in `fields.avatarImageId`, so no database migration is needed.

**Tech Stack:** Existing React, TypeScript, Fastify, SQLite and Zod; no new dependency.

**Spec:** This document records the requested behavior and implementation contracts.

## Global Constraints

- Keep README and existing entity text unchanged; private portraits and browser screenshots remain ignored.
- `Document.avatar?: ImageAttachment | null` contains safe metadata from that document's campaign and gallery only.
- `PUT /api/documents/:id/avatar` takes `{ imageId: UUID | null }` and returns the updated Document. Null resets to the default gallery image.
- Preserve all unrelated fields, content and statuses when choosing an avatar. Detaching it must resolve a remaining image or a placeholder.
- Remap `fields.avatarImageId` during campaign import.
- Shared web component contract: `ImagePreview({ images: ImageAttachment[], index?: number, className?: string, label?: string })` renders a thumbnail button and opens `ImageViewer({ images, initialIndex?, onClose })`.
- All viewer actions stay inside the app; support keyboard navigation, Escape, focus restoration, fit/actual-size zoom, download and mobile layout.

## Review Focus

- A foreign or unattached image must never become the displayed avatar.
- Selection, detaching and import must retain a valid avatar without destroying user fields.
- Opening a viewer must preserve the current route, focus and scroll position.
- Navigating between entities must not show an old image or apply an old asynchronous choice.
- Portrait thumbnails should retain the face; the viewer must show the whole image without cropping.

### Task 1: Avatar API and serialization

- [x] Reproduce missing resolved avatar and selection behavior in API tests.
- [x] Add the optional shared avatar metadata and campaign-safe resolution in document reads.
- [x] Add selection/reset, detach cleanup and import remapping, with tests for ownership and unchanged content.

### Task 2: Shared image viewer

- [x] Add failing tests for in-app viewing, keyboard close/navigation and focus restoration.
- [x] Implement ImageViewer/ImagePreview and update message/workshop previews.
- [x] Verify fit, zoom, download and narrow-screen behavior.

### Task 3: Entity avatar UI

- [x] Add failing tests for header placeholders, selected avatars and gallery selection.
- [x] Add header avatar, gallery controls and avatars in grid/list cards using the API contract.
- [x] Use ImagePreview for gallery thumbnails and preserve drafts during updates.

### Task 4: Verification and delivery

- [x] Run full checks, independent review and browser verification with the existing portraits.
- [x] Verify automatic avatars for existing entities without rewriting their text.
- [ ] Commit and push the implementation to the existing PR.
