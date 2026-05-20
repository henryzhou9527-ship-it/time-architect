# Time Architect Maintenance Notes

## Operating Rule

Every functional change should update this file or `README.md` when it affects agent roles, model routing, API profile shape, deployment, login/test accounts, or user-facing workflow.

After code changes, sync immediately:

1. run `npm run check`
2. commit and push to GitHub
3. deploy production with `npx --yes vercel@latest deploy --prod -y`

Never commit real API keys. Keys belong in browser BYOK storage or Vercel environment variables.

## Cloud Sync

`/api/settings` is the cross-device settings endpoint. It stores `calendar_plan` for `henry` and `admin` in a private Vercel Blob store. The project must have `BLOB_READ_WRITE_TOKEN` configured in Vercel.

The browser sends encrypted cloud values when `calendarEncKey` is active:

- local plan: normal `calendarPlan`
- cloud value: `{ encrypted: true, algorithm: "AES-GCM", envelope }`
- the envelope is produced with the user's password-derived key

Do not change this back to plaintext sync. Test accounts are intentionally local-only.

## Agents vs Models

The product has 4 default agents:

- `planner` / 主脑: planning, estimates, final schedule decisions
- `dialogue` / 挑战: second opinion, blind spots, alternatives
- `auditor` / 审计: conflicts, overload, underestimation
- `engineer` / 工程: UI, code, API, schema, deploy tasks

An agent is a role. A model/API profile is the provider configuration used by that role. They are not the same thing.

Current default binding uses 4 different primary profiles:

- planner -> `claude-opus-4-6-thinking`
- dialogue -> `gemini-3.1-pro-preview`
- auditor -> `deepseek-v4-pro`
- engineer -> `gpt-5.5`

`deepseek-v4-flash` is an extra fast profile, not a fifth default agent. Multiple agents may share one profile, and one provider family may expose multiple profiles.

## Routing

Fast mode is enabled by default for normal natural-language input:

- engineering/code/UI/API/deploy/debug -> GPT engineer profile
- quick/light/small changes -> DeepSeek flash profile
- audit/risk/conflict/overload -> DeepSeek pro auditor profile
- challenge/blind spots/second opinion -> Gemini challenger profile
- default planning -> Claude planner profile

Full council is explicit. `/council`, "会诊", "全模型", or "所有 agent" runs the 4 product agents.

The UI council flow calls `/api/time-architect` once per selected agent/profile and adopts the best successful result. This prevents a single Vercel request from waiting on every model and hitting provider/serverless timeouts. The backend `council: true` path remains as compatibility, but the user-facing flow should use the batched front-end council.

## Agent Dialogue UX

The right chat panel is a current dialogue workspace:

- Default user messages continue the current dialogue.
- `@all` targets the 4 default agents.
- `@主脑`, `@挑战`, `@审计`, and `@工程` target a single agent.
- Agent replies stay visible in the active dialogue until the user ends it.
- `存档结束` archives the visible transcript as `discussion`, applies the latest proposed plan, saves, and opens a new blank dialogue.
- `新对话` starts fresh without saving the visible draft.

Model context should stay lean. Send only the visible calendar plan context plus the current visible dialogue transcript. Do not include old archives, old reflections, hidden logs, or unrelated memory as normal planning context.

## API Profile Matching

Server profiles are discovered from `GET /api/time-architect`. Browser profiles merge with server profiles by model/name and role heuristics. Client requests send only the selected public profile fields unless the profile is BYOK, in which case the API key is sent to `/api/time-architect` for that request only.

When adding profiles, keep names and model ids stable so agent matching remains deterministic.
