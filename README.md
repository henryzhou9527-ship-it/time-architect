# Time Architect

Standalone version of Time Architect from Henry's Room.

It is a goal-first time planning cockpit:

- daily focus and weekly 24/7 calendar
- task time prediction
- workload ledger
- health and recovery constraints
- local fallback planning
- BYOK model settings and optional model council

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
TIME_ARCHITECT_BASE_URL
TIME_ARCHITECT_MODEL
TIME_ARCHITECT_API_MODE
OPENAI_API_KEY
```

Do not commit real API keys.
