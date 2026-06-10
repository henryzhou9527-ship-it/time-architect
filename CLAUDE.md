# Time Architect Maintenance Notes

## Operating Rule

Every functional change should update this file or `README.md` when it affects the global prompt, agent/workflow model, tool-use contract, API profile shape, deployment, login/test accounts, or user-facing workflow.

After code changes, sync immediately:

1. run `npm run check`
2. commit and push to GitHub
3. deploy production with `npx --yes vercel@latest deploy --prod -y`

Never commit real API keys. Keys belong in browser BYOK storage or Vercel environment variables.

## Cloud Accounts And Sync

`/api/accounts` is the cloud account endpoint. It stores username, salt, and a password-derived verifier in private Vercel Blob records. `/api/settings` is the cross-device settings endpoint and stores `calendar_plan` for any registered cloud account, not a hardcoded user allowlist. The project must have `BLOB_READ_WRITE_TOKEN` configured in Vercel.

The browser sends encrypted cloud values when `calendarEncKey` is active:

- local plan: normal `calendarPlan`
- cloud value: `{ encrypted: true, algorithm: "AES-GCM", envelope }`
- the envelope is produced with the user's password-derived key
- settings requests include the cloud account username and verifier headers

Do not change this back to plaintext sync or a `henry`/`admin` allowlist. Test accounts are intentionally local-only.

If cloud decrypt fails, `calendarCloudSyncBlocked` must stay true until the next successful cloud load. Do not let a wrong-password local plan overwrite the encrypted cloud plan.

## Workflow Model

Time Architect has no preset agents. `CALENDAR_AGENT_ROLES = []`. The user builds their own roster on the Workflow page.

The Workflow page contains:

- **One global prompt textarea** (undeletable). Default value is `CALENDAR_DEFAULT_GLOBAL_PROMPT` in `js/calendar-planner.js`: draft/confirm rules, request handling, scheduling intelligence by task kind, risk surfacing, explanation tone, and tool-format reference. Leaving it blank falls back to the built-in default.
- **A list of agent cards**, each card = name + API profile selector (pulled from API settings) + agent-specific prompt textarea + delete button. A `+ 添加 Agent` button at the top creates new cards.

Prompts are persisted in `plan.workflowPrompts` with `version = CALENDAR_WORKFLOW_PROMPT_VERSION = 5`. Legacy v4 prompts that contain `orchestrator`/`common`/`deployment` keys are migrated to the v5 shape on load (`calendarNormalizeWorkflowPrompts`).

The system prompt sent to the model is exactly: `globalPrompt + "\n\n" + agentPrompt + "\n\n[Current calendar state]\n" + compactContext`. There is no built-in role description, orchestrator prompt, or tool-format injection beyond what `CALENDAR_DEFAULT_GLOBAL_PROMPT` provides. `compactSystemPrompt(roleHint)` in `api/time-architect.js` is intentionally `return roleHint || ''`.

## Chat Turn Flow

`calendarRunAgentConversationTurn(note)` handles every user message. There are two paths:

### Fast Path (local, no LLM)

When Fast mode is on (`calendarFastMode`) and the message has no `@` mention, `calendarTryFastPath(note)` tries regex parsing for date phrases (`今天`/`明天`/`下周三`/`2026-05-27`/`May 24`/...), time, duration, and title. If confidence ≥ 0.8 it synthesizes a local `create_event` tool call, generates a draft preview, and returns without hitting any model. The bubble is labelled `Fast · local`.

### Streaming LLM Path

1. `calendarResolveStreamConfig(note)` picks a profile and roleHint:
   - if the message `@mentions` a configured agent, use that agent's profile + `globalPrompt + agentPrompt`
   - otherwise use the active API profile and just `globalPrompt`
2. `calendarStreamChatRequest` POSTs to `/api/time-architect` with `stream: true`, the user message, a trimmed plan (≤30 blocks, no archives/reflections/memories), the recent 10 conversation turns, and the resolved `roleHint`.
3. `buildStreamMessages` in `api/time-architect.js` composes the system prompt as `roleHint + [Current calendar state]`. `buildCompactContext` produces compact `[Profile] / [Today] / [Blocks] / [Goals] / [Free slots next 7 days]` blocks. Messages enforce strict user/assistant alternation.
4. `streamOpenAIProvider` / `streamAnthropicProvider` stream `delta` events:
   - `delta.type === 'text'` → appended to the streaming bubble
   - `delta.type === 'tool_call'` → validated and collected
5. Allowed calendar tools: `create_event`, `update_event`, `delete_event`, `move_event`, `resize_event`, `create_goal`, `update_goal`, `delete_goal`. `respond_text` and `propose_memory` are filtered out — the model speaks via natural text streaming, not via a respond tool.
6. When the stream finishes, `calendarApplyToolCallsToPlan(collectedToolCalls, calendarPlan)` produces a draft. If it has meaningful changes (`calendarDraftHasMeaningfulChanges`), the calendar enters preview and a system message offers `应用并存档` or `丢弃`.

## Draft / Confirm Rules

Every calendar mutation is a preview, not a write. The global prompt enforces:

- New events may be proposed directly.
- Moving existing events must include a reason.
- Deleting existing events **must not** call `delete_event` directly. The model lists the items in text first and waits for an explicit confirmation (`确认 / 好的 / 删吧`) before the tool call. "Clear all" / "删除所有" follow the same rule.
- Simple unambiguous requests (title + date + time) execute without re-asking. Inferable fields (duration, importance, splittability) default from profile and common sense.
- Must ask back: deadline tasks with no due date, unclear target for update/delete, anything that affects other people.
- Never output raw JSON or echo tool parameters in chat text.

`repeat.frequency` defaults to `none`. Only explicit `每天 / 每周 / 每月 / daily / weekly / monthly` may set a recurrence. Phrases like `明天 / 下周三 / next Wednesday` are one-time date selectors. `calendarApplyCalendarEditContractToPlan` is the runtime guard that forces model-created new blocks back to `none` when no explicit recurrence language was present.

## Calendar Block Schema

Outlook-style fields: `date / day / start / end / category / kind / repeat / title / note`.

- `start` / `end` are minutes from midnight (600 = 10:00, 810 = 13:30). Minimum duration 5 minutes.
- `category`: `deep, study, workout, admin, life, reflection, recovery, reward, rest`.
- `kind`: `fixed`, `deadline`, `spark`, `routine`, `general`. `routine` requires explicit recurrence language.
- `repeat`: `{ frequency: 'none'|'daily'|'weekly'|'monthly', interval, count?, until? }`.

Manual blocks use 5-minute precision. Hover copy is user-authored — do not synthesize it from the title. Sleep windows earlier than wake time (e.g. `00:10` with wake `08:00`) cross midnight; slot search allows scheduling until midnight rather than treating the day as closed at 00:10.

## Council Mode

`@all` currently shows a placeholder message: "Council mode (@all) coming soon. Use @ to target a single agent, or send without @ for the default model." Multi-agent batched runs are not active in the streaming pipeline. The legacy `council: true` backend path still exists in `api/time-architect.js` but is not wired to the streaming UI.

## API Profile Matching

Server profiles are discovered from `GET /api/time-architect`. Browser profiles merge with server profiles by model/name. Client requests send only the selected public profile fields unless the profile is BYOK, in which case the API key is sent to `/api/time-architect` for that request only. Up to 8 profiles are kept per store.

When adding profiles, keep names and model ids stable so agent → profile lookup (`calendarApiProfileForAgent`) remains deterministic.

## File Ownership

- `js/calendar-planner.js` — frontend state, render, fast path, streaming chat turn, workflow page, calendar block behaviour, cloud sync, encryption.
- `api/time-architect.js` — API-only model proxy: `compactSystemPrompt`, `buildCompactContext`, `buildStreamMessages`, OpenAI/Anthropic streaming providers, tool validation. No hardcoded role text.
- `api/accounts.js`, `api/settings.js`, `api/_shared/accounts.js` — cloud account + encrypted plan sync.

## Verification

```bash
npm run check               # node --check on 5 core JS files
```

Real chat behaviour must be tested by sending messages through the deployed app — there is no offline regression script.

Any change to `calendarResolveStreamConfig`, `calendarTryFastPath`, `calendarApplyToolCallsToPlan`, `buildStreamMessages`, `compactSystemPrompt`, or `buildCompactContext` should be tested in the deployed app, not just by `npm run check`.
