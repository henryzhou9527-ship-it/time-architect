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

## Model API

The app works without a model key through local fallback.

For LLM planning, open the model drawer and paste your own API key. Keys are kept in browser localStorage and sent only to `/api/time-architect` for proxying.

Server environment variables are optional:

```text
TIME_ARCHITECT_API_KEY
TIME_ARCHITECT_BASE_URL
TIME_ARCHITECT_MODEL
TIME_ARCHITECT_API_MODE
OPENAI_API_KEY
```

Do not commit real API keys.
