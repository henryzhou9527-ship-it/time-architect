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

If cloud decrypt fails, `calendarCloudSyncBlocked` must stay true until the next successful cloud load. Do not let a wrong-password local plan overwrite the encrypted cloud plan.

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

## Default Prompts

Default workflow prompts live in `calendarDefaultWorkflowPrompts()` and are versioned by `CALENDAR_WORKFLOW_PROMPT_VERSION`.

Version 2 is the principle-based prompt set supplied by the user:

- coordinator: single source of truth, goal backtracking, workload-first planning, feasibility honesty, real-user constraints, non-blaming recovery, executable time blocks, clear agent boundaries, minimum necessary calls, restrained state writes, audit-first checks, and disciplined user-facing output
- planner: Opus Planner owns final planning, estimates, feasibility, scheduling, feedback integration, and profile candidates
- dialogue: Gemini Challenger challenges assumptions, underestimated workload, real-world constraints, execution risk, priority errors, and over-commitment
- auditor: DeepSeek Auditor checks time legality, capacity, task clarity, workload, goal match, priority, recovery, feedback consistency, and output-risk problems
- engineer: GPT Engineer only handles architecture, schema, API, UI, workflow, model routing, validation, state management, and implementation concerns

Agent calls must send the selected role prompt via `agentInstruction`. Fast mode ordinary API calls must also infer and send one selected agent role, not just the coordinator prompt. Keep the prompt text out of normal visible plan context; send `workflowPromptVersion` instead. Existing unversioned workflow prompts are legacy and should migrate to the current defaults.

The Workflow settings page should expose the full original prompt text, including coordinator, 4 default agents, shared baseline, and deployment principles. Do not hide common/deployment sections from the UI. Dialogue controls must be generated from the current configured agent list so renamed or added agents update the visible `@...` buttons.

## Routing

Fast mode is enabled by default for normal natural-language input:

- engineering/code/UI/API/deploy/debug -> GPT engineer profile
- quick/light/small changes -> DeepSeek flash profile
- audit/risk/conflict/overload -> DeepSeek pro auditor profile
- challenge/blind spots/second opinion -> Gemini challenger profile
- default planning -> Claude planner profile

Full council is explicit. `/council`, "会诊", "全模型", "所有 agent", or `@all` runs the current configured agent set.

The UI council flow calls `/api/time-architect` once per selected agent/profile and adopts the best successful result. This prevents a single Vercel request from waiting on every model and hitting provider/serverless timeouts. The backend `council: true` path remains as compatibility, but the user-facing flow should use the batched front-end council.

Normal agent dialogue must follow the minimum necessary call rule. Without `@all`, council terms, or an explicit agent mention, select one agent/profile through Fast mode intent routing for that turn. Do not silently continue the previous turn's mentioned agent. Full-agent runs are opt-in.

## Agent Dialogue UX

The right chat panel is a current dialogue workspace:

- Default user messages stay in the current dialogue, but agent/profile routing is recalculated by Fast mode every turn.
- Local commands and read-only questions must answer immediately in chat when there is no explicit `@...` target or `/council`. `/command` is a supported alias for `/commands`; it must never wait on an external model call.
- The target preview above the composer must show the agent(s) and API profile(s) that will receive the next message.
- `@all` targets the current configured agent set.
- `@...` buttons come from Workflow agent labels, not hardcoded defaults.
- `@主脑`, `@挑战`, `@审计`, `@工程`, and custom configured labels target a single agent.
- `@工程` is a planning-system engineering advice agent. It does not directly edit code or deploy from inside the planner UI.
- Agent replies stay visible in the active dialogue until the user ends it.
- Agent-generated plans become an explicit draft preview on the calendar. Preview must not save.
- `应用并存档` archives the visible transcript as `discussion`, applies the latest proposed plan, saves, and opens a new blank dialogue.
- `丢弃` removes the draft and keeps the saved calendar unchanged.
- `新对话` starts fresh without saving the visible dialogue or draft.

Model context should stay lean. Send only the visible calendar plan context plus the current visible dialogue transcript. Do not include old archives, old reflections, hidden logs, or unrelated memory as normal planning context.

## Dialogue Scenario Validation

User-facing dialogue logic is validated against 10 scenario classes in `docs/scenario-validation.md` and `scripts/verify-scenarios.mjs`:

1. short add/modify/delete
2. long profile intake
3. long multi-goal arrangement
4. casual chat
5. summary report
6. user challenge
7. asking why an arrangement exists
8. every slash command's purpose/output/usage
9. asking how the system sees the user's profile
10. asking about health/recovery

The key rule is intent fidelity: a read-only question must not mutate the calendar, a profile intake must not become a random project task, a challenge must not silently rewrite the plan, and tired/health input should downgrade risk instead of pushing more deep work. Run `npm run verify:scenarios` after changes to routing, fallback planning, profile extraction, command handling, reports, health logic, or slot finding.

## Calendar Block UX

Manual/user-created calendar blocks use 5-minute precision. Do not force user-entered durations such as `20min` into 15-minute slots. Auto-planning may still search on 15-minute grid starts when useful, but stored block start/end values must preserve user-entered minutes. Natural-language duration changes should resize the selected block when one is selected.

When interpreting sleep boundaries, treat a sleep time earlier than wake time, such as `00:10` with wake `08:00`, as crossing midnight. Slot search should allow daytime scheduling until midnight instead of treating the day as closed at 00:10.

Hover text is user-authored. Do not derive hover copy from the title with generic action/output/fallback text. Hover may show title, time, category, goal, and the block note. The note can be entered through quick add, manual add, or the Edit button.

Keep calendar block typography compact enough for short blocks such as 20-minute events. Prefer uniformly smaller block text over special-case layout changes when the display is simply too crowded.

## API Profile Matching

Server profiles are discovered from `GET /api/time-architect`. Browser profiles merge with server profiles by model/name and role heuristics. Client requests send only the selected public profile fields unless the profile is BYOK, in which case the API key is sent to `/api/time-architect` for that request only.

When adding profiles, keep names and model ids stable so agent matching remains deterministic.
