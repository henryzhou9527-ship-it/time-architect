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
```

Do not commit real API keys.

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

### Fast mode and council mode

Fast mode is on by default. For ordinary natural-language input it chooses one API profile by intent:

- code/UI/API/deploy/debug -> `gpt-5.5`
- quick/light/small changes -> `deepseek-v4-flash`
- audit/risk/conflict/overload -> `deepseek-v4-pro`
- challenge/blind spots/second opinion -> `gemini-3.1-pro-preview`
- default planning -> `claude-opus-4-6-thinking`

Full agent council is explicit. Use `/council`, "会诊", "全模型", or "所有 agent" when the request should run all 4 agents. The browser sends one `/api/time-architect` request per agent/profile and then adopts the best successful agent result. This avoids the old single-request council path timing out on Vercel.

The backend still supports `council: true` for compatibility, but the normal UI uses the batched agent flow.
