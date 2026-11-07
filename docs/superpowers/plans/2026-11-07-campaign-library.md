# Campaign Library Implementation Plan

**Goal:** Replace the narrow campaign list with a visual catalog: campaign covers, search, game-system filtering, sorting and clear empty states. Preserve creation and usage statistics. Keep README and existing campaign text unchanged.

**Design:** Use the app's dark palette and restrained typography. Responsive cards show a landscape cover (or an illustrated code-native placeholder), name, game system, short description and last activity. A clear toolbar searches names/descriptions/systems, filters by system (including unspecified), and sorts by latest activity, creation date or name. Cover editing stays outside the card's navigation link. No generated artwork or private assets are published.

**API contract:** `Campaign.cover?: ImageAttachment | null`, `Campaign.updatedAt?: string`; `GET /api/campaigns/:id/images` returns image metadata; `PUT /api/campaigns/:id/cover` with `{imageId: UUID | null}` returns the updated Campaign. The picker can upload via the existing image upload endpoint or select an existing campaign image. Null clears the cover. Selection must be campaign-owned; export/import remaps cover IDs and accepts older exports. Last activity includes document updates.

**Execution:** Backend/media and frontend catalog/picker are independent file domains and may proceed in parallel. Use meaningful RED→GREEN tests for persistence, ownership, transfer, search/filter/sort, cover changes and creation. Verify desktop/mobile in browser; run full checks and fresh review before pushing to PR #8.

- [x] Add campaign cover storage, safe metadata resolution, activity dates and transfer support.
- [x] Build catalog, controls and cover picker with tests.
- [ ] Verify browser behavior, checks and review, then commit and push.
