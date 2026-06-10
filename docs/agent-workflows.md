# Time Architect Chat Workflow

This document describes how a user message becomes a calendar draft in the current codebase. Earlier versions of this file described a 4-agent router (planner/dialogue/auditor/engineer) — that design was removed in the May 2026 refactor. The production chat pipeline is now a single streaming tool-use loop on top of user-defined agents.

## Core Execution Model

Every user message goes through `calendarRunAgentConversationTurn(note)` in `js/calendar-planner.js`. The dispatcher has exactly two paths:

1. **Fast Path** — local regex parse, no LLM, instant draft.
2. **Streaming tool-use** — `/api/time-architect` with SSE, tool calls become a draft.

The user always sees:

1. The bubble label (`Fast · local`, or the agent name + model)
2. Streamed text from the model (if streaming path)
3. Tool-call cards that summarize each proposed calendar change
4. A draft preview on the calendar, with `应用并存档` / `丢弃` controls

There is no router stage, no skill injection stage, no per-turn site-knowledge payload. The system prompt is `globalPrompt + agentPrompt + [Current calendar state]`. Calendar state (`buildCompactContext`) is the only structured payload the backend injects.

## Path 1: Fast Path

Triggered when `calendarFastMode` is on and the message has no `@` mention.

`calendarTryFastPath(note)` parses:

- Dates: `今天 / 明天 / 后天 / 大后天 / today / tomorrow`, `下周三 / 下下周五 / 周二`, `next monday`, explicit `2026-05-27 / 5月24号 / 5.24 / May 24`.
- Times: `10:00`, `10am`, `14:30-15:30`, `2pm`, `下午3点`.
- Durations: `60min`, `1h`, `45 分钟`.
- Title: everything that remains after stripping date/time/duration.

If the parse is confident (≥ 0.8), the app synthesizes a `create_event` tool call locally and applies it via `calendarApplyToolCallsToPlan` to produce a draft. The bubble is labelled `Fast · local`. No model call is made.

If confidence is too low, the message falls through to the streaming path.

## Path 2: Streaming Tool-Use

### Step 1 — Resolve profile and roleHint

`calendarResolveStreamConfig(note)`:

- If the message `@mentions` a configured agent, use that agent's API profile and concatenate `globalPrompt + agentPrompt`.
- Otherwise use the active API profile and use only `globalPrompt`.

### Step 2 — Request the stream

`calendarStreamChatRequest` POSTs to `/api/time-architect`:

```json
{
  "stream": true,
  "message": "...",
  "plan": { ...trimmed plan (≤ 30 blocks, no archives/reflections/memories) },
  "conversation": [...last 10 turns],
  "roleHint": "globalPrompt\n\nagentPrompt",
  "user": "<username or 'public'>",
  "clientConfig" | "clientConfigs": ...
}
```

### Step 3 — Backend assembles the prompt

In `api/time-architect.js`:

- `compactSystemPrompt(roleHint)` returns the roleHint verbatim. No hardcoded role description, no orchestrator prompt, no tool-format injection beyond what the user already wrote in the global prompt.
- `buildCompactContext(plan, now)` produces `[Profile] / [Today] / [Blocks] / [Goals] / [Free slots next 7 days]`.
- Final system message = `roleHint + "\n\n[Current calendar state]\n" + compactContext`.
- Conversation history is collapsed into strict user/assistant alternation.

### Step 4 — Stream from provider

`streamOpenAIProvider` or `streamAnthropicProvider` opens a tool-enabled streaming request and emits `delta` events:

- `delta.type === 'text'` → appended to the streaming bubble in the UI.
- `delta.type === 'tool_call'` → validated against the calendar block schema and pushed into a tool-call buffer.

Allowed tools: `create_event`, `update_event`, `delete_event`, `move_event`, `resize_event`, `create_goal`, `update_goal`, `delete_goal`.

`respond_text` and `propose_memory` are filtered out of the stream — the model communicates with the user via natural streamed text, not via a respond tool.

### Step 5 — Apply tool calls

When the stream finishes, `calendarApplyToolCallsToPlan(toolCalls, calendarPlan)` builds a draft plan. If it has meaningful changes (`calendarDraftHasMeaningfulChanges`), the calendar enters preview mode and the chat shows:

> 已生成草案预览。满意后点"应用并存档"，不满意可继续对话调整或点"丢弃"。

`应用并存档` archives the conversation, applies the draft, and opens a fresh dialogue. `丢弃` removes the draft and keeps the saved calendar.

## Draft / Confirm Contract

Enforced by the default global prompt (`CALENDAR_DEFAULT_GLOBAL_PROMPT`):

| Operation | Behaviour |
|---|---|
| Create new event | Model may propose directly. |
| Move existing event | Model must explain the reason. |
| Delete existing event | Model must list the targets in text and wait for `确认 / 好的 / 删吧` before calling `delete_event`. "Clear all" / "删除所有" follow the same rule. |
| Recurrence | Default `repeat.frequency = none`. Only explicit `每天 / 每周 / 每月 / daily / weekly / monthly` may set a recurrence. `明天 / 下周三 / next Wednesday` are one-time. |
| Tool-call echoing | Never output raw JSON or echo tool parameters in chat text. |

There is no runtime code guard for these rules — they are enforced purely by the prompt. If a model disobeys (e.g. creates a `repeat.frequency = weekly` block for a one-time "下周三" request), the bad call lands in the draft preview and the user has to discard it.

## Workflow Page Model

`calendarWorkflowInnerHtml`:

- One undeletable **global prompt** textarea, persisted at `plan.workflowPrompts.globalPrompt`.
- A list of **agent cards**. Each card writes back into `plan.agents[idx]` (label + apiProfileId) and `plan.workflowPrompts.agents[key]` (per-agent prompt).
- `+ 添加 Agent` creates a new card. `✕` deletes one. Empty agent list is allowed — `calendarDefaultApiStore` falls back to a single default profile.

`calendarPlan.workflowPrompts.version = CALENDAR_WORKFLOW_PROMPT_VERSION` (currently `5`). Legacy v4 prompts (containing `orchestrator`/`common`/`deployment` keys) are dropped to the v5 default on load by `calendarNormalizeWorkflowPrompts`.

## Calendar Block Schema

Outlook-style fields:

```
{
  id, title, date, day, start, end, category, kind, repeat, goalId,
  note, exactAction, output, ifInterrupted, ifFinishedEarly,
  status, source
}
```

- `start` / `end`: minutes from midnight. Minimum duration 5 minutes.
- `category`: `deep, study, workout, admin, life, reflection, recovery, reward, rest`.
- `kind`: `fixed, deadline, spark, routine, general`. `routine` requires explicit recurrence.
- `repeat`: `{ frequency, interval, count?, until? }`. Default `frequency = 'none', interval = 1`.

Manual blocks use 5-minute precision; durations like `20min` stay 20 minutes. Sleep windows earlier than wake time (e.g. `00:10` with wake `08:00`) cross midnight.

## Council Mode

Currently a stub. `@all` shows:

> Council mode (@all) coming soon. Use @ to target a single agent, or send without @ for the default model.

The legacy `council: true` backend path in `api/time-architect.js` still exists for compatibility but is not used by the streaming UI.

## Verification

```bash
npm run check
```

Runs `node --check` on the five core JS files. There is no offline regression script — real chat behaviour (Fast Path triggers, streaming tool calls, draft preview, delete-confirm gate) must be tested by sending messages through the deployed app.
