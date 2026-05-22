# Time Architect

Standalone version of Time Architect from Henry's Room.

It is a goal-first time planning cockpit:

- daily focus and weekly 24/7 calendar
- task time prediction
- workload ledger
- health and recovery constraints
- API-only user-visible chat responses
- BYOK model settings, Fast mode routing, and optional agent council

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

The app is API-only for user-visible chat answers. If no server key or BYOK key is available, the UI must show the API problem instead of generating a fake local answer.

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

### Cross-device sync

`henry` and `admin` plans sync through `/api/settings`, backed by a private Vercel Blob store. The store is private and requires `BLOB_READ_WRITE_TOKEN` in Vercel.

When a local password account is active, the browser encrypts the plan before uploading it. The Blob record stores an AES-GCM envelope, not the plain calendar/archive JSON. A second device can share the same data by creating/logging into the same local username with the same password, then loading the cloud plan. If the cloud plan cannot be decrypted, cloud overwrite is blocked so a wrong password cannot replace the saved plan.

Test accounts stay local-only and do not sync.

### Agents vs models

Time Architect has **4 default agents**:

- `planner` / 主脑: final planning, estimates, health constraints
- `dialogue` / 挑战: second opinion, blind spots, alternatives
- `auditor` / 审计: conflict, overload, underestimation checks
- `engineer` / 工程: UI/code/API/schema/deploy changes

An **agent** is a workflow role. A **model/API profile** is the provider configuration that role calls: name, base URL, model id, and key source. Agents and models are intentionally separate:

- one agent can use one model profile
- several agents can share the same model profile
- one model family can expose multiple profiles, such as `deepseek-v4-pro` and `deepseek-v4-flash`

So the default system is 4 agents, not 5 agents. If 5 API profiles appear, the extra one is a model profile, not an extra agent.

### Default workflow prompts

The default workflow prompt set is versioned in `calendarDefaultWorkflowPrompts()` as `CALENDAR_WORKFLOW_PROMPT_VERSION`.

Version 2 is the principle-based multi-agent configuration:

- coordinator prompt: single source of truth, goal backtracking, workload-first planning, feasibility honesty, real-user constraints, non-blaming recovery, executable time blocks, agent boundaries, minimum necessary calls, restrained state updates, audit-first quality control, and user-facing output discipline
- Opus Planner: final planning, goal contracts, workload estimates, feasibility decisions, schedule design, feedback integration, and profile candidates
- Gemini Challenger: assumption review, workload challenge, reality constraints, execution risk, priority challenge, and alternative paths
- DeepSeek Auditor: time legality, capacity, task clarity, workload, goal match, priority, recovery, feedback consistency, and output-risk audits
- GPT Engineer: state architecture, schema, workflow, permissions, tool integration, validation, cost control, UI principles, and error handling
- shared baseline: no over-optimism, no over-scheduling, no abstract tasks, no ignored feedback, no sleep/recovery sacrifice, no unconfirmed long-term memory, no invented facts, and no impossible outcome promises

Agent calls send the selected role prompt through `agentInstruction`; the visible plan context only carries the prompt version to avoid duplicating long prompt text into every model payload. Fast mode also sends the inferred agent role, so ordinary API calls use the same default role prompts as agent dialogue. Existing unversioned workflow prompts are treated as legacy defaults and upgraded to version 2.

The Workflow settings page must show the full original prompt text, including the coordinator, all 4 default agents, shared baseline, and deployment principles. The lower editors split the same source into editable sections. If the user renames or adds agents, the dialogue UI must read the current configured agent list instead of hardcoding the default labels.

### Fast mode and council mode

Fast mode is on by default. The request router classifies the user message, selects the agent, and sends that agent a role-specific API instruction:

- code/UI/API/deploy/debug -> `gpt-5.5`
- quick/light/small changes -> `deepseek-v4-flash`
- audit/risk/conflict/overload -> `deepseek-v4-pro`
- challenge/blind spots/second opinion -> `gemini-3.1-pro-preview`
- default dialogue/read-only/help -> the user-selected ordinary dialogue API profile, falling back to `gemini-3.1-pro-preview`
- add/delete/move/reschedule calendar events -> planner calendar-draft route
- explicit planning commands such as `/goal`, `/estimate`, `/build-week`, and `/reflect` -> `claude-opus-4-6-thinking`

Router output modes:

- planner -> `calendar-draft`, can create an applyable draft
- dialogue -> `dialogue-advice`, answers and challenges without changing the calendar
- auditor -> `review-advice`, checks risk/overload/conflict without changing the calendar
- engineer -> `engineering-advice`, gives UI/API/schema/workflow implementation guidance without changing the calendar

The chat shows the workflow stages for every turn:

1. `Router`: request type, selected agent, output mode, whether calendar drafts are allowed.
2. `Skill`: which built-in agent skill is active.
3. `Context`: visible calendar context, current conversation, siteKnowledge, and role instruction sent to the API.
4. `API Result`: which agents succeeded or failed.
5. `Output`: whether the result became a calendar draft or advice-only reply.

Built-in agent skills are injected into `agentInstruction` and `siteKnowledge`. The engineer skill includes how to work with Time Architect calendar implementation: `js/calendar-planner.js` for state/render/router/calendar behavior, `api/time-architect.js` for API-only JSON calls and backend prompt rules, and `README.md`/`CLAUDE.md` for workflow documentation. In chat, engineer output remains `engineering-advice`; actual repository code edits happen through the Codex/developer workflow. Calendar data edits are different: user requests such as "加入一个行程" route to the planner as `calendar-draft` and can update the calendar after user application.

Full agent council is explicit. Use `/council`, "会诊", "全模型", "所有 agent", or `@all` when the request should run the current configured agent set. The browser sends one `/api/time-architect` request per selected agent/profile and then adopts the best successful agent result. This avoids the old single-request council path timing out on Vercel.

The backend still supports `council: true` for compatibility, but the normal UI uses the batched agent flow.

Normal agent dialogue follows the minimum necessary call rule: without `@all` or an explicit mention, the router selects one agent and one API profile by intent for that turn. Default dialogue/read-only/help questions route to the Dialogue agent, but the called model profile is user-settable from the chat model selector in Fast mode or the API settings panel's `普通对话默认` selector. Planning commands such as `/goal` and `/build-week`, plus natural-language calendar CRUD such as adding, deleting, moving, or rescheduling an event, route to the planner. Audit and engineering routes return advice only. It must not silently keep using the previous turn's mentioned agent. `@all` and council commands are the explicit full-agent path.

### Slash commands and scenario checks

The API prompt and site knowledge base define the main user-facing command paths:

- `/goal` creates or updates a Goal Contract and initial blocks
- `/estimate` explains workload-first estimation
- `/build-day`, `/build-week`, `/24-7` summarize or build day/week views
- `/reflect`, `/catch-up`, `/audit` handle feedback, recovery, and sanity checks
- `/why`, `/health`, `/profile`, `/report`, `/commands` answer read-only or summary requests without silently turning them into random calendar tasks; `/command` is an alias for `/commands`
- `/light-mode`, `/sprint`, `/council`, `/memory`, `/reset` handle risk mode, multi-agent runs, memory, and reset flows

Regression checks live in `scripts/verify-scenarios.mjs` and cover 10 user scenarios: short add/delete, long profile input, long multi-goal input, casual chat, report, challenge, asking why, command guide, profile view, and health view.

```bash
npm run verify:scenarios
```

### Agent dialogue sessions

The right-side chat is a reviewable agent dialogue, not a hidden one-shot planner.

- A normal task message stays in the current dialogue, but target selection is recalculated by Fast mode on every turn.
- Every visible reply goes through `/api/time-architect`. If the API is unavailable, show that failure instead of generating local-rule text.
- Each API request includes a compact site knowledge base covering pages, controls, commands, agent roles, data model, routing, and current UI state.
- The target preview above the input shows which agent(s) and profile(s) will receive the next message before sending.
- `@all` runs the current configured agent set, not only the 4 defaults.
- The `@...` buttons are generated from Workflow agents, so custom agent names appear in the chat controls.
- `@主脑`, `@挑战`, `@审计`, `@工程`, or a custom configured label routes the turn to one agent.
- `@工程` is an engineering advice agent inside the planner UI. It does not directly modify code or deploy by itself.
- Agent replies are shown in the current dialogue first. They are not written to the archive immediately.
- When an agent produces a draft plan, the calendar enters draft preview. Preview does not save.
- `应用并存档` saves the visible transcript as a `discussion` archive, applies the latest draft plan, and opens a fresh dialogue.
- `丢弃` removes the current draft and keeps the saved calendar unchanged.
- `新对话` discards the unsaved visible dialogue and draft, then starts over.

To save tokens, model calls receive the visible calendar context plus the current visible dialogue. Old archives, old reflections, and hidden logs are not sent back as planning context.

### Calendar block editing

User-created blocks support 5-minute precision, so durations such as `20min` stay as 20 minutes instead of being rounded to 15-minute slots. Dragging on the calendar snaps to 5-minute increments while the visible grid remains hourly. If a block is selected, natural-language adjustments such as changing it to `20min` resize that selected block.

Block hover text is user-authored. The app shows title, time, category, goal, and the block note; it does not invent hover copy from the title. Use the manual add form, quick-add note, or the Edit button to write the hover/备注 text.
