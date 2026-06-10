# Time Architect

Standalone version of Time Architect from Henry's Room.

It is a goal-first time planning cockpit:

- daily focus and weekly 24/7 calendar
- task time prediction
- workload ledger
- health and recovery constraints
- API-only user-visible chat responses with streaming tool-use
- BYOK model settings, user-defined agents, and a fast local path for simple inputs

## Run locally

```bash
python3 -m http.server 4175
```

Open:

```text
http://localhost:4175
```

## Deploy to Vercel

One-click import:

[Deploy Time Architect to Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhenryzhou9527-ship-it%2Ftime-architect&project-name=time-architect&repository-name=time-architect)

## Model API

The app is API-only for user-visible chat answers. If no server key or BYOK key is available, the UI shows the API failure instead of generating a fake local answer (the local Fast Path described below is a separate fast-create heuristic, not a fake LLM reply).

For LLM planning, open the model drawer and paste your own API key. Keys are kept in browser localStorage and sent only to `/api/time-architect` for proxying.

Static GitHub Pages deployments do not execute `/api/time-architect`; use Vercel or another serverless host for the API proxy.

Public Vercel deployments should normally use BYOK instead of a shared server key. If you deliberately want the server to use a Vercel environment key, also set:

```text
TIME_ARCHITECT_ALLOW_SERVER_KEY=true
```

Server environment variables are optional:

```text
TIME_ARCHITECT_ALLOW_SERVER_KEY
TIME_ARCHITECT_API_KEY
TIME_ARCHITECT_SERVER_CONFIGS
TIME_ARCHITECT_BASE_URL
TIME_ARCHITECT_MODEL
TIME_ARCHITECT_API_MODE
OPENAI_API_KEY
BLOB_READ_WRITE_TOKEN
```

Do not commit real API keys.

### Accounts and cross-device sync

Time Architect uses cloud accounts backed by private Vercel Blob records. `/api/accounts` stores the account username, password salt, and password-derived verifier; `/api/settings` stores that account's `calendar_plan`. The store is private and requires `BLOB_READ_WRITE_TOKEN` in Vercel.

Registration creates a real cloud account, so a second device can log in with the same username and password and load the same calendar. The browser derives an AES-GCM key from the password and encrypts the plan before upload; the Blob record stores an encrypted envelope, not the plain calendar/archive JSON. If the cloud plan cannot be decrypted, cloud overwrite is blocked so a wrong password cannot replace the saved plan.

API keys and model profile secrets remain local to each browser. Test accounts stay local-only and do not sync.

## Workflow Page

Time Architect ships with **no preset agents**. The Workflow page lets the user assemble their own:

- A single, undeletable **global prompt** textarea. The built-in default (`CALENDAR_DEFAULT_GLOBAL_PROMPT`) covers draft/confirm rules, request handling, scheduling intelligence per task kind, risk surfacing, explanation tone, and the tool-format reference. Replace it with your own to fully customize behaviour.
- A list of **agent cards**. Each card has a name, an API profile selector (from the API settings page), an agent-specific prompt textarea, and a delete button. Add new agents with the top `+ 添加 Agent` button.

The system prompt the model sees is always: `globalPrompt + agentPrompt (if @mentioned) + [Current calendar state]`. Calendar state is auto-injected per turn and contains `[Profile]`, `[Today]`, `[Blocks]`, `[Goals]`, and `[Free slots next 7 days]`. There is no hidden role description or orchestrator prompt beneath this.

Old prompt sets that contained `orchestrator`/`common`/`deployment` sections (workflow prompt version ≤ 4) are migrated to the v5 shape on load.

## Chat behaviour

### Fast Path (no LLM)

Fast mode is on by default. When the message has no `@` mention and Fast mode is on, the app first tries a local regex-based parser. It can lift simple natural-language inputs like:

- `今天 14:00 写周报 60min`
- `明天 10-11 复盘`
- `下周三 10am mental health consulting`
- `2026-06-03 9:00 dentist`
- `next Monday 14:30 1h IELTS writing`

If the parser is confident (≥ 0.8), the app synthesizes a `create_event` tool call locally and shows a draft preview immediately, labelled `Fast · local`. No API call, no token cost.

### Streaming tool-use

Anything Fast Path doesn't handle is sent to the model. The chat panel streams the model's text answer, and any `tool_call` it emits (`create_event`, `update_event`, `delete_event`, `move_event`, `resize_event`, `create_goal`, `update_goal`, `delete_goal`) is validated and aggregated into a draft. The model speaks through natural streamed text — there is no `respond_text` tool any more.

`@mention` an agent name to route a single turn to that agent's profile + prompt. Without `@`, the active API profile is used with only the global prompt. `@all` currently shows a placeholder; council mode is paused.

### Draft / confirm contract

The global prompt requires:

- Calendar mutations are proposed as drafts, not silently applied. The UI shows `应用并存档` (apply + archive the conversation) and `丢弃` (discard) once a draft exists.
- The model says "我建议这样安排" / "草案已生成", not "已帮你写入日历".
- New events can be proposed directly. Moves require a reason. **Deletes must be confirmed in text first** — the model lists the targets and waits for `确认 / 好的 / 删吧` before calling `delete_event`. "Clear all" / "删除所有" follow the same rule.
- Simple unambiguous requests don't trigger re-asking. Inferable fields are defaulted from profile + common sense.
- The model asks back when a deadline task is missing a due date, when the update/delete target is ambiguous, or when other people are affected.

`repeat.frequency` defaults to `none`. Only explicit `每天 / 每周 / 每月 / daily / weekly / monthly` may set recurrence. `明天 / 下周三 / next Wednesday` are one-time date selectors. This rule is enforced by the global prompt; there is no runtime code guard, so if a model disobeys, the bad block lands in the draft preview and you discard it.

## Calendar block editing

Outlook-style fields: `date / day / start / end / category / kind / repeat / title / note`.

- `start` and `end` are minutes from midnight.
- Manual blocks use 5-minute precision; durations such as `20min` stay as 20 minutes.
- `category`: `deep, study, workout, admin, life, reflection, recovery, reward, rest`.
- `kind`: `fixed` (set time), `deadline` (work-backward), `spark` (optional/fill-in), `routine` (explicit recurrence), `general`.
- Hover copy is user-authored — the app does not invent it from the title.

Sleep windows earlier than wake time (e.g. sleep `00:10`, wake `08:00`) are treated as crossing midnight; slot search allows scheduling daytime hours instead of treating the day as closed at 00:10.

## Verification

```bash
npm run check               # node --check on the 5 core JS files
```

There is no offline regression script. Real chat behaviour must be tested by sending messages through the deployed app.
