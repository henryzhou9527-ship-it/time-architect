# Time Architect Maintenance Notes

## Operating Rule

Every functional change should update this file or `README.md` when it affects the global prompt, agent/council model, tool-use contract, API shape, account/sync behaviour, mobile/Android packaging, or user-facing workflow.

After code changes, run locally:

1. `npm test` (syntax check + 26 API unit tests + 38 UI smoke/regression tests, all offline)
2. commit locally

Deploy (`npx vercel deploy --prod`) and push only when explicitly requested. The Android APK's cloud features (login/sync/chat proxy) need the deployed backend to include the CORS version of the APIs in this repo.

Never commit real API keys. Keys belong in browser BYOK storage or Vercel environment variables. `.env.local` is gitignored and auto-loaded by the dev server.

## Run & Verify Locally

- `npm start` — Node dev server (scripts/dev-server.mjs): static app + mounts all three `/api/*` handlers with a Vercel-style res adapter. With `BLOB_READ_WRITE_TOKEN` in `.env.local`, cloud accounts work locally. Prints LAN URLs for phone testing.
- `npm run test:api` — imports `api/time-architect.js` exports directly (buildCompactContext, buildStreamMessages, blockOccursOnDate, parseTimeOfDay…) plus validation/tool-schema tests.
- `npm run test:ui` — runs `js/calendar-planner.js` in a vm fake-DOM sandbox; covers fast path, overlap layout, draft stats, tool application, mention/council detection, page rendering, and an end-to-end streaming + council turn against a fake SSE fetch.
- `npm run test:chat` — optional live test against a deployment (`TA_TEST_URL` overrides).

## Cloud Accounts And Sync

`/api/accounts` stores username, salt, and a password-derived verifier in private Vercel Blob records. `/api/settings` stores `calendar_plan` per account. Requires `BLOB_READ_WRITE_TOKEN`.

The browser sends encrypted cloud values when `calendarEncKey` is active: `{ encrypted: true, algorithm: "AES-GCM", envelope }` produced with the password-derived key; requests carry `X-Time-Architect-User` / `X-Time-Architect-Proof` headers. If cloud decrypt fails, `calendarCloudSyncBlocked` stays true until the next successful cloud load — a wrong-password local plan must never overwrite the encrypted cloud plan. Test accounts are intentionally local-only.

All three API endpoints send CORS headers (`Access-Control-Allow-Origin: *` + OPTIONS preflight) so the Android app (origin `https://localhost`) and other cross-origin clients can call them. Auth never uses cookies, only the explicit proof headers, so `*` is safe.

## Workflow Model

No preset agents. The user builds a roster on the Workflow (Flow) page:

- One undeletable **global prompt** textarea. Default = `CALENDAR_DEFAULT_GLOBAL_PROMPT` in `js/calendar-planner.js` (draft/confirm rules, scheduling intelligence, risk surfacing, tool-format reference incl. goal tools). Blank falls back to the built-in default. Stored copies of an *older built-in default* are auto-upgraded on load (`calendarIsLegacyDefaultPrompt` marker check); customized prompts are never touched.
- **Agent cards**: name + API profile selector + per-agent prompt + delete. `calendarCleanAgent` persists `apiProfileId`, and `calendarApiProfileForAgent` resolves binding by id first, then model/name match.

Prompts persist in `plan.workflowPrompts` with `version = 5`. Legacy v4 shapes (`orchestrator`/`common`/`deployment`) migrate to defaults on load.

System prompt sent to the model = `globalPrompt + "\n\n" + agentPrompt + "\n\n[Current calendar state]\n" + compactContext`. `compactSystemPrompt(roleHint)` in `api/time-architect.js` is intentionally `return roleHint || ''`.

## Chat Turn Flow

`calendarRunAgentConversationTurn(note)` dispatches every user message:

1. **Council path** — `calendarAllAgentsMentioned` (`@all` / `@全体` / `/council`…) → `calendarRunCouncilTurn`: each configured agent streams a reply in sequence via `calendarStreamOneAgentTurn`; earlier replies appear in history as `[label] text`; all tool calls merge into ONE draft via `calendarBuildDraftFromToolCalls`. Stop aborts the current agent and skips the rest. Zero agents → guidance message, no model call.
2. **Fast Path** — Fast mode on + no mention: `calendarTryFastPath` regex parse (CN/EN dates, times, ranges, durations). Confidence ≥0.8 → local `create_event` draft labelled `Fast · local`.
3. **Single-agent streaming** — `calendarResolveStreamConfig` picks profile + roleHint (mentioned agent or active profile), then `calendarStreamOneAgentTurn` streams text/tool deltas into the bubble; afterwards `calendarBuildDraftFromToolCalls` creates the draft preview.

Request body (`calendarStreamChatRequest`): `stream: true`, `message` (mentions stripped), `clientNow` (**user local wall time** `YYYY-MM-DDTHH:MM` — the server has no reliable timezone), `plan` with `calendarContextBlocks` (recurring + recent/future, max 40, sorted by date), last 10 turns **excluding** the current note (the server appends `message` exactly once and also dedupes defensively), `roleHint`, `user`, and `clientConfig(s)`.

During a turn a 1-second ticker only updates the header status text (`calendarUpdateTurnStatusText`) — never a full re-render, so selections/forms survive streaming.

## Server (`api/time-architect.js`)

Streaming-only POST (`{stream:true}`; anything else → 400) + GET (public config/profiles). The legacy router/council/non-stream JSON paths were removed in the June 2026 overhaul.

- `buildStreamMessages` enforces strict user/assistant alternation and appends the user message exactly once.
- `buildCompactContext(plan, clientNow)` emits `[Profile]` (habits parsed via `parseTimeOfDay` — accepts `"08:00"` strings or minutes; sleep ≤ wake is flagged `past midnight`), `[Today]` in user-local time, `[Blocks]`, `[Goals]`, `[Free slots next 7 days]` (expands recurrence via `blockOccursOnDate`; cross-midnight sleep keeps the day open until 24:00).
- `streamOpenAIProvider` / `streamAnthropicProvider` emit `delta` events; tool calls are validated by `validateToolCall({blocks, goals}, 'all', userMessage)` as they flush.
- Tools sent to the model: ALL_TOOLS minus `respond_text`/`propose_memory` — i.e. event CRUD + move/resize, `create_goal`/`update_goal`/`delete_goal`, `update_profile`.
- **Recurrence guard is runtime code**: `applyRecurrenceGuard` in `api/_shared/validation.js` forces `repeat.frequency` back to `none` unless the user message contains explicit recurrence language.

## Draft / Confirm Rules

Every calendar mutation is a preview. The client applies validated calls with `calendarApplyToolCallsToPlan`; `calendarDraftPlanStats` diffs blocks (by shape), goals (by shape), and profile, so goal-only or profile-only changes still produce a draft. Apply = `应用并存档` (merges plan + archives the conversation); `丢弃` discards. Deleting existing events requires textual confirmation first (prompt-enforced); manual deletes always `confirm()` and warn about recurring series.

## Calendar Board

- Blocks: `date / day / start / end / category / kind / repeat / title / note`, minutes from midnight, 5-min precision, min 5 min.
- Overlapping blocks are laid out side-by-side: `calendarLayoutDayBlocks` clusters transitively-overlapping occurrences and assigns first-free columns.
- Interactions: drag empty space = create (quick-add form; outside click/Esc cancels), drag block = move (cross-day updates `date`), bottom handle = resize, click = select + inline editor, Delete key = confirm-delete. Recurring occurrences are click-only (↻ badge). All board interactions are disabled while a draft preview is active.
- Mobile (≤900px): fixed bottom nav (`calendarMobileNavHtml`) + chat as a full-screen drawer; chat defaults closed on small screens.

## PWA & Android

- PWA: `manifest.webmanifest`, `sw.js` (stale-while-revalidate shell; `/api` never cached — bump `CACHE_VERSION` when shipping asset changes), icons generated by `npm run icons` (scripts/make-icons.mjs, zero-dep PNG encoder; also writes Android mipmaps when `android/` exists).
- Android: Capacitor 8 project in `android/` (appId `com.henryzhou.timearchitect`, scheme `https` for secure-context WebCrypto). `npm run android:apk` = build `www/` (scripts/build-www.mjs injects `TIME_ARCHITECT_API_BASE`, default `https://time-architect-phi.vercel.app`, override with `TA_API_BASE`) → `cap sync` → gradle assembleDebug → `TimeArchitect-debug.apk`. JDK auto-detected from Android Studio's jbr. Per-device backend override: `localStorage.ta_api_base_v1`.
- `CALENDAR_API_BASE` in `js/calendar-planner.js` prefixes all API URLs; empty for same-origin web.

## File Ownership

- `js/calendar-planner.js` — entire frontend (sectioned single file; see header comment for the 12-section map).
- `js/app-config.js` — runtime API base shim (rewritten in the Android bundle).
- `api/time-architect.js` — streaming model proxy + context builder; unit-testable named exports at the bottom.
- `api/accounts.js`, `api/settings.js`, `api/_shared/accounts.js` — cloud accounts + encrypted plan sync.
- `api/_shared/tool-schema.js`, `api/_shared/validation.js` — tool definitions + runtime validation (incl. recurrence guard).
- `scripts/dev-server.mjs` — local static + API server. `scripts/build-www.mjs`, `scripts/build-android.mjs`, `scripts/make-icons.mjs` — packaging. `scripts/test-api.mjs`, `scripts/smoke-test.mjs` — offline tests.

## Known Trade-offs

- Council runs agents sequentially (simplest correct streaming UX); parallel fan-out would need per-bubble stream targets.
- Block drag-move is disabled for recurring occurrences to avoid series-vs-occurrence ambiguity; edit via form instead.
- `npm run test:chat` needs a live deployment + provider key; everything else is offline.
