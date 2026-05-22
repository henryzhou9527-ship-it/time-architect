# Time Architect Agent Workflows

This document describes the verified workflow for the ten dialogue scenarios covered by `scripts/verify-scenarios.mjs`.

## Core Execution Model

Every user-facing chat turn follows the same visible sequence:

1. Router: classify the request and choose one agent.
2. Skill: inject the selected agent's built-in skill.
3. Context: send visible calendar context, current visible dialogue, siteKnowledge, and role instruction to `/api/time-architect`.
4. API Result: show which agent/profile succeeded or failed.
5. Output: either produce an applyable `calendar-draft` or return advice/report text without mutating the calendar.

Agent responsibilities:

- Planner / 主脑: goal contract, workload estimate, feasibility, planning strategy, and schedule proposal.
- Engineer / 工程: concrete calendar data execution for add/delete/move/reschedule requests, plus source-code implementation advice for UI/API/schema requests.
- Dialogue / 挑战: ordinary conversation, explanation, profile/health readout, help, and assumption challenge.
- Auditor / 审计: risk, overload, conflict, recovery, and sanity checks.

Important boundary:

- Calendar data edits can modify `plan.goals` / `plan.blocks` through `calendar-draft`.
- Source-code edits cannot be executed by the website chat agent. Engineer can advise on code there; actual repository edits happen through Codex/developer workflow.

## Scenario 1: Short Add / Delete

User examples:

```text
/goal 准备周五复盘报告 60分钟 周五截止
删除 PPT 草稿
帮我加入一个行程，周五 10:00-11:00 写 IELTS
```

Workflow:

1. Router reads the input.
2. If the input is `/goal ...`, Router classifies it as `planner` because it is goal/strategy creation.
3. If the input is natural-language calendar CRUD such as `删除 PPT 草稿` or `加入一个行程`, Router classifies it as `calendar-edit`.
4. `/goal` selects Planner with `Goal Contract + Calendar Draft Skill`.
5. Calendar CRUD selects Engineer with `Calendar Engineering Skill`.
6. Planner extracts goal, deadline, workload, baseline if present, and creates/updates GoalContract plus possible ScheduleBlock draft.
7. Engineer resolves the concrete block/event to add, delete, move, or reschedule; it edits `plan.blocks` and preserves unrelated manual blocks.
8. Output mode is `calendar-draft`; the draft only becomes real after the user applies it.
9. The chat trace must show selected agent, active skill, API profile, and whether a draft was created.

Feasibility evidence:

- `calendarFastModeIntent()` routes calendar CRUD to `calendar-edit`.
- `calendarAgentKeyForIntentKey()` maps `calendar-edit` to Engineer.
- `calendarRequestRoute()` sets `calendar-draft` when `intent.key === 'calendar-edit'`.
- `scripts/verify-scenarios.mjs` checks `/goal` adds a goal, delete confirms removal, and short delete routes to Engineer `calendar-draft`.

## Scenario 2: Long Profile Input

User example:

```text
我现在是考试冲刺期学生。每周可用 16 小时。睡眠 00:00-07:45。固定周一到周四下午上课，晚上学不进去，上午专注最好，最近低估复盘时间。
```

Workflow:

1. Router sees this is stable personal context, not a single event edit.
2. Planner is the correct conceptual owner because profile facts affect future planning, capacity, and feasibility.
3. Planner uses profile extraction behavior inside `Goal Contract + Calendar Draft Skill`, but should not blindly fill the week with tasks.
4. The system extracts:
   - weekly capacity,
   - sleep window,
   - fixed commitments,
   - high/low energy windows,
   - life stage,
   - common failure patterns such as underestimated review time.
5. Data writes go to `plan.profile`.
6. Existing blocks should not be changed just because the user described themselves.
7. Future Planner, Engineer, Dialogue, and Auditor calls all consume the updated profile through siteKnowledge/current plan context.

Feasibility evidence:

- `calendarLooksLikeLongProfileInput()` identifies long profile input when enough profile signals appear.
- `calendarApplyProfileSignals()` writes capacity, sleep, energy, commitments, life stage, health constraints, and failure patterns.
- Scenario 2 asserts `weeklyCapacityHours === 16`, `sleepWindow === '00:00-07:45'`, and visible `Profile updated` messages.

## Scenario 3: Long Multi-Goal Arrangement

User example:

```text
这周同时处理几个目标：
1. 周五前完成 Time Architect UI polish
2. 每天 IELTS 写作复盘 45 分钟
3. 周末整理一次健康和睡眠计划
```

Workflow:

1. Router detects a planning input, not a single calendar CRUD operation.
2. Planner is selected.
3. Planner uses `Goal Contract + Calendar Draft Skill`.
4. Planner splits bullets or parallel-goal phrases into separate goals.
5. For each goal, Planner creates a GoalContract with title, deadline if inferable, initial success criteria, estimated workload, risks, weekly target, and daily minimum.
6. Planner schedules minimum progress blocks instead of pretending every goal is fully solved.
7. Planner checks capacity and should surface missing baseline/deadline as low confidence.
8. Output is `calendar-draft`; the user can preview before applying.

Feasibility evidence:

- `calendarLooksLikeMultiGoalInput()` detects numbered/bulleted or connector-heavy multi-goal input.
- `calendarApplyMultiGoalPlan()` creates separate goals and minimum progress blocks.
- Scenario 3 asserts at least three goals and a visible `多目标安排` message.

## Scenario 4: Casual Chat

User example:

```text
你好
```

Workflow:

1. Router classifies the message as ordinary dialogue.
2. Dialogue agent is selected.
3. Dialogue uses `Dialogue + Challenge Skill`.
4. The ordinary dialogue API profile is user-settable; fallback is Gemini Challenger.
5. Dialogue reads the next block/current state if available and responds conversationally.
6. Dialogue must not mutate goals, blocks, archives, or profile.
7. Output mode is `dialogue-advice`.

Feasibility evidence:

- `calendarClassifyUserIntent()` returns `casual` for simple greetings.
- `calendarIntentIsReadOnly()` treats casual as read-only.
- Scenario 4 asserts block count stays unchanged and the reply says casual chat does not change the plan.

## Scenario 5: Summary Report

User example:

```text
/report 生成本周周报
```

Workflow:

1. Router recognizes `/report` or report/summary phrasing.
2. Dialogue/read-only reporting path is used; the key is not to reschedule the calendar.
3. The system builds report content from:
   - total planned time,
   - active goals,
   - workload ledger,
   - health plan,
   - today's blocks,
   - risk checks.
4. The report is written to `plan.archives`.
5. Output includes a confirmation and report body.
6. Blocks and goals should remain unchanged unless the report command explicitly asks for future planning.

Feasibility evidence:

- `calendarApplyReport()` creates archive content and calls `calendarAddArchive()`.
- `calendarBuildReportContent()` includes workload, health, today, and risk lines.
- Scenario 5 asserts an archive with type `weekly-report` exists and the message mentions `周报`.

## Scenario 6: User Challenge

User example:

```text
challenge 这个安排是不是太乐观了？
```

Workflow:

1. Router classifies the input as `challenge`.
2. Dialogue agent is selected because Gemini/Dialogue is the challenge role.
3. Dialogue uses `Dialogue + Challenge Skill`.
4. Dialogue reads current goals, workload, blocks, and analyzer results.
5. It challenges optimistic assumptions, unclear priority, missing recovery, or schedule risks.
6. It returns a critique and suggested re-check focus.
7. It does not change blocks automatically.

Feasibility evidence:

- `calendarFastModeIntent()` routes challenge terms to `challenge`.
- `calendarAgentKeyForIntentKey()` maps `challenge` to Dialogue.
- `calendarChallengeCurrentPlan()` returns challenge text based on active goals and analysis.
- Scenario 6 asserts block count is unchanged and the message starts with `Challenge 视角`.

## Scenario 7: User Asks Why

User example:

```text
/why 为什么这样安排？
```

Workflow:

1. Router recognizes `/why` or rationale phrasing.
2. Dialogue agent handles the explanation.
3. Dialogue uses `Dialogue + Challenge Skill`.
4. It reads active goals, workload ledger, today's ordered blocks, and risk checks.
5. It explains the schedule rather than changing it.
6. It should state which assumptions the user can challenge: priority, estimate, or unusable time window.
7. Output mode is `dialogue-advice`.

Feasibility evidence:

- `calendarClassifyUserIntent()` returns `why`.
- `calendarIntentIsReadOnly()` treats `/why` as read-only.
- `calendarArrangementWhy()` composes rationale from goals, capacity, today, and risk.
- Scenario 7 asserts block count is unchanged and output contains `为什么这样安排`.

## Scenario 8: Slash Command Usage / Routing Sanity

User example:

```text
/command
```

Workflow:

1. `calendarExtractCommand()` normalizes `/command` to `/commands`.
2. Router treats command help as Dialogue/read-only.
3. Dialogue uses siteKnowledge and command reference to explain what commands do and what each produces.
4. If Fast mode is on, ordinary command/help dialogue uses the user-selected ordinary dialogue profile.
5. Calendar CRUD examples in routing still go to Engineer `calendar-draft`.
6. Audit requests go to Auditor `review-advice`.
7. Source-code engineering requests go to Engineer `engineering-advice`.
8. The output lists `/goal`, `/health`, `/report`, and the other supported commands.

Feasibility evidence:

- Scenario 8 asserts `/command` aliases `/commands`.
- It asserts command/help routes to Dialogue advice.
- It asserts the ordinary dialogue model can be changed by user setting.
- It asserts audit routes to Auditor `review-advice`.
- It asserts source-code debug routes to Engineer `engineering-advice`.
- It asserts calendar CRUD routes to Engineer `calendar-draft`.
- It asserts Engineer skill exists in siteKnowledge and agentInstruction.

## Scenario 9: User Asks About Their Profile

User example:

```text
/profile
```

Workflow:

1. Router recognizes profile readout.
2. Dialogue agent is selected for user-facing explanation.
3. Dialogue uses `Dialogue + Challenge Skill`.
4. It reads `plan.profile`.
5. It summarizes life stage, roles, fixed commitments, weekly capacity, sleep window, energy pattern, failure modes, planning impact, and uncertainty.
6. It does not mutate the profile unless the user supplies a payload such as `/profile 记住：...`.
7. Output mode is `dialogue-advice`.

Feasibility evidence:

- `calendarClassifyUserIntent()` returns `profile-query` for `/profile` without payload.
- `calendarUserProfileView()` builds the readable interpretation.
- Scenario 9 asserts output contains `我目前这样看你的 Profile`.

## Scenario 10: User Asks About Health

User example:

```text
/health 我今天有点累
```

Workflow:

1. Router recognizes health/energy state.
2. If the user asks for health status only, Dialogue can explain it as read-only advice.
3. If tired-state phrasing is present, Router selects Engineer because light-mode is a concrete calendar execution.
4. Engineer uses `Calendar Engineering Skill` with `calendar-draft`.
5. It reads health plan, workload ledger, sleep window, recovery state, and today's deep/study blocks.
6. It returns a health risk judgment and adds/replaces a low-intensity continuity block through light-mode.
7. The draft only becomes real after the user applies it.
8. The goal is not to punish missed work or force a sprint; it protects recovery and keeps a minimal chain.

Feasibility evidence:

- `calendarClassifyUserIntent()` returns `health-query`.
- `calendarUserHealthView()` reports risk, sleep, recovery, workload, and high-cognition blocks.
- `calendarLooksLikeTired()` triggers `calendarApplyLightMode()`.
- Scenario 10 asserts health summary appears, tired-state light-mode appears, and tired health routes to Engineer `calendar-draft`.

## Current Feasibility Conclusion

The workflow is feasible under the current codebase if these gates pass:

```bash
node --check js/calendar-planner.js
node --check api/time-architect.js
node --check scripts/verify-scenarios.mjs
git diff --check
node scripts/verify-scenarios.mjs
```

The strongest verified contract is the scenario script. Any future change to routing, skills, profile extraction, command help, reports, health logic, or calendar CRUD must keep these ten checks passing.
