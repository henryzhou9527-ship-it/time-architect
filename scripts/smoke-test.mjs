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
  body: fakeElement('body'),
  head: fakeElement('head'),
  documentElement: fakeElement('html')
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

// Expose helpers
vm.runInContext(`
globalThis.__smoke = {
  buildPlan: typeof calendarBuildTestPlan === 'function' ? calendarBuildTestPlan : null,
  cleanPlan: typeof calendarCleanPlan === 'function' ? calendarCleanPlan : null,
  setPlan(plan) { calendarPlan = plan; },
  getPlan() { return calendarPlan; },
  fastPath(note) { return calendarTryFastPath(note); },
  applyTools(tcs, base) { return calendarApplyToolCallsToPlan(tcs, base); },
  buildContext() { return calendarBuildCompactContext ? calendarBuildCompactContext() : 'n/a'; },
  resolveStream(note) { return calendarResolveStreamConfig(note); },
  agentMentioned(note, agent) { return calendarAgentMentioned(note, agent); },
  stripMentions(note) { return calendarStripAgentMentions(note); },
  defaultWorkflowPrompts() { return calendarDefaultWorkflowPrompts ? calendarDefaultWorkflowPrompts() : null; },
  normalizePrompts(raw) { return calendarNormalizeWorkflowPrompts(raw); },
  apiStore() { return calendarLoadApiStore(); },
  weekStart() { return calendarWeekStart(new Date()); },
  conf: { CALENDAR_AGENT_ROLES, CALENDAR_WORKFLOW_PROMPT_VERSION, CALENDAR_DEFAULT_GLOBAL_PROMPT_LEN: (CALENDAR_DEFAULT_GLOBAL_PROMPT || '').length }
};
`, context);

const s = context.__smoke;

step('CALENDAR_AGENT_ROLES is empty', () => {
  if (!Array.isArray(s.conf.CALENDAR_AGENT_ROLES) || s.conf.CALENDAR_AGENT_ROLES.length !== 0) {
    throw new Error(`expected [], got ${JSON.stringify(s.conf.CALENDAR_AGENT_ROLES)}`);
  }
});

step('CALENDAR_WORKFLOW_PROMPT_VERSION === 5', () => {
  if (s.conf.CALENDAR_WORKFLOW_PROMPT_VERSION !== 5) {
    throw new Error(`expected 5, got ${s.conf.CALENDAR_WORKFLOW_PROMPT_VERSION}`);
  }
});

step('CALENDAR_DEFAULT_GLOBAL_PROMPT non-trivial', () => {
  if (!s.conf.CALENDAR_DEFAULT_GLOBAL_PROMPT_LEN || s.conf.CALENDAR_DEFAULT_GLOBAL_PROMPT_LEN < 500) {
    throw new Error(`prompt too short: ${s.conf.CALENDAR_DEFAULT_GLOBAL_PROMPT_LEN}`);
  }
});

step('build empty plan via cleanPlan', () => {
  if (typeof s.cleanPlan !== 'function') throw new Error('cleanPlan missing');
  const plan = s.cleanPlan({ weekStart: '2026-05-25', blocks: [], goals: [] });
  s.setPlan(plan);
  if (!plan || typeof plan !== 'object') throw new Error('cleanPlan returned non-object');
});

step('apiStore returns at least one profile', () => {
  const store = s.apiStore();
  if (!store?.profiles?.length) throw new Error('no profiles');
});

step('normalizePrompts handles empty input', () => {
  const p = s.normalizePrompts({});
  if (typeof p.globalPrompt !== 'string') throw new Error('no globalPrompt field');
  if (typeof p.agents !== 'object') throw new Error('no agents field');
});

step('normalizePrompts migrates legacy v4 shape', () => {
  const p = s.normalizePrompts({ version: 4, orchestrator: 'old', common: 'old', deployment: 'old' });
  if (p.version !== 5) throw new Error(`expected migrated to v5, got ${p.version}`);
  if (!p.globalPrompt || p.globalPrompt.length < 100) throw new Error('expected default global prompt on migration');
});

step('fastPath: 明天 14:00 写周报', () => {
  const r = s.fastPath('明天 14:00 写周报 60min');
  if (!r) throw new Error('null result');
  if (!r.hit) throw new Error(`expected hit, got reason: ${r.reason}`);
  if (!r.event?.title) throw new Error('no title');
  if (typeof r.event.start !== 'number' || typeof r.event.end !== 'number') throw new Error('missing start/end');
});

step('fastPath: 下周三 10am consulting', () => {
  const r = s.fastPath('下周三 10am consulting');
  if (!r) throw new Error('null result');
  if (!r.hit) throw new Error(`expected hit, got reason: ${r.reason}`);
});

step('fastPath: pure chat does not hit', () => {
  const r = s.fastPath('你好');
  if (r?.hit) throw new Error('expected miss for "你好"');
});

step('agentMentioned with @custom agent', () => {
  const agent = { key: 'custom', label: 'Custom', model: 'gpt-x' };
  if (s.agentMentioned('@Custom hello', agent) !== true) throw new Error('expected mention match');
  if (s.agentMentioned('plain hello', agent) !== false) throw new Error('expected no match');
});

step('stripMentions removes @-tags', () => {
  const out = s.stripMentions('@all do something');
  if (/@all/.test(out)) throw new Error(`@all not stripped: ${out}`);
});

step('resolveStream returns profile and roleHint', () => {
  const cfg = s.resolveStream('hello');
  if (!cfg?.profile) throw new Error('no profile');
  if (typeof cfg.roleHint !== 'string') throw new Error('no roleHint string');
});

step('applyTools(create_event) yields a new block', () => {
  const before = s.cleanPlan({ weekStart: '2026-05-25', blocks: [], goals: [] });
  const draft = s.applyTools([{
    name: 'create_event',
    valid: true,
    args: { title: 'Smoke', date: '2026-05-26', day: 2, start: 600, end: 660, category: 'admin', kind: 'general' }
  }], before);
  if (!draft.blocks.length) throw new Error('no block created');
  if (draft.blocks[0].title !== 'Smoke') throw new Error(`wrong title: ${draft.blocks[0].title}`);
});

step('applyTools(delete_event) removes block', () => {
  const base = s.cleanPlan({
    weekStart: '2026-05-25',
    blocks: [{ id: 'b1', title: 'X', date: '2026-05-26', day: 2, start: 600, end: 660, category: 'admin', kind: 'general' }]
  });
  const draft = s.applyTools([{ name: 'delete_event', valid: true, args: { targetId: 'b1' } }], base);
  if (draft.blocks.length !== 0) throw new Error(`expected 0 blocks, got ${draft.blocks.length}`);
});

step('buildCompactContext does not throw on minimal plan', () => {
  s.setPlan(s.cleanPlan({ weekStart: '2026-05-25', blocks: [], goals: [], profile: {} }));
  const ctx = s.buildContext();
  if (typeof ctx !== 'string') throw new Error('expected string context');
});

// HTML rendering paths — these build the actual pages.
// If any onclick="calendarXxx(...)" inside the templates points to a deleted function,
// it won't throw here (it's just a string), but we can grep for dead references afterwards.
vm.runInContext(`
globalThis.__smoke.renderPages = function() {
  const out = {};
  out.workflow = typeof calendarWorkflowPageHtml === 'function' ? calendarWorkflowPageHtml() : 'missing';
  out.settings = typeof calendarMemoryInnerHtml === 'function' ? calendarMemoryInnerHtml() : 'missing';
  out.archive = typeof calendarArchivePageHtml === 'function' ? calendarArchivePageHtml() : 'missing';
  out.profile = typeof calendarProfileHtml === 'function' ? calendarProfileHtml() : 'missing';
  out.goals = typeof calendarGoalsHtml === 'function' ? calendarGoalsHtml() : 'missing';
  out.page = typeof calendarPageContentHtml === 'function' ? calendarPageContentHtml() : 'missing';
  out.sidebar = typeof calendarSidebarHtml === 'function' ? calendarSidebarHtml() : 'missing';
  out.chat = typeof calendarChatPanelHtml === 'function' ? calendarChatPanelHtml() : 'missing';
  out.ribbon = typeof calendarRibbonHtml === 'function' ? calendarRibbonHtml() : 'missing';
  out.head = typeof calendarCalendarHeadHtml === 'function' ? calendarCalendarHeadHtml() : 'missing';
  out.board = typeof calendarBoardHtml === 'function' ? calendarBoardHtml() : 'missing';
  return out;
};
globalThis.__smoke.runFullRender = function() {
  if (typeof calendarRender !== 'function') throw new Error('calendarRender missing');
  calendarRender();
  return true;
};
`, context);

let pages;
step('render all main pages', () => {
  pages = s.renderPages();
  for (const [name, html] of Object.entries(pages)) {
    if (typeof html !== 'string') throw new Error(`${name}: not a string`);
    if (html === 'missing') throw new Error(`${name}: render function missing`);
    if (html.length < 20) throw new Error(`${name}: suspiciously short (${html.length} chars)`);
  }
});

step('calendarRender() executes without throwing', () => {
  s.runFullRender();
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
    'calendarAddManualBlock'
  ];
  const dangling = [];
  for (const [pageName, html] of Object.entries(pages)) {
    for (const fn of deletedNames) {
      const re = new RegExp('\\b' + fn + '\\b');
      if (re.test(html)) dangling.push(pageName + ' -> ' + fn);
    }
  }
  if (dangling.length) throw new Error('dangling refs: ' + dangling.join(', '));
});

console.log('\n---');
console.log(failures.length ? `${failures.length} failures` : 'All checks passed');
process.exit(failures.length ? 1 : 0);
