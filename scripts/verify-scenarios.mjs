import fs from 'node:fs';
import vm from 'node:vm';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    clear: () => map.clear()
  };
}

function loadHarness() {
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
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      createElement: () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {} })
    },
    window: {},
    navigator: {},
    crypto: {
      getRandomValues(array) {
        for (let i = 0; i < array.length; i += 1) array[i] = (i * 31 + 17) % 255;
        return array;
      },
      randomUUID: () => `test-${Math.random().toString(16).slice(2)}`
    },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout,
    clearTimeout
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`${code}
globalThis.__ta = {
  buildTestPlan: calendarBuildTestPlan,
  cleanPlan: calendarCleanPlan,
  setPlan(plan) { calendarPlan = calendarCleanPlan(plan); return calendarPlan; },
  getPlan() { return calendarPlan; },
  update(note) { return calendarBuildCoachUpdate(note); },
  extractCommand(note) { return calendarExtractCommand(note); },
  route(note) { return calendarRequestRoute(note); },
  targetPreview(note) { return calendarConversationTargetPreview(note); },
  setDefaultDialogueProfile(id) { return calendarSaveDefaultDialogueProfileId(id); },
  siteKnowledge() { return calendarWebsiteKnowledgeBase(); },
  agentInstruction(agentKey, note) {
    const agent = calendarGetAgents().find(item => item.key === agentKey);
    return calendarAgentInstruction(agent, calendarRequestRoute(note));
  },
  classify(note) { return calendarClassifyUserIntent(note, calendarExtractCommand(note)); },
  messages(result) { return (result.messages || []).join('\\n'); }
};`, context);
  return context.__ta;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function runScenario(name, fn) {
  const ta = loadHarness();
  ta.setPlan(ta.buildTestPlan('demo'));
  const before = JSON.parse(JSON.stringify(ta.getPlan()));
  const result = fn(ta, before);
  return { name, ...result };
}

const scenarios = [
  runScenario('1 short add/delete', (ta, before) => {
    const add = ta.update('/goal 准备周五复盘报告 60分钟 周五截止');
    ta.setPlan(add.plan);
    const added = ta.getPlan().goals.length > before.goals.length;
    const del = ta.update('删除 PPT 草稿');
    const text = ta.messages(del);
    expect(added, 'expected /goal to add a goal');
    expect(/删除完成/.test(text), 'expected delete confirmation');
    return { expected: 'add creates a goal, delete confirms exact removal', actual: text.split('\n')[0] };
  }),
  runScenario('2 long profile input', (ta) => {
    const result = ta.update('我现在是考试冲刺期学生。每周可用 16 小时。睡眠 00:00-07:45。固定周一到周四下午上课，晚上学不进去，上午专注最好，最近低估复盘时间。');
    const plan = result.plan;
    const text = ta.messages(result);
    expect(plan.profile.weeklyCapacityHours === 16, 'expected capacity update');
    expect(plan.profile.sleepWindow === '00:00-07:45', 'expected sleep update');
    expect(/Profile updated/.test(text), 'expected profile update messages');
    return { expected: 'extract stable profile facts without inventing goals', actual: text.split('\n').slice(0, 2).join(' / ') };
  }),
  runScenario('3 long multi-goal arrangement', (ta) => {
    const result = ta.update(`这周同时处理几个目标：
1. 周五前完成 Time Architect UI polish
2. 每天 IELTS 写作复盘 45 分钟
3. 周末整理一次健康和睡眠计划`);
    const text = ta.messages(result);
    expect(result.plan.goals.length >= 3, 'expected multiple goals');
    expect(/多目标安排/.test(text), 'expected multi-goal message');
    return { expected: 'split goals and schedule minimum progress blocks', actual: text.split('\n')[0] };
  }),
  runScenario('4 casual chat', (ta, before) => {
    const result = ta.update('你好');
    const text = ta.messages(result);
    expect(result.plan.blocks.length === before.blocks.length, 'casual chat should not add blocks');
    expect(/闲聊不会改|我在/.test(text), 'expected casual reply');
    return { expected: 'no plan mutation, friendly status', actual: text };
  }),
  runScenario('5 summary report', (ta) => {
    const result = ta.update('/report 生成本周周报');
    const text = ta.messages(result);
    expect(result.plan.archives.some(item => item.type === 'weekly-report'), 'expected weekly archive');
    expect(/周报/.test(text), 'expected report content');
    return { expected: 'write report archive and show summary', actual: text.split('\n')[0] };
  }),
  runScenario('6 user challenge', (ta, before) => {
    const result = ta.update('challenge 这个安排是不是太乐观了？');
    const text = ta.messages(result);
    expect(result.plan.blocks.length === before.blocks.length, 'challenge should not silently mutate blocks');
    expect(/Challenge 视角/.test(text), 'expected challenge view');
    return { expected: 'challenge assumptions without auto-changing plan', actual: text.split('\n')[0] };
  }),
  runScenario('7 asks why', (ta, before) => {
    const result = ta.update('/why 为什么这样安排？');
    const text = ta.messages(result);
    expect(result.plan.blocks.length === before.blocks.length, 'why should not mutate blocks');
    expect(/为什么这样安排/.test(text), 'expected rationale');
    return { expected: 'explain goals/capacity/risk rationale', actual: text.split('\n')[0] };
  }),
  runScenario('8 slash command guide', (ta) => {
    const result = ta.update('/command');
    const text = ta.messages(result);
    const preview = ta.targetPreview('/command');
    const route = ta.route('/command');
    const auditRoute = ta.route('/audit 检查有没有过载');
    const engineerRoute = ta.route('帮我 debug calendar UI');
    const scheduleRoute = ta.route('帮我加入一个行程，周五 10:00-11:00 写 IELTS');
    const siteKnowledge = ta.siteKnowledge();
    expect(ta.extractCommand('/command') === '/commands', 'expected singular /command alias');
    expect(/挑战|dialogue/i.test(preview.labels), 'expected /command chat target to route to dialogue agent');
    expect(/Gemini/i.test(preview.profiles), 'expected fallback dialogue profile to be Gemini');
    ta.setDefaultDialogueProfile('agent-engineer');
    const customPreview = ta.targetPreview('/command');
    expect(/GPT Engineer/.test(customPreview.profiles), 'expected user-set ordinary dialogue default profile');
    expect(route.agentKey === 'dialogue' && route.outputMode === 'dialogue-advice' && !route.draftMode, 'expected command/help to be dialogue advice');
    expect(auditRoute.agentKey === 'auditor' && auditRoute.outputMode === 'review-advice' && !auditRoute.draftMode, 'expected audit to be advice only');
    expect(engineerRoute.agentKey === 'engineer' && engineerRoute.outputMode === 'engineering-advice' && !engineerRoute.draftMode, 'expected engineering to be advice only');
    expect(scheduleRoute.agentKey === 'planner' && scheduleRoute.outputMode === 'calendar-draft' && scheduleRoute.draftMode, 'expected schedule CRUD to produce calendar draft');
    expect(siteKnowledge.routing.commandAliases['/command'] === '/commands', 'expected site knowledge command alias');
    expect(siteKnowledge.routing.outputModes.includes('calendar-draft'), 'expected site knowledge output modes');
    expect(siteKnowledge.defaultAgents.some(agent => agent.key === 'engineer' && /Calendar Engineering Skill/.test(agent.skill.name)), 'expected engineer skill in site knowledge');
    expect(/Built-in skill: Calendar Engineering Skill/.test(ta.agentInstruction('engineer', '帮我 debug calendar UI')), 'expected engineer skill in instruction');
    expect(/\/goal/.test(text) && /\/health/.test(text) && /\/report/.test(text), 'expected command guide');
    return { expected: 'every slash command has output and usage, /command aliases /commands, ordinary dialogue model is user-settable', actual: text.split('\n').slice(0, 3).join(' / ') };
  }),
  runScenario('9 asks profile view', (ta) => {
    const result = ta.update('/profile');
    const text = ta.messages(result);
    expect(/我目前这样看你的 Profile/.test(text), 'expected profile view');
    return { expected: 'user-facing profile interpretation', actual: text.split('\n')[0] };
  }),
  runScenario('10 asks health', (ta) => {
    const result = ta.update('/health 我今天有点累');
    const text = ta.messages(result);
    expect(/Health 判断/.test(text), 'expected health summary');
    expect(/Light mode/.test(text), 'expected tired-state light mode');
    return { expected: 'health risk plus light-mode action', actual: text.split('\n').slice(0, 2).join(' / ') };
  })
];

console.log('Scenario verification');
for (const item of scenarios) {
  console.log(`PASS ${item.name}`);
  console.log(`  expected: ${item.expected}`);
  console.log(`  actual:   ${item.actual}`);
}
