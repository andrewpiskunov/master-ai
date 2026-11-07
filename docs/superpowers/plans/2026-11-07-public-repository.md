# Public Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prepare master-ai for public use with clear documentation, organized packages and repeatable checks, without Docker or Compose.

**Architecture:** Keep the existing pnpm monorepo and package names. Group server routes, web features and shared contracts by purpose while preserving behavior and public exports. Use existing JSON import for the demo campaign.

**Tech Stack:** TypeScript, React, Vite, Fastify, SQLite, Drizzle, Vitest, pnpm, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-07-public-repository-design.md`

## Global Constraints

- Do not modify the user's database, backups or scratch screenshots.
- No Docker, Compose, remote publication or GitHub settings changes.
- Preserve API contracts, migrations and shared exports.
- Keep tests beside source files and maintain the Russian UI.
- Work in the current non-main branch; leave the changes available for review without committing or pushing.

## Review Focus

- A fresh checkout must install using the frozen lockfile and the documented runtime.
- Existing API and UI tests must survive all moved files.
- Demo import must preserve references and contain no credentials or personal campaign data.
- Documentation commands, environment loading and links must match actual behavior.
- CI must run without API keys, a local AI CLI or a user's database.

### Task 1: Restore and establish a baseline

- [x] Restore only missing tracked paths from HEAD.
- [x] Run the existing full test suite and record the baseline.
- [x] Record typecheck and web build results, and fix blockers exposed by public setup.

### Task 2: Organize package boundaries

**Files:** `packages/server/src/`, `packages/web/src/`, `packages/shared/src/`, each package's `README.md` and package metadata.

**Interfaces:** Keep `buildApp`, `createDb`, existing HTTP routes and `@master-ai/shared` exports compatible.

- [x] Separate server HTTP route registration from app construction and services.
- [x] Group web campaign, document, assistant and play features; keep generic UI and helpers separate.
- [x] Group shared schemas, registries and pure helpers behind the existing index.
- [x] Update imports, run existing package tests and inspect the resulting tree.

### Task 3: Public documentation and project files

**Files:** `README.md`, `README.en.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`.

- [x] Write factual user and contributor documentation plus a short README design comparison.
- [x] Add community files and issue / pull request templates with real support destinations.
- [x] Create a fictional importable campaign in `examples/`.
- [x] Capture real demo screenshots and create an SVG cover using the existing d20 identity.

### Task 4: Repeatable local setup and CI

**Files:** root and package manifests, `.env.example`, `.editorconfig`, `.gitignore`, `.nvmrc`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `scripts/`.

- [x] Pin pnpm, document a supported Node.js version and add root build/check commands.
- [x] Make the documented `.env` workflow work without adding runtime dependencies.
- [x] Add lightweight documentation / example validation and run it locally and in CI.
- [x] Configure read-only CI permissions and dependency updates; validate workflow syntax.

### Task 5: Verify and review

- [x] Run frozen-lockfile install, full tests, typecheck, build and documentation checks.
- [x] Verify demo import/export and inspect README assets in a browser.
- [x] Obtain a fresh review, resolve material findings and rerun affected checks.
- [x] Report completed changes, test counts and any remaining limitations.
