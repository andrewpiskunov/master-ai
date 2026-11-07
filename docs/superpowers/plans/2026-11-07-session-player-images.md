# Session Images and Player Screen Implementation Plan

**Goal:** Browse entity images during a session and send a chosen picture to a separate player window on the same computer, suitable for a second monitor.

**Design:** Add an Images tab beside Scenario/Documents/Combat. It selects a campaign entity, loads its gallery on demand, opens pictures in the common lightbox and offers Show to players. A header action opens the Player screen. The player window receives only the selected image metadata; it renders the whole picture against black, supports fullscreen and can be cleared by the master. Captions are off by default and explicitly enabled by the master. No entity prose, notes, stats, campaign navigation or hidden material enters that window.

**Architecture:** A random, session-scoped channel connects the two same-origin windows through BroadcastChannel. Validate incoming payloads, build image URLs from validated IDs, send current state after the player window announces readiness, and clear/disconnect on session exit. Store only the channel token in sessionStorage so a reload can reconnect. Showing another picture must not repeatedly steal focus from the master.

**Shared contract:** `usePlayerScreen(sessionId)` returns `{ image: ImageAttachment|null, captionVisible: boolean, error: string, open(): void, show(image: ImageAttachment, captionVisible?: boolean): void, clear(): void }`. Route `/player-screen/:channelId` renders standalone `PlayerScreen`. `show` opens the window synchronously only if needed, then handshake delivers the latest state. Opening the window alone starts blank. Popup blocking and unavailable channel support produce a useful error in the master's UI.

**Ownership:** One worker owns protocol/hook/PlayerScreen/route and tests. Another owns PlaySession/PlayImages/styles and tests. Root owns integration, docs, review and browser checks.

- [x] Add tested channel protocol, controller hook and standalone player route.
- [x] Add tested in-session image browser and show/clear controls for all entity types.
- [x] Verify independent windows, no leaked notes, keyboard/lightbox, mobile layout, full checks and fresh review; commit and push all pending changes to PR #8.

**Verification:** Full check passed with 461 tests (46 shared, 219 server, 196 web), type checks, production build, documentation links and demo round trip. Browser checks covered master lightbox, two independent windows, caption opt-in, fullscreen, player reload, master reload, clear, session exit and 390px layout. Review identified missing reset on master page lifecycle exit; regression tests confirmed the failure before the fix. The master now publishes blank on connection and pagehide, including resetting local state for page-cache resume.
