/**
 * Offline frontend smoke + regression test.
 * Loads js/calendar-planner.js in a fake-DOM vm sandbox and exercises the
 * pure logic paths: fast path parsing, recurrence, tool application,
 * draft stats, overlap layout, mentions/council, rendering.
 *
 *   npm run test:ui
 */

import fs from 'node:fs';
import vm from 'node:vm';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear()
  };
}

const eventListeners = new Map();
function fakeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    cloneNode() { return fakeElement(tag); },
    insertAdjacentHTML() {},
    focus() {},
    blur() {},
    click() {},
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    value: '',
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 0,
    offsetHeight: 0
  };
  return el;
}

const elements = new Map();
const fakeDocument = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, fakeElement('div'));
    return elements.get(id);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener(name, fn) {
    if (!eventListeners.has(name)) eventListeners.set(name, []);
    eventListeners.get(name).push(fn);
  },
  removeEventListener() {},
  createElement(tag) { return fakeElement(tag); },
  createDocumentFragment() { return fakeElement('fragment'); },
  elementsFromPoint() { return []; },
  body: fakeElement('body'),
  head: fakeElement('head'),
  documentElement: fakeElement('html'),
  activeElement: null
};

const code = fs.readFileSync(new URL('../js/calendar-planner.js', import.meta.url), 'utf8');
const context = {
  console,
  Date,
  Intl,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  Map,
  JSON,
  RegExp,
  Error,
  Promise,
  TextEncoder,
  TextDecoder,
  AbortController,
  fetch: globalThis.fetch,
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  document: fakeDocument,
  navigator: { userAgent: 'node-smoke', language: 'zh-CN' },
  location: { hostname: 'localhost', protocol: 'http:', href: 'http://localhost:4175/' },
  history: { pushState() {}, replaceState() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  crypto: {
    getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = (i * 31 + 17) % 255; return arr; },
    randomUUID: () => `smoke-${Math.random().toString(16).slice(2)}`,
    subtle: {
      digest: async () => new ArrayBuffer(32),
      importKey: async () => ({}),
      deriveKey: async () => ({}),
      deriveBits: async () => new ArrayBuffer(32),
      encrypt: async () => new ArrayBuffer(16),
      decrypt: async () => new ArrayBuffer(16)
    }
  },
  btoa: v => Buffer.from(v, 'binary').toString('base64'),
  atob: v => Buffer.from(v, 'base64').toString('binary'),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  alert() {},
  confirm() { return true; },
  prompt() { return null; }
};
context.window = context;
context.globalThis = context;
context.self = context;

vm.createContext(context);

const failures = [];
function step(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => console.log(`PASS  ${name}`),
        err => { failures.push({ name, err }); console.log(`FAIL  ${name}: ${err?.message || err}`); }
      );
    }
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}: ${err?.message || err}`);
  }
}

await step('load module', () => {
  vm.runInContext(code, context, { filename: 'calendar-planner.js' });
});

if (failures.length) {
  console.log('\nLoad failure, aborting:');
  for (const f of failures) console.log(f.err?.stack || f.err);
  process.exit(1);
}

vm.runInContext(`
globalThis.__smoke = {
  buildTestPlan: calendarBuildTestPlan,
  cleanPlan: calendarCleanPlan,
  cleanBlock: calendarCleanBlock,
  setPlan(plan) { calendarPlan = plan; },
  getPlan() { return calendarPlan; },
  fastPath(note) { return calendarTryFastPath(note); },
  applyTools(tcs, base) { return calendarApplyToolCallsToPlan(tcs, base); },
  resolveStream(note) { return calendarResolveStreamConfig(note); },
  agentMentioned(note, agent) { return calendarAgentMentioned(note, agent); },
  allMentioned(note) { return calendarAllAgentsMentioned(note); },
  stripMentions(note) { return calendarStripAgentMentions(note); },
  normalizePrompts(raw) { return calendarNormalizeWorkflowPrompts(raw); },
  isLegacyDefault(text) { return calendarIsLegacyDefaultPrompt(text); },
  defaultPrompt: CALENDAR_DEFAULT_GLOBAL_PROMPT,
  apiStore() { return calendarLoadApiStore(); },
  weekStart() { return calendarWeekStart(new Date()); },
  layout(blocks) { return calendarLayoutDayBlocks(blocks); },
  occKey(b) { return calendarOccurrenceKey(b); },
  blocksForDay(plan, d) { return calendarBlocksForDay(plan, d); },
  draftStats(draft) { return calendarDraftPlanStats(draft); },
  meaningful(draft) { return calendarDraftHasMeaningfulChanges(draft); },
  contextBlocks(plan) { return calendarContextBlocks(plan); },
  repeatAllows(b, date, plan) { return calendarRepeatAllowsDate(b, date, plan); },
  cleanAgent(a) { return calendarCleanAgent(a); },
  profileForAgent(agent, store) { return calendarApiProfileForAgent(agent, store); },
  localNow() { return calendarLocalNowString(); },
  conf: { CALENDAR_WORKFLOW_PROMPT_VERSION }
};
`, context);

const s = context.__smoke;

step('workflow prompt version === 5', () => {
  if (s.conf.CALENDAR_WORKFLOW_PROMPT_VERSION !== 5) throw new Error(`got ${s.conf.CALENDAR_WORKFLOW_PROMPT_VERSION}`);
});

step('default prompt mentions goal tools and draft contract', () => {
  if (!s.defaultPrompt.includes('update_goal')) throw new Error('no update_goal in default prompt');
  if (!s.defaultPrompt.includes('草案')) throw new Error('no draft contract');
});

step('build empty plan via cleanPlan', () => {
  const plan = s.cleanPlan({ weekStart: '2026-06-07', blocks: [], goals: [] });
  s.setPlan(plan);
  if (!plan || typeof plan !== 'object') throw new Error('cleanPlan returned non-object');
  if (!Array.isArray(plan.agents) || plan.agents.length !== 0) throw new Error('expected no preset agents');
});

step('apiStore returns at least one profile', () => {
  const store = s.apiStore();
  if (!store?.profiles?.length) throw new Error('no profiles');
});

step('normalizePrompts migrates legacy v4 shape', () => {
  const p = s.normalizePrompts({ version: 4, orchestrator: 'old', common: 'old', deployment: 'old' });
  if (p.version !== 5) throw new Error(`expected v5, got ${p.version}`);
  if (!p.globalPrompt || p.globalPrompt.length < 100) throw new Error('expected default global prompt');
});

step('normalizePrompts upgrades stored copy of old default', () => {
  const oldDefault = '你是 Time Architect，一个个人时间管理助手。用用户的语言自然地回复。\n\n## 草案与确认\n- 旧版规则';
  const p = s.normalizePrompts({ version: 5, globalPrompt: oldDefault, agents: {} });
  if (!p.globalPrompt.includes('update_goal')) throw new Error('legacy default not upgraded');
});

step('normalizePrompts keeps user-customized prompt', () => {
  const custom = '我自己写的 prompt，不要动它';
  const p = s.normalizePrompts({ version: 5, globalPrompt: custom, agents: {} });
  if (p.globalPrompt !== custom) throw new Error('customized prompt was replaced');
});

// ── Fast path ──
step('fastPath: 明天 14:00 写周报 60min', () => {
  const r = s.fastPath('明天 14:00 写周报 60min');
  if (!r.hit) throw new Error(`miss: ${r.reason}`);
  if (r.event.start !== 840 || r.event.end !== 900) throw new Error(`time ${r.event.start}-${r.event.end}`);
  if (r.event.title !== '写周报') throw new Error(`title: ${r.event.title}`);
});

step('fastPath: 下周三 10am consulting', () => {
  const r = s.fastPath('下周三 10am consulting');
  if (!r.hit) throw new Error(`miss: ${r.reason}`);
  if (r.event.start !== 600) throw new Error(`start ${r.event.start}`);
  if (r.event.repeat.frequency !== 'none') throw new Error('should be one-time');
});

step('fastPath: 今天下午两点半到四点 改简历', () => {
  const r = s.fastPath('今天下午两点半到四点 改简历');
  if (!r.hit) throw new Error(`miss: ${r.reason}`);
  if (r.event.start !== 870 || r.event.end !== 960) throw new Error(`time ${r.event.start}-${r.event.end}`);
});

step('fastPath: 2026-07-01 9:00 dentist', () => {
  const r = s.fastPath('2026-07-01 9:00 dentist');
  if (!r.hit) throw new Error(`miss: ${r.reason}`);
  if (r.event.date !== '2026-07-01') throw new Error(`date ${r.event.date}`);
});

step('fastPath: next monday 14:30 1h IELTS writing', () => {
  const r = s.fastPath('next monday 14:30 1h IELTS writing');
  if (!r.hit) throw new Error(`miss: ${r.reason}`);
  if (r.event.end - r.event.start !== 60) throw new Error('1h duration');
});

step('fastPath: pure chat does not hit', () => {
  for (const text of ['你好', '帮我看看这周安排合理吗', '我最近好累']) {
    const r = s.fastPath(text);
    if (r?.hit) throw new Error(`false hit on: ${text}`);
  }
});

// ── Mentions & council ──
step('agentMentioned with @custom agent', () => {
  const agent = { key: 'custom', label: 'Custom', model: 'gpt-x' };
  if (s.agentMentioned('@Custom hello', agent) !== true) throw new Error('expected match');
  if (s.agentMentioned('plain hello', agent) !== false) throw new Error('expected no match');
});

step('@all / 会诊 trigger council detection', () => {
  for (const text of ['@all 评估一下我的周计划', '@全体 看看', '/council 这周怎么安排']) {
    if (!s.allMentioned(text)) throw new Error(`not detected: ${text}`);
  }
  if (s.allMentioned('帮我安排明天')) throw new Error('false positive');
});

step('stripMentions removes @-tags', () => {
  const out = s.stripMentions('@all do something');
  if (/@all/.test(out)) throw new Error(`@all not stripped: ${out}`);
});

// ── Agent → profile binding ──
step('apiProfileForAgent prefers explicit apiProfileId', () => {
  const store = {
    activeId: 'p1',
    profiles: [
      { id: 'p1', name: 'A', model: 'm1', apiKey: 'k' },
      { id: 'p2', name: 'B', model: 'm2', apiKey: 'k' }
    ]
  };
  const agent = s.cleanAgent({ key: 'x', label: 'X', apiProfileId: 'p2', modelId: 'm1' });
  if (agent.apiProfileId !== 'p2') throw new Error('cleanAgent dropped apiProfileId');
  const got = s.profileForAgent(agent, store);
  if (got.id !== 'p2') throw new Error(`expected p2, got ${got.id}`);
});

// ── Tool application ──
step('applyTools: create + update + delete event', () => {
  const base = s.cleanPlan({
    weekStart: '2026-06-07',
    blocks: [{ id: 'b1', title: 'X', date: '2026-06-10', day: 3, start: 600, end: 660, category: 'admin', kind: 'general' }]
  });
  let draft = s.applyTools([{ name: 'create_event', valid: true, args: { title: 'New', date: '2026-06-11', start: 700, end: 760 } }], base);
  if (draft.blocks.length !== 2) throw new Error('create failed');
  draft = s.applyTools([{ name: 'update_event', valid: true, args: { targetId: 'b1', title: 'Renamed' } }], base);
  if (draft.blocks[0].title !== 'Renamed') throw new Error('update failed');
  draft = s.applyTools([{ name: 'delete_event', valid: true, args: { targetId: 'b1' } }], base);
  if (draft.blocks.length !== 0) throw new Error('delete failed');
});

step('applyTools: goal create/update/delete', () => {
  const base = s.cleanPlan({ weekStart: '2026-06-07', goals: [{ id: 'g1', title: 'Old', status: 'active' }] });
  let draft = s.applyTools([{ name: 'update_goal', valid: true, args: { targetId: 'g1', title: 'NewTitle' } }], base);
  if (draft.goals[0].title !== 'NewTitle') throw new Error('update_goal failed');
  draft = s.applyTools([{ name: 'delete_goal', valid: true, args: { targetId: 'g1' } }], base);
  if (draft.goals.length !== 0) throw new Error('delete_goal failed');
  draft = s.applyTools([{ name: 'create_goal', valid: true, args: { title: 'G2' } }], base);
  if (draft.goals.length !== 2) throw new Error('create_goal failed');
});

// ── Draft stats / meaningful changes ──
step('draftStats counts block + goal + profile changes', () => {
  const base = s.cleanPlan({
    weekStart: '2026-06-07',
    blocks: [{ id: 'b1', title: 'X', date: '2026-06-10', day: 3, start: 600, end: 660, category: 'admin', kind: 'general' }],
    goals: [{ id: 'g1', title: 'G', status: 'active' }]
  });
  s.setPlan(base);
  const draft = s.applyTools([
    { name: 'create_event', valid: true, args: { title: 'N', date: '2026-06-11', start: 700, end: 760 } },
    { name: 'update_goal', valid: true, args: { targetId: 'g1', deadline: '2026-07-01' } },
    { name: 'update_profile', valid: true, args: { sleepWindow: '23:00-07:00' } }
  ], base);
  const stats = s.draftStats(draft);
  if (stats.added !== 1) throw new Error(`added ${stats.added}`);
  if (stats.goalsChanged !== 1) throw new Error(`goalsChanged ${stats.goalsChanged}`);
  if (!stats.profileChanged) throw new Error('profileChanged false');
  if (!s.meaningful(draft)) throw new Error('not meaningful');
});

step('profile-only draft counts as meaningful', () => {
  const base = s.cleanPlan({ weekStart: '2026-06-07' });
  s.setPlan(base);
  const draft = s.applyTools([{ name: 'update_profile', valid: true, args: { weeklyCapacityHours: 25 } }], base);
  if (!s.meaningful(draft)) throw new Error('profile-only change ignored');
});

step('no-op draft is not meaningful', () => {
  const base = s.cleanPlan({ weekStart: '2026-06-07', blocks: [], goals: [] });
  s.setPlan(base);
  const draft = s.applyTools([], base);
  if (s.meaningful(draft)) throw new Error('empty drafts must not be meaningful');
});

// ── Overlap layout ──
step('layout: non-overlapping blocks each get full width', () => {
  const layout = s.layout([
    { id: 'a', start: 600, end: 660 },
    { id: 'b', start: 660, end: 720 }
  ]);
  for (const v of layout.values()) {
    if (v.cols !== 1) throw new Error(`cols ${v.cols}`);
  }
});

step('layout: two overlapping blocks split into 2 columns', () => {
  const layout = s.layout([
    { id: 'a', start: 600, end: 700 },
    { id: 'b', start: 630, end: 720 }
  ]);
  const a = layout.get(s.occKey({ id: 'a' }));
  const b = layout.get(s.occKey({ id: 'b' }));
  if (a.cols !== 2 || b.cols !== 2) throw new Error('expected 2 cols');
  if (a.col === b.col) throw new Error('same column');
});

step('layout: chain overlap forms one cluster, reuses freed columns', () => {
  const layout = s.layout([
    { id: 'a', start: 600, end: 700 },
    { id: 'b', start: 650, end: 750 },
    { id: 'c', start: 710, end: 800 }
  ]);
  const c = layout.get(s.occKey({ id: 'c' }));
  if (c.col !== 0) throw new Error(`c should reuse col 0, got ${c.col}`);
  if (c.cols !== 2) throw new Error(`cluster width 2, got ${c.cols}`);
});

// ── Recurrence on client ──
step('repeatAllows: weekly occurrence shows on later weeks', () => {
  const plan = s.cleanPlan({ weekStart: '2026-06-07' });
  const block = s.cleanBlock({ id: 'r1', title: 'R', date: '2026-06-10', start: 600, end: 660, repeat: { frequency: 'weekly', interval: 1 } });
  if (!s.repeatAllows(block, '2026-06-17', plan)) throw new Error('next week missing');
  if (s.repeatAllows(block, '2026-06-16', plan)) throw new Error('wrong weekday hit');
});

// ── Context block relevance ──
step('contextBlocks keeps recurring + future, drops old one-time blocks', () => {
  const today = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const old = new Date(today); old.setDate(old.getDate() - 30);
  const future = new Date(today); future.setDate(future.getDate() + 2);
  const plan = s.cleanPlan({
    weekStart: s.weekStart(),
    blocks: [
      { id: 'old1', title: 'Old', date: fmt(old), start: 600, end: 660 },
      { id: 'fut1', title: 'Future', date: fmt(future), start: 600, end: 660 },
      { id: 'rec1', title: 'Rec', date: fmt(old), start: 700, end: 760, repeat: { frequency: 'daily', interval: 1 } }
    ]
  });
  const ids = s.contextBlocks(plan).map(b => b.id);
  if (ids.includes('old1')) throw new Error('stale one-time block kept');
  if (!ids.includes('fut1')) throw new Error('future block dropped');
  if (!ids.includes('rec1')) throw new Error('recurring block dropped');
});

step('localNow format', () => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.localNow())) throw new Error(s.localNow());
});

// ── Rendering ──
vm.runInContext(`
globalThis.__smoke.renderPages = function() {
  const out = {};
  out.workflow = calendarWorkflowPageHtml();
  out.settings = calendarMemoryInnerHtml();
  out.archive = calendarArchivePageHtml();
  out.profile = calendarProfileHtml();
  out.goals = calendarGoalsHtml();
  out.page = calendarPageContentHtml();
  out.sidebar = calendarSidebarHtml();
  out.mobileNav = calendarMobileNavHtml();
  out.chat = calendarChatPanelHtml();
  out.ribbon = calendarRibbonHtml();
  out.head = calendarCalendarHeadHtml();
  out.board = calendarBoardHtml();
  out.welcome = calendarChatWelcomeHtml();
  return out;
};
globalThis.__smoke.runFullRender = function() {
  calendarRender();
  return true;
};
globalThis.__smoke.testPlans = ['demo', 'student', 'fragmented'].map(id => calendarBuildTestPlan(id));
`, context);

let pages;
step('render all main pages', () => {
  pages = s.renderPages();
  for (const [name, html] of Object.entries(pages)) {
    if (typeof html !== 'string' || html.length < 20) throw new Error(`${name}: bad render`);
  }
});

step('calendarRender() executes without throwing', () => {
  s.runFullRender();
});

step('all three test-account plans build clean', () => {
  for (const plan of context.__smoke.testPlans) {
    if (!plan.blocks.length || !plan.goals.length) throw new Error('test plan empty');
  }
});

step('no rendered HTML references deleted functions', () => {
  const deletedNames = [
    'calendarBuildCoachUpdate', 'calendarClassifyUserIntent', 'calendarRequestRoute',
    'calendarAgentInstruction', 'calendarWebsiteKnowledgeBase', 'calendarApplyMultiGoalPlan',
    'calendarApplyReport', 'calendarBuildReportContent', 'calendarApplyLightMode',
    'calendarUserProfileView', 'calendarUserHealthView', 'calendarArrangementWhy',
    'calendarChallengeCurrentPlan', 'calendarLooksLikeLongProfileInput', 'calendarLooksLikeTired',
    'calendarFastModeIntent', 'calendarAgentKeyForIntentKey', 'calendarNormalizeRoute',
    'calendarCalendarEditContract', 'calendarApplyCalendarEditContractToPlan',
    'calendarRenderChatTargetPreview', 'calendarChatTargetPreviewHtml',
    'calendarConversationTargetPreview', 'calendarConversationTargetAgents', 'calendarAgentForIntent',
    'calendarApplyCoachNote', 'calendarCallArchitectApi', 'calendarCallAgentCouncil',
    'calendarCallArchitectApiWithConfig', 'calendarFetchArchitectApi', 'calendarCanUseArchitectApi',
    'calendarResolveAiRoute', 'calendarShouldUseAiRouter', 'calendarAgentCouncilSelection',
    'calendarFastModeConfig', 'calendarAgentCouncilRequested', 'calendarApplyUserIntent',
    'calendarApplyCommand', 'calendarCommandGuide', 'calendarApplyGoalCommand',
    'calendarApplyDeleteRequest', 'calendarApplyGenericPlan', 'calendarApplyAdjustmentPlan',
    'calendarHealthPlan', 'calendarHealthPlanCardHtml', 'calendarHealthStageHtml',
    'calendarAgentStackHtml', 'calendarTodayBlocks', 'calendarAnalyzePlan',
    'calendarPlanMetrics', 'calendarInsightsHtml', 'calendarSanityHtml',
    'calendarReflectionHtml', 'calendarManualHtml', 'calendarCoachHtml',
    'calendarArchitectIntroHtml', 'calendarInsertCommand',
    'calendarSwitchDefaultDialogueProfile', 'calendarSaveWorkflowPrompts', 'calendarResetWorkflowPrompt',
    'calendarClearReflections', 'calendarSaveProfileFromForm', 'calendarExportMemory',
    'calendarSetCalendarMode', 'calendarSetSlotSize', 'calendarFindFreeSlot',
    'calendarAddManualBlock',
    'calendarRefreshActivity', 'calendarRenderActivityParts', 'calendarRenderActualLayers',
    'calendarActivityHtml', 'calendarSelectBlock\\(', 'openWorld', 'calendarBuildCompactContext'
  ];
  const dangling = [];
  for (const [pageName, html] of Object.entries(pages)) {
    for (const fn of deletedNames) {
      const re = new RegExp('\\b' + fn.replace('\\(', '\\(') + '\\b');
      if (fn === 'calendarSelectBlock\\(') continue; // selection moved to mouseup handler; allow
      if (re.test(html)) dangling.push(pageName + ' -> ' + fn);
    }
  }
  if (dangling.length) throw new Error('dangling refs: ' + dangling.join(', '));
});

console.log('\n---');
console.log(failures.length ? `${failures.length} failures` : 'All UI smoke tests passed');
process.exit(failures.length ? 1 : 0);
