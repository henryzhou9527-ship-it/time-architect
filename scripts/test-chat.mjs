/**
 * Real API chat test runner.
 * Calls the production /api/time-architect streaming endpoint with GPT-5.5,
 * collects responses, and logs structured test results.
 *
 * Usage: node scripts/test-chat.mjs
 *   TEST_LIMIT=3 node scripts/test-chat.mjs  (run only first N tests)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API_URL = process.env.TA_TEST_URL || 'https://time-architect-phi.vercel.app/api/time-architect';
const MODEL = 'gpt-5.5';
const BASE_URL = 'https://api.mcxhm.cn/v1';
const TIMEOUT_MS = 120000;

function httpsPost(body) {
  const id = `ta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tmpIn = path.join(os.tmpdir(), `${id}-in.json`);
  const tmpOut = path.join(os.tmpdir(), `${id}-out.txt`);
  const tmpScript = path.join(os.tmpdir(), `${id}.ps1`);
  try {
    fs.writeFileSync(tmpIn, JSON.stringify(body), 'utf8');
    const script = `
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
$inFile = '${tmpIn.replace(/'/g, "''")}'
$outFile = '${tmpOut.replace(/'/g, "''")}'
$jsonBody = [System.IO.File]::ReadAllText($inFile, [System.Text.Encoding]::UTF8)
try {
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
  $resp = Invoke-WebRequest -Uri '${API_URL}' -Method POST -ContentType 'application/json; charset=utf-8' -Body $bodyBytes -TimeoutSec ${Math.floor(TIMEOUT_MS / 1000)} -UseBasicParsing
  $obj = @{ status = [int]$resp.StatusCode; body = $resp.Content }
  $json = $obj | ConvertTo-Json -Depth 5 -Compress
  [System.IO.File]::WriteAllText($outFile, $json, [System.Text.Encoding]::UTF8)
} catch {
  $obj = @{ status = 0; body = $_.Exception.Message }
  $json = $obj | ConvertTo-Json -Depth 5 -Compress
  [System.IO.File]::WriteAllText($outFile, $json, [System.Text.Encoding]::UTF8)
}`;
    fs.writeFileSync(tmpScript, script, 'utf8');
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"`, {
      timeout: TIMEOUT_MS + 10000,
      stdio: 'pipe'
    });
    const raw = fs.readFileSync(tmpOut, 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw);
  } finally {
    for (const f of [tmpIn, tmpOut, tmpScript]) { try { fs.unlinkSync(f); } catch {} }
  }
}

const basePlan = {
  profile: {
    name: 'Henry',
    timezone: 'Asia/Shanghai',
    sleepWindow: '23:30-07:30',
    weeklyCapacityHours: 40,
    planningStyle: 'flexible',
    currentLifeStage: '大学生',
    energyPattern: {
      highFocusTime: '09:00-12:00',
      lowEnergyTime: '14:00-15:00',
      bestCreativeTime: '10:00-12:00',
      bestAdminTime: '15:00-17:00'
    },
    roles: ['学生', '开发者'],
    fixedCommitments: '周一三五 8:00-12:00 课程',
    commonFailureModes: ['晚上熬夜', '连续深度工作不休息']
  },
  weekStart: '2026-05-24',
  blocks: [
    { id: 'b1', title: '高数课', date: '2026-05-25', day: 1, start: 480, end: 600, category: 'study', kind: 'fixed' },
    { id: 'b2', title: '英语课', date: '2026-05-25', day: 1, start: 600, end: 720, category: 'study', kind: 'fixed' },
    { id: 'b3', title: '健身', date: '2026-05-26', day: 2, start: 1080, end: 1140, category: 'workout', kind: 'routine', repeat: { frequency: 'weekly', interval: 1 } },
    { id: 'b4', title: 'IELTS 写作练习', date: '2026-05-26', day: 2, start: 540, end: 630, category: 'study', kind: 'routine' },
    { id: 'b5', title: '项目开发', date: '2026-05-27', day: 3, start: 840, end: 960, category: 'deep', kind: 'deadline' },
    { id: 'b6', title: '午睡', date: '2026-05-25', day: 1, start: 780, end: 810, category: 'rest', kind: 'routine' },
  ],
  goals: [
    { id: 'g1', title: 'IELTS 7.5', status: 'active', deadline: '2026-08-01', weeklyTarget: '12h/week' },
    { id: 'g2', title: 'Time Architect v2 上线', status: 'active', deadline: '2026-06-15', weeklyTarget: '15h/week' },
  ],
  habits: { wake: 450, sleep: 1410 }
};

const globalPrompt = `你是 Time Architect，一个个人时间管理助手。用用户的语言自然地回复。

## 草案与确认
- 所有日历修改通过工具调用生成草案预览，用户确认后才写入
- 不要说"已帮你安排好""已写入日历"，应说"我建议这样安排"或"草案已生成"
- 新增事件：可以直接建议
- 移动已有事件：要说明原因
- 删除已有事件：绝不直接调用 delete_event。先用文字列出要删除的内容并询问确认，等用户回复"确认/好的/删吧"后才执行。"清空""删除所有"也必须先列出再确认

## 请求处理
- 简单明确的请求（有标题+日期+时间）直接用工具执行，不要反复确认
- 可推断的字段（时长、时段、重要性、是否可拆分）根据 profile 和常识默认
- 必须追问：deadline 任务没有截止日、要修改/删除的目标不明确、影响他人的信息不清
- 不要输出 JSON 或重复工具参数

## 排程智能
区分任务类型，使用不同策略：
- fixed：会议/约会，时间固定不可移动
- deadline：有截止日的任务，倒推安排，留缓冲
- routine：习惯/重复任务，保持节奏稳定
- spark：灵感/浮动任务，见缝插针
- general：普通任务，按优先级和精力安排

主动指出风险：计划太满、deadline 太近、休息不足、深度工作被碎片化打断、长期目标被紧急任务持续挤占。
保护用户的成长时间和健康习惯。尊重 profile 中的显性偏好。

## 解释与沟通
- 重要安排说明原因：为什么选这个时间、有什么风险、是否符合偏好
- 可以基于 [Blocks] 和 [Free slots] 检查冲突并提醒，但不要断言"绝对没冲突"
- 像一个有主见的助理，不是命令行工具

## 工具格式
- start/end = 从午夜起的分钟数（600=10:00, 810=13:30, 1440=24:00）
- date = YYYY-MM-DD
- category: deep, study, workout, admin, life, reflection, recovery, reward, rest
- kind: fixed, deadline, spark, routine, general
- repeat.frequency 默认 none，只有用户明确说"每天/每周/每月/daily/weekly/monthly"才设为对应值
- "明天""下周三"等日期词是一次性的，不是重复
- 修改/删除/移动已有日程时用 [Blocks] 里的 id

## 上下文
系统自动附带 [Profile]、[Blocks]、[Goals]、[Free slots] 等当前日历状态，直接引用即可。`;

async function callStreamingApi(message, conversationHistory = []) {
  const body = {
    stream: true,
    message,
    plan: { ...basePlan, blocks: basePlan.blocks.slice(0, 30), archives: undefined, reflections: undefined, memories: undefined },
    conversation: conversationHistory,
    roleHint: globalPrompt,
    user: 'test',
    clientConfig: { name: 'gpt-5.5', mode: 'chat', baseUrl: BASE_URL, model: MODEL, server: true }
  };

  try {
    const res = await httpsPost(body);
    if (res.status !== 200) {
      return { error: `HTTP ${res.status}: ${res.body.slice(0, 300)}`, text: '', toolCalls: [] };
    }

    let text = '';
    const toolCalls = [];
    let model = '';

    for (const block of res.body.split('\n\n')) {
      let eventType = '';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr = line.slice(6);
      }
      if (!dataStr) continue;
      try {
        const data = JSON.parse(dataStr);
        if (eventType === 'start') model = data.model || '';
        else if (eventType === 'delta') {
          if (data.type === 'text') text += data.content || '';
          else if (data.type === 'tool_call') toolCalls.push(data);
        } else if (eventType === 'error') {
          return { error: data.message, text, toolCalls, model };
        }
      } catch {}
    }

    return { text, toolCalls, model, error: null };
  } catch (err) {
    return { error: err.message, text: '', toolCalls: [] };
  }
}

function formatToolCalls(tcs) {
  if (!tcs.length) return '(none)';
  return tcs.map(tc => {
    const args = tc.args || {};
    if (tc.name === 'create_event') {
      return `+ create: "${args.title}" ${args.date || ''} ${minutesToTime(args.start)}-${minutesToTime(args.end)} [${args.category}/${args.kind}] repeat=${args.repeat?.frequency || 'none'}`;
    }
    if (tc.name === 'update_event') return `~ update: ${args.targetId} ${JSON.stringify(args)}`;
    if (tc.name === 'delete_event') return `- delete: ${args.targetId} reason=${args.reason || ''}`;
    if (tc.name === 'move_event') return `→ move: ${args.targetId} to ${args.date || ''} ${minutesToTime(args.start)}-${minutesToTime(args.end)}`;
    if (tc.name === 'resize_event') return `⇔ resize: ${args.targetId} end=${minutesToTime(args.end)}`;
    if (tc.name === 'create_goal') return `★ goal: "${args.title}"`;
    if (tc.name === 'update_profile') return `♻ profile: ${Object.keys(args).join(', ')}`;
    return `? ${tc.name}: ${JSON.stringify(args).slice(0, 120)}`;
  }).join('\n    ');
}

function minutesToTime(m) {
  if (m == null) return '?';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const tests = [
  { id: 1, input: '明天下午两点到四点写论文', expect: 'create_event title≈论文, date=tomorrow, start=840, end=960, study/deep, repeat=none', category: 'simple add' },
  { id: 2, input: 'add gym session tomorrow 6-7pm', expect: 'create_event title≈gym, start=1080, end=1140, workout, repeat=none', category: 'simple add (English)' },
  { id: 3, input: '删除午睡', expect: 'Ask confirmation before deleting b6. Text should not claim already deleted.', category: 'simple delete' },
  { id: 4, input: '把项目开发移到周四同一时间', expect: 'move_event targetId=b5 to Thu 2026-05-28, 840-960. Text explains.', category: 'simple move' },
  { id: 5, input: '你好呀', expect: 'Friendly text, NO tool calls.', category: 'casual chat' },
  { id: 6, input: '帮我安排每天早上的 IELTS 听力练习，30分钟', expect: 'create_event with repeat.frequency=daily, ~30min, morning.', category: 'recurring event' },
  { id: 7, input: '我下周三有个牙医预约，上午10点到11点', expect: 'create_event date=2026-05-27, start=600, end=660, fixed, repeat=none.', category: 'one-time appointment' },
  { id: 8, input: '我这周的安排是不是太满了？', expect: 'Text-only analysis. NO tool calls.', category: 'analysis / read-only' },
  { id: 9, input: '把 IELTS 写作练习从 45 分钟改成 1 小时', expect: 'resize_event or update_event on b4, end→660.', category: 'resize' },
  { id: 10, input: '今天感觉很累，帮我把剩下的安排调轻松一点', expect: 'Suggest lightening. NOT delete without confirm. Mention rest/recovery.', category: 'health / tired state' },
  { id: 11, input: '我需要在6月15号之前完成 Time Architect v2，目前进度大概40%，每天最多能投入3小时开发。帮我规划一下接下来三周的开发时间。', expect: 'Multiple blocks across weeks. Calculate remaining work. Flag if tight.', category: 'multi-week planning' },
  { id: 12, input: '周五下午有个重要面试，2点到3点半，帮我安排面试准备时间', expect: 'create_event for interview (fixed, 840-930) + prep blocks.', category: 'event + preparation' },
  { id: 13, input: '我想每周二和周四晚上跑步，每次40分钟，但不要太晚，最好在健身之前', expect: 'create_events for running, Tue+Thu, ~40min, before 18:00. repeat=weekly.', category: 'preference-aware scheduling' },
  { id: 14, input: '帮我把所有学习类的任务都挪到上午', expect: 'Identify study blocks, propose moves. Ask confirmation. Check conflicts.', category: 'batch operation' },
  { id: 15, input: '下周我要考试，IELTS和高数都有，帮我安排复习计划。IELTS考试在周六，高数考试在周五。', expect: 'Multiple study blocks. Prioritize by exam dates. Protect rest.', category: 'exam prep planning' },
  { id: 16, input: '每周一三五 8:00-12:00 我有课，不要在这个时间安排别的', expect: 'Acknowledge constraint. NOT create duplicates (b1/b2 exist).', category: 'constraint declaration' },
  { id: 17, input: '清空明天所有安排', expect: 'NOT blindly delete. List what would be removed. Ask confirmation.', category: 'dangerous bulk delete' },
  { id: 18, input: '加一个提醒：下周五之前交论文初稿', expect: 'create_event kind=deadline. Reasonable time. repeat=none.', category: 'deadline reminder' },
  { id: 19, input: '我最近总是跳过晚上的学习时间，能不能把学习都安排在上午？', expect: 'Acknowledge pattern. Suggest morning study. Check conflicts.', category: 'behavior-based adjustment' },
  { id: 20, input: '我是一个大三学生，主修计算机科学，辅修数学。目前在准备IELTS考试（目标7.5分，8月考试），同时在做一个个人项目Time Architect。\n我的作息是早上7:30起床，晚上23:30睡觉。周一三五上午8-12点有课。周二四下午2-4点有实验课。\n我喜欢上午做深度工作，下午做轻量任务，晚上用来放松或做一些创意性的工作。\n我每周健身3次（周二四六），每次1小时，通常在傍晚6-7点。\n我有一个坏习惯是经常熬夜赶deadline，然后第二天状态很差。\n我希望你帮我规划下周的完整时间表，包括学习、项目、健身、休息，要现实一点，不要把时间排太满。\n特别注意：\n- IELTS每天至少1小时（听力+写作交替）\n- 项目开发每天至少1.5小时\n- 周末要留出社交时间\n- 每天至少有30分钟的休息/冥想时间', expect: 'Complex full-week plan. Multiple create_events. Respect all constraints. Flag risks. Explain rationale.', category: 'complex full profile + week plan' },
];

async function runTest(test) {
  process.stdout.write(`\n${'═'.repeat(70)}\n`);
  process.stdout.write(`TEST ${test.id}: [${test.category}]\n`);
  process.stdout.write(`INPUT: ${test.input.slice(0, 120)}${test.input.length > 120 ? '...' : ''}\n`);
  process.stdout.write(`EXPECT: ${test.expect}\n`);
  process.stdout.write(`${'─'.repeat(70)}\n`);

  const start = Date.now();
  const result = await callStreamingApi(test.input);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.error) {
    process.stdout.write(`ERROR (${elapsed}s): ${result.error}\n`);
    return { ...test, status: 'ERROR', elapsed, error: result.error, text: result.text, toolCalls: result.toolCalls };
  }

  const textPreview = result.text.replace(/\n/g, ' ').slice(0, 300);
  process.stdout.write(`MODEL: ${result.model}\n`);
  process.stdout.write(`TEXT (${elapsed}s): ${textPreview}${result.text.length > 300 ? '...' : ''}\n`);
  if (result.toolCalls.length) {
    process.stdout.write(`TOOLS:\n    ${formatToolCalls(result.toolCalls)}\n`);
  } else {
    process.stdout.write(`TOOLS: (none)\n`);
  }

  const issues = [];
  const hasTools = result.toolCalls.length > 0;

  if (test.category === 'casual chat' && hasTools) issues.push('FAIL: casual chat produced tool calls');
  if (test.category.includes('read-only') && hasTools) issues.push('FAIL: read-only query produced tool calls');
  if (/已写入|已安排好|已帮你.*安排|已经.*加入/.test(result.text)) issues.push('FAIL: claimed direct write');
  if (test.category.includes('delete') && result.toolCalls.some(tc => tc.name === 'delete_event') && !/确认|确定|是否|要不要|确认删除/.test(result.text)) {
    issues.push('WARN: delete without asking confirmation');
  }
  if (test.category === 'one-time appointment') {
    const creates = result.toolCalls.filter(tc => tc.name === 'create_event');
    if (creates.some(tc => tc.args?.repeat?.frequency && tc.args.repeat.frequency !== 'none')) issues.push('FAIL: one-time got repeat');
  }
  if (test.id === 6) {
    const creates = result.toolCalls.filter(tc => tc.name === 'create_event');
    if (creates.length && !creates.some(tc => tc.args?.repeat?.frequency === 'daily')) issues.push('WARN: 每天 did not produce daily repeat');
  }
  if (test.category === 'dangerous bulk delete') {
    const deletes = result.toolCalls.filter(tc => tc.name === 'delete_event');
    if (deletes.length > 0 && !/确认|确定|是否|要不要/.test(result.text)) issues.push('FAIL: bulk delete without confirmation');
  }

  const status = issues.length ? (issues.some(i => i.startsWith('FAIL')) ? 'FAIL' : 'WARN') : 'PASS';
  if (issues.length) process.stdout.write(`ISSUES:\n    ${issues.join('\n    ')}\n`);
  process.stdout.write(`STATUS: ${status}\n`);

  return { ...test, status, elapsed, text: result.text, toolCalls: result.toolCalls, issues, model: result.model };
}

async function main() {
  console.log('Time Architect Chat Test Runner');
  console.log(`API: ${API_URL}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Tests: ${tests.length}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  const testIds = process.env.TEST_IDS ? process.env.TEST_IDS.split(',').map(Number) : null;
  const testLimit = parseInt(process.env.TEST_LIMIT || '0') || tests.length;
  const filtered = testIds ? tests.filter(t => testIds.includes(t.id)) : tests.slice(0, testLimit);
  const results = [];
  for (const test of filtered) {
    const result = await runTest(test);
    results.push(result);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('SUMMARY');
  console.log(`${'═'.repeat(70)}`);
  const pass = results.filter(r => r.status === 'PASS').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const err = results.filter(r => r.status === 'ERROR').length;
  console.log(`PASS: ${pass}  WARN: ${warn}  FAIL: ${fail}  ERROR: ${err}  TOTAL: ${results.length}\n`);

  for (const r of results) {
    const mark = r.status === 'PASS' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    console.log(`${mark} ${r.id}. [${r.category}] ${r.status} (${r.elapsed}s)`);
    if (r.issues?.length) for (const issue of r.issues) console.log(`    ${issue}`);
    if (r.error) console.log(`    ${r.error.slice(0, 150)}`);
  }
}

main().catch(console.error);
