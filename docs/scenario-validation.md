# Time Architect Scenario Validation

This matrix tracks the user-facing acceptance checks for the major dialogue modes. Each scenario is judged by what a user would naturally expect to see, what the system used to produce, and what the current verified behavior produces.

Run:

```bash
node scripts/verify-scenarios.mjs
```

## 1. Short Modify / Add / Delete

- User expects: a short request such as "add X" or "delete PPT draft" changes the concrete block or goal and confirms exactly what changed.
- Previous mismatch: add requests could become generic planning; delete required manual selection and gave no natural-language fallback.
- Current behavior: `/goal ...` creates a Goal Contract and blocks; delete text removes the selected or title-matched block and says what was removed.
- Evidence: `PASS 1 short add/delete`.

## 2. Long Profile Input

- User expects: long self-description updates stable profile facts, not a random task list.
- Previous mismatch: only a few signals such as weekly capacity and "evening is bad" were recognized.
- Current behavior: extracts weekly capacity, sleep window, energy windows, fixed commitments, life stage, health/recovery constraints, and failure patterns.
- Evidence: `PASS 2 long profile input`.

## 3. Long Multi-Goal Arrangement

- User expects: multiple goals are separated, prioritized, and given minimum progress blocks without pretending the whole plan is solved.
- Previous mismatch: the input could collapse into one generic project goal, or fail to schedule because overnight sleep like `00:10` made the day appear closed.
- Current behavior: splits bullet/paragraph goals, creates separate Goal Contracts, schedules minimum progress blocks, and treats cross-midnight sleep as usable daytime until midnight.
- Evidence: `PASS 3 long multi-goal arrangement`.

## 4. Casual Chat

- User expects: casual messages should not mutate the calendar.
- Previous mismatch: a casual greeting could fall into generic planning and add daily reflection blocks.
- Current behavior: casual chat returns status and next-action guidance without changing blocks.
- Evidence: `PASS 4 casual chat`.

## 5. Summary Report

- User expects: a report request creates a readable summary and archives it.
- Previous mismatch: report archive types existed, but there was no explicit local report command path.
- Current behavior: `/report` creates daily/weekly/monthly report content and stores an archive record.
- Evidence: `PASS 5 summary report`.

## 6. User Challenge

- User expects: a challenge should question assumptions without silently rewriting the plan.
- Previous mismatch: challenge language could become another planning request.
- Current behavior: challenge mode returns risks, assumptions, and suggested re-check focus without changing blocks.
- Evidence: `PASS 6 user challenge`.

## 7. User Asks Why

- User expects: a rationale based on goals, capacity, health, and risk.
- Previous mismatch: "why" questions could create or adjust tasks instead of explaining.
- Current behavior: `/why` explains arrangement rationale and does not mutate the calendar.
- Evidence: `PASS 7 asks why`.

## 8. Slash Command Usage

- User expects: every command says what it produces and when to use it.
- Previous mismatch: commands were visible but not fully explained as outputs and user workflows.
- Current behavior: `/commands` lists command purpose, output, and practical usage. `/command` is a supported alias and is handled locally in the right chat panel instead of waiting on an agent call.
- Evidence: `PASS 8 slash command guide`.

## 9. User Asks About Their Profile

- User expects: a human-readable interpretation of how the system sees them, with uncertainty.
- Previous mismatch: profile existed mostly as editable fields/JSON.
- Current behavior: `/profile` with no payload summarizes life stage, roles, constraints, capacity, sleep, energy, failure modes, planning impact, and unknowns.
- Evidence: `PASS 9 asks profile view`.

## 10. User Asks About Health

- User expects: sleep/recovery/load risk and a clear recommendation; if tired, downgrade the plan.
- Previous mismatch: health was only a card, not a dialogue answer; tired input did not always trigger a safer mode.
- Current behavior: `/health` summarizes risk, sleep, recovery, load, and high-cognition count; tired phrasing also applies light-mode.
- Evidence: `PASS 10 asks health`.

## Current Quality Gate

All ten scenarios must keep passing before shipping changes to dialogue routing, fallback planning, profile extraction, command handling, health/report logic, or schedule slot selection.
