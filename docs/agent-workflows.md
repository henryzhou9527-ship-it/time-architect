# Time Architect Chat Workflow

本文描述一条用户消息如何变成日历草案（2026-06 大改版后的现状）。聊天管线 = 本地 Fast Path + 单 Agent 流式 + @all 会诊，三条路径共用同一个草案生成器。

## 调度入口

每条消息进入 `calendarRunAgentConversationTurn(note)`（js/calendar-planner.js），按序判定：

1. **会诊**：`calendarAllAgentsMentioned` 命中（`@all` / `@agents` / `@全体` / `/council` / "会诊" 等）→ `calendarRunCouncilTurn`。
2. **Fast Path**：Fast 开关开 + 无 `@` 提及 → `calendarTryFastPath`。
3. **单 Agent 流式**：其余全部。

用户始终看到：气泡标签（`Fast · local` 或 Agent 名 + 模型）、流式正文、工具卡片、以及日历上的草案预览（`应用并存档` / `丢弃`）。

## Path 1: Fast Path（本地，无 LLM）

解析中英文日期（今天/明天/后天/大后天/下(下)周X/周X/next monday/5月24号/5.24/May 24/2026-05-27）、时间（14:00 / 2pm / 下午两点半 / 10-11点 / 14:00到16:00）、时长（60min / 1h / 半小时 / 45 分钟），剩余文本为标题，并按关键词推断分类。置信度 ≥ 0.8 → 本地合成 `create_event` → 草案预览。低置信度自动落入流式路径。

## Path 2: 单 Agent 流式

### 请求（`calendarStreamChatRequest`）

```json
{
  "stream": true,
  "message": "<去掉@提及的消息>",
  "clientNow": "2026-06-10T23:45",
  "plan": { "blocks": "calendarContextBlocks(): 重复+近期/未来, ≤40, 按日期排序", "...": "无 archives/reflections/memories" },
  "conversation": "[最近10轮，不含当前这条（服务端只追加一次）]",
  "roleHint": "globalPrompt(\n\nagentPrompt)",
  "user": "<用户名或 public>",
  "clientConfig | clientConfigs": "..."
}
```

`clientNow` 是**用户本地挂钟时间**——服务器无时区，`[Today]` 与空闲时段全部以它为准。

### 服务端组装（api/time-architect.js）

- `compactSystemPrompt(roleHint)` 原样返回 roleHint，无隐藏角色注入。
- `buildCompactContext(plan, clientNow)` 产出 `[Profile]`（habits 经 `parseTimeOfDay` 解析 `"08:00"` 字符串；睡眠≤起床标注 past midnight）、`[Today]`、`[Blocks]`、`[Goals]`、`[Free slots next 7 days]`（`blockOccursOnDate` 展开 daily/weekly/monthly 重复；跨午夜睡眠时当天排程窗口开放到 24:00）。
- `buildStreamMessages` 强制 user/assistant 严格交替，且**当前消息只出现一次**（即使旧客户端把它也塞进了 conversation）。

### 流式与校验

`streamOpenAIProvider` / `streamAnthropicProvider` 发 `delta` 事件：`text` 进气泡，`tool_call` 在 flush 时经 `validateToolCall({blocks, goals}, 'all', userMessage)` 校验。允许的工具：

`create_event · update_event · delete_event · move_event · resize_event · create_goal · update_goal · delete_goal · update_profile`

`respond_text` / `propose_memory` 不发给模型——模型用自然文本说话。

**运行时硬校验**（api/_shared/validation.js）：目标/事件 targetId 必须存在；时间范围合法；`applyRecurrenceGuard` 在用户消息没有"每天/每周/每月/daily/weekly/monthly/every…"字样时，把模型擅自设置的 `repeat.frequency` 强制改回 `none`。

### 草案

流结束后 `calendarBuildDraftFromToolCalls` → `calendarApplyToolCallsToPlan` → `calendarDraftPlanStats`（分别 diff blocks/goals/profile，目标或资料单独变化也算有效草案）→ 预览模式。预览期间日历只读（不可拖拽/编辑）。

## Path 3: @all 会诊（已实现）

`calendarRunCouncilTurn`：

1. 没有配置 Agent → 系统消息引导去 Flow 页创建，不调模型。
2. 否则按 Flow 页顺序逐个发言。每位 Agent 的 roleHint = `globalPrompt + 该agent prompt + [会诊] 你是第 i/n 位…`；前面 Agent 的发言以 `[名字] 正文` 形式出现在对话历史中，可以补充或反驳。
3. 所有 Agent 的工具调用**合并成一份草案**（提示词要求避免重复创建相同事件）。
4. 停止按钮中断当前 Agent 并跳过剩余；已收集的工具调用仍会合并。

## 工作流页（Flow）

- 全局 prompt（不可删除；留空用内置默认 `CALENDAR_DEFAULT_GLOBAL_PROMPT`；旧版内置默认的存档副本会被自动升级，自定义内容不动）。
- Agent 卡片：名称 + API 配置绑定（`apiProfileId` 持久化，按 id 精确解析）+ 专属 prompt。
- `plan.workflowPrompts.version = 5`；v4 旧结构（orchestrator/common/deployment）加载时迁移。

## 块结构

```
{ id, title, date, day, start, end, category, kind, repeat, goalId,
  note, exactAction, output, ifInterrupted, ifFinishedEarly, status, source }
```

`start/end` 为午夜起分钟数（最小 5 分钟）；`category`: deep/study/workout/admin/life/reflection/recovery/reward/rest；`kind`: fixed/deadline/spark/routine/general（routine 需显式重复语言）；`repeat`: `{frequency, interval, count?, until?}` 默认 none。

## 验证

```bash
npm test          # 全部离线：语法 + API 单测 + UI 冒烟（含假 SSE 的流式/会诊端到端）
npm run test:chat # 可选在线 20 场景回归（TA_TEST_URL 指定环境）
```
