# Time Architect

Standalone version of Time Architect from Henry's Room.

It is a goal-first time planning cockpit:

- daily focus and weekly 24/7 calendar
- task time prediction
- workload ledger
- health and recovery constraints
- local fallback planning
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

The app works without a model key through local fallback.

For LLM planning, open the model drawer and paste your own API key. Keys are kept in browser localStorage and sent only to `/api/time-architect` for proxying.

Static GitHub Pages deployments do not execute `/api/time-architect`; they run the local fallback planner. Deploy to Vercel or another serverless host if you want the API proxy online.

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

The Workflow settings page must show the full original prompt text, including the coordinator, all 4 agents, shared baseline, and deployment principles. The lower editors split the same source into editable sections.

### Fast mode and council mode

Fast mode is on by default. For ordinary natural-language input it chooses one API profile by intent:

- code/UI/API/deploy/debug -> `gpt-5.5`
- quick/light/small changes -> `deepseek-v4-flash`
- audit/risk/conflict/overload -> `deepseek-v4-pro`
- challenge/blind spots/second opinion -> `gemini-3.1-pro-preview`
- default planning -> `claude-opus-4-6-thinking`

Full agent council is explicit. Use `/council`, "会诊", "全模型", or "所有 agent" when the request should run all 4 agents. The browser sends one `/api/time-architect` request per agent/profile and then adopts the best successful agent result. This avoids the old single-request council path timing out on Vercel.

The backend still supports `council: true` for compatibility, but the normal UI uses the batched agent flow.

Normal agent dialogue follows the minimum necessary call rule: without `@all` or an explicit mention, Fast mode selects one agent and one API profile by intent. `@all` and council commands are the explicit full-agent path.

### Agent dialogue sessions

The right-side chat is a reviewable agent dialogue, not a hidden one-shot planner.

- A normal task message starts or continues the current dialogue.
- `@all` runs the 4 default agents.
- `@主脑`, `@挑战`, `@审计`, or `@工程` routes the turn to one agent.
- Agent replies are shown in the current dialogue first. They are not written to the archive immediately.
- `存档结束` saves the visible transcript as a `discussion` archive, applies the latest draft plan, and opens a fresh dialogue.
- `新对话` discards the unsaved visible dialogue and starts over.

To save tokens, model calls receive the visible calendar context plus the current visible dialogue. Old archives, old reflections, and hidden logs are not sent back as planning context.

### Calendar block editing

User-created blocks support 5-minute precision, so durations such as `20min` stay as 20 minutes instead of being rounded to 15-minute slots. Dragging on the calendar snaps to 5-minute increments while the visible grid remains hourly. If a block is selected, natural-language adjustments such as changing it to `20min` resize that selected block.

Block hover text is user-authored. The app shows title, time, category, goal, and the block note; it does not invent hover copy from the title. Use the manual add form, quick-add note, or the Edit button to write the hover/备注 text.
