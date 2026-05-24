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
  editContract(note) { return calendarCalendarEditContract(note, calendarRequestRoute(note)); },
  guardPlan(note, update, basePlan) { return calendarApplyCalendarEditContractToPlan(update, note, calendarRequestRoute(note), basePlan); },
  blocksForDay(plan, day) { return calendarBlocksForDay(calendarCleanPlan(plan), day); },
  agentInstruction(agentKey, note) {
    const agent = calendarGetAgents().find(item => item.key === agentKey);
    return calendarAgentInstruction(agent, calendarRequestRoute(note), note);
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
    const note = '我现在是考试冲刺期学生。每周可用 16 小时。睡眠 00:00-07:45。固定周一到周四下午上课，晚上学不进去，上午专注最好，最近低估复盘时间。';
    const result = ta.update(note);
    const plan = result.plan;
    const text = ta.messages(result);
    const route = ta.route(note);
    expect(plan.profile.weeklyCapacityHours === 16, 'expected capacity update');
    expect(plan.profile.sleepWindow === '00:00-07:45', 'expected sleep update');
    expect(/Profile updated/.test(text), 'expected profile update messages');
    expect(route.agentKey === 'planner' && route.outputMode === 'calendar-draft' && route.draftMode, 'expected long profile input to route to planner draft');
    return { expected: 'extract stable profile facts without inventing goals', actual: text.split('\n').slice(0, 2).join(' / ') };
  }),
  runScenario('3 long multi-goal arrangement', (ta) => {
    const note = `这周同时处理几个目标：
1. 周五前完成 Time Architect UI polish
2. 每天 IELTS 写作复盘 45 分钟
3. 周末整理一次健康和睡眠计划`;
    const result = ta.update(note);
    const text = ta.messages(result);
    const route = ta.route(note);
    expect(result.plan.goals.length >= 3, 'expected multiple goals');
    expect(/多目标安排/.test(text), 'expected multi-goal message');
    expect(route.agentKey === 'planner' && route.outputMode === 'calendar-draft' && route.draftMode, 'expected multi-goal input to route to planner draft');
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
    const consultingContract = ta.editContract("book next week's Wednesday 10 am for mental health consulting");
    const siteKnowledge = ta.siteKnowledge();
    expect(ta.extractCommand('/command') === '/commands', 'expected singular /command alias');
    expect(consultingContract.taskKind === 'fixed' && consultingContract.repeat.frequency === 'none' && consultingContract.mustNotRepeatUnlessExplicit, 'expected next-week booking to stay one-time by default');
    expect(siteKnowledge.routing.commandAliases['/command'] === '/commands', 'expected site knowledge command alias');
    expect(siteKnowledge.routing.outputModes.includes('calendar-draft'), 'expected site knowledge output modes');
    expect(siteKnowledge.calendarEditToolkit.repeatPolicy.defaultFrequency === 'none', 'expected calendar edit toolkit default repeat none');
    expect(Array.isArray(siteKnowledge.currentState.recentArchives), 'expected recent archive summaries in site knowledge');
    expect(/\/goal/.test(text) && /\/health/.test(text) && /\/report/.test(text), 'expected command guide');
    return { expected: 'every slash command has output and usage, /command aliases /commands, edit contract enforces one-time default', actual: text.split('\n').slice(0, 3).join(' / ') };
  }),
  runScenario('9 asks profile view', (ta) => {
    const result = ta.update('/profile');
    const text = ta.messages(result);
    expect(/我目前这样看你的 Profile/.test(text), 'expected profile view');
    return { expected: 'user-facing profile interpretation', actual: text.split('\n')[0] };
  }),
  runScenario('10 asks health', (ta) => {
    const note = '/health 我今天有点累';
    const result = ta.update(note);
    const text = ta.messages(result);
    const route = ta.route(note);
    expect(/Health 判断/.test(text), 'expected health summary');
    expect(/Light mode/.test(text), 'expected tired-state light mode');
    expect(route.agentKey === 'engineer' && route.outputMode === 'calendar-draft' && route.draftMode, 'expected tired health request to route to engineer calendar draft');
    return { expected: 'health risk plus light-mode action', actual: text.split('\n').slice(0, 2).join(' / ') };
  }),
  runScenario('11 one-time vs recurring calendar dates', (ta) => {
    const oneTimePlan = ta.cleanPlan({
      weekStart: '2026-05-24',
      blocks: [{
        id: 'consulting-once',
        title: 'Mental health consulting',
        date: '2026-05-27',
        day: 3,
        start: 600,
        end: 660,
        category: 'health',
        kind: 'fixed',
        repeat: { frequency: 'none', interval: 1 },
        source: 'manual'
      }]
    });
    const firstWeek = ta.blocksForDay(oneTimePlan, 3);
    const followingWeek = ta.blocksForDay({ ...oneTimePlan, weekStart: '2026-05-31' }, 3);
    const weeklyPlan = ta.cleanPlan({
      ...oneTimePlan,
      blocks: [{ ...oneTimePlan.blocks[0], id: 'consulting-weekly', repeat: { frequency: 'weekly', interval: 1 }, kind: 'routine' }]
    });
    const weeklyNext = ta.blocksForDay({ ...weeklyPlan, weekStart: '2026-05-31' }, 3);
    const guarded = ta.guardPlan("book next week's Wednesday 10 am for mental health consulting", {
      ...oneTimePlan,
      blocks: [{
        id: 'model-mistake',
        title: 'Mental health consulting',
        date: '2026-05-27',
        day: 3,
        start: 600,
        end: 660,
        category: 'health',
        kind: 'routine',
        repeat: { frequency: 'weekly', interval: 1 },
        source: 'agent:engineer'
      }]
    }, { ...oneTimePlan, blocks: [] });
    const explicitWeekly = ta.guardPlan('book every Wednesday 10 am mental health consulting', {
      ...weeklyPlan,
      blocks: [{
        id: 'explicit-weekly',
        title: 'Mental health consulting',
        date: '2026-05-27',
        day: 3,
        start: 600,
        end: 660,
        category: 'health',
        kind: 'routine',
        repeat: { frequency: 'weekly', interval: 1 },
        source: 'agent:engineer'
      }]
    }, { ...weeklyPlan, blocks: [] });
    const existingWeeklyPreserved = ta.guardPlan("book next week's Wednesday 10 am for mental health consulting", {
      ...weeklyPlan,
      blocks: [{ ...weeklyPlan.blocks[0], title: 'Existing weekly consulting' }]
    }, weeklyPlan);
    expect(firstWeek.some(block => block.id === 'consulting-once' && block.occurrenceDate === '2026-05-27'), 'expected one-time consulting event on selected Wednesday');
    expect(!followingWeek.some(block => block.id === 'consulting-once'), 'expected one-time consulting event not to repeat next Wednesday');
    expect(weeklyNext.some(block => block.id === 'consulting-weekly' && block.occurrenceDate === '2026-06-03'), 'expected explicit weekly repeat to appear next Wednesday');
    expect(guarded.blocks[0].repeat.frequency === 'none' && guarded.blocks[0].kind === 'fixed', 'expected guard to correct model-created weekly mistake for one-time booking');
    expect(explicitWeekly.blocks[0].repeat.frequency === 'weekly', 'expected guard to preserve explicit weekly request');
    expect(existingWeeklyPreserved.blocks[0].repeat.frequency === 'weekly', 'expected guard to preserve existing recurring blocks');
    return { expected: 'date selector is one-time unless repeat weekly is explicit', actual: `${firstWeek.length}/${followingWeek.length}/${weeklyNext.length}/${guarded.blocks[0].repeat.frequency}` };
  })
];

console.log('Scenario verification');
for (const item of scenarios) {
  console.log(`PASS ${item.name}`);
  console.log(`  expected: ${item.expected}`);
  console.log(`  actual:   ${item.actual}`);
}
