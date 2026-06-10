/**
 * Offline unit tests for the API layer (no network, no model calls).
 *
 *   npm run test:api
 */

import {
    buildCompactContext,
    buildStreamMessages,
    blockOccursOnDate,
    parseTimeOfDay,
    resolveClientNow,
    wallDatePlus,
    weekdayOfDate
} from '../api/time-architect.js';
import { validateToolCall, validateToolCalls } from '../api/_shared/validation.js';
import { ALL_TOOLS, toolsForAgent } from '../api/_shared/tool-schema.js';

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`PASS  ${name}`);
    } catch (err) {
        failures += 1;
        console.log(`FAIL  ${name}: ${err?.message || err}`);
    }
}
function eq(actual, expected, hint = '') {
    if (actual !== expected) throw new Error(`${hint} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(value, hint = '') {
    if (!value) throw new Error(`${hint} expected truthy, got ${JSON.stringify(value)}`);
}

// ── parseTimeOfDay ──
test('parseTimeOfDay accepts HH:MM strings', () => {
    eq(parseTimeOfDay('08:00', 0), 480);
    eq(parseTimeOfDay('23:30', 0), 1410);
    eq(parseTimeOfDay('00:10', 999), 10);
});
test('parseTimeOfDay accepts minute numbers', () => {
    eq(parseTimeOfDay(480, 0), 480);
    eq(parseTimeOfDay('480', 0), 480);
});
test('parseTimeOfDay falls back on junk', () => {
    eq(parseTimeOfDay('late', 123), 123);
    eq(parseTimeOfDay(null, 456), 456);
    eq(parseTimeOfDay('', 789), 789);
});

// ── wall date helpers ──
test('wallDatePlus crosses month/year boundaries', () => {
    eq(wallDatePlus('2026-05-31', 1), '2026-06-01');
    eq(wallDatePlus('2026-12-31', 1), '2027-01-01');
    eq(wallDatePlus('2026-06-10', -7), '2026-06-03');
});
test('weekdayOfDate is timezone independent', () => {
    eq(weekdayOfDate('2026-06-10'), 3, 'wed');
    eq(weekdayOfDate('2026-06-07'), 0, 'sun');
});

// ── resolveClientNow ──
test('resolveClientNow parses client wall time', () => {
    const now = resolveClientNow({ clientNow: '2026-06-10T23:45' });
    eq(now.date, '2026-06-10');
    eq(now.time, '23:45');
});
test('resolveClientNow falls back to server time', () => {
    const now = resolveClientNow({});
    ok(/^\d{4}-\d{2}-\d{2}$/.test(now.date));
    ok(/^\d{2}:\d{2}$/.test(now.time));
});

// ── recurrence expansion ──
test('blockOccursOnDate: one-time block', () => {
    const b = { date: '2026-06-10', start: 600, end: 660, repeat: { frequency: 'none' } };
    eq(blockOccursOnDate(b, '2026-06-10', '2026-06-07'), true);
    eq(blockOccursOnDate(b, '2026-06-11', '2026-06-07'), false);
});
test('blockOccursOnDate: daily repeat with count', () => {
    const b = { date: '2026-06-10', repeat: { frequency: 'daily', interval: 1, count: 3 } };
    eq(blockOccursOnDate(b, '2026-06-10', '2026-06-07'), true);
    eq(blockOccursOnDate(b, '2026-06-12', '2026-06-07'), true);
    eq(blockOccursOnDate(b, '2026-06-13', '2026-06-07'), false, 'beyond count');
    eq(blockOccursOnDate(b, '2026-06-09', '2026-06-07'), false, 'before anchor');
});
test('blockOccursOnDate: weekly repeat with interval 2', () => {
    const b = { date: '2026-06-10', repeat: { frequency: 'weekly', interval: 2 } };
    eq(blockOccursOnDate(b, '2026-06-17', '2026-06-07'), false, 'odd week');
    eq(blockOccursOnDate(b, '2026-06-24', '2026-06-07'), true, 'second week');
});
test('blockOccursOnDate: monthly + until', () => {
    const b = { date: '2026-06-10', repeat: { frequency: 'monthly', interval: 1, until: '2026-08-31' } };
    eq(blockOccursOnDate(b, '2026-07-10', '2026-06-07'), true);
    eq(blockOccursOnDate(b, '2026-09-10', '2026-06-07'), false, 'past until');
});
test('blockOccursOnDate: dateless block anchors to weekStart+day', () => {
    const b = { day: 3, start: 600, end: 660, repeat: { frequency: 'none' } };
    eq(blockOccursOnDate(b, '2026-06-10', '2026-06-07'), true, 'wednesday of that week');
    eq(blockOccursOnDate(b, '2026-06-17', '2026-06-07'), false);
});

// ── buildCompactContext ──
const PLAN = {
    weekStart: '2026-06-07',
    profile: { name: 'Henry', timezone: 'Asia/Shanghai', weeklyCapacityHours: 12 },
    habits: { wake: '08:00', sleep: '00:10', deepWorkStart: '20:00' },
    blocks: [
        { id: 'b1', title: '写周报', date: '2026-06-10', start: 840, end: 900, category: 'admin', kind: 'general', repeat: { frequency: 'none' } },
        { id: 'b2', title: '晨跑', date: '2026-06-08', start: 420, end: 460, category: 'workout', kind: 'routine', repeat: { frequency: 'daily', interval: 1 } }
    ],
    goals: [{ id: 'g1', title: '雅思 7 分', status: 'active', deadline: '2026-06-30', weeklyTarget: '10h' }]
};
const NOW = { date: '2026-06-10', time: '09:30' };

test('context has no NaN and real wake/sleep times', () => {
    const ctx = buildCompactContext(PLAN, NOW);
    ok(!ctx.includes('NaN'), 'NaN leaked');
    ok(ctx.includes('wake 08:00'), 'wake');
    ok(ctx.includes('sleep 00:10 (past midnight)'), 'cross-midnight sleep flag');
});
test('context [Today] uses client local time', () => {
    const ctx = buildCompactContext(PLAN, NOW);
    ok(ctx.includes('[Today] 2026-06-10 Wed 09:30 (user local time)'), ctx.split('\n').find(l => l.startsWith('[Today]')));
});
test('context free slots subtract one-time and daily-recurring blocks', () => {
    const ctx = buildCompactContext(PLAN, NOW);
    const free = ctx.slice(ctx.indexOf('[Free slots'));
    const today = free.split('\n').find(l => l.startsWith('2026-06-10'));
    ok(today, 'today line exists');
    ok(today.includes('08:00-14:00'), `gap before 写周报: ${today}`);
    ok(today.includes('15:00-24:00'), `cross-midnight day end: ${today}`);
    ok(!today.includes('07:00'), 'daily 晨跑 07:00-07:40 is before wake, no effect');
    const tomorrow = free.split('\n').find(l => l.startsWith('2026-06-11'));
    ok(tomorrow && tomorrow.includes('08:00-24:00'), `tomorrow fully free: ${tomorrow}`);
});
test('context lists goals and blocks', () => {
    const ctx = buildCompactContext(PLAN, NOW);
    ok(ctx.includes('g1 | 雅思 7 分 | deadline 2026-06-30'), 'goal line');
    ok(ctx.includes('b1 | 写周报 | 2026-06-10 14:00-15:00'), 'block line');
});

// ── buildStreamMessages ──
test('stream messages: current note not duplicated', () => {
    const { messages } = buildStreamMessages({
        message: '明天去跑步',
        plan: PLAN,
        conversation: [
            { role: 'user', content: '你好' },
            { role: 'assistant', content: '你好，需要安排什么？' },
            { role: 'user', content: '明天去跑步' }
        ]
    }, NOW);
    const last = messages[messages.length - 1];
    eq(last.role, 'user');
    eq(last.content, '明天去跑步');
    const occurrences = messages.filter(m => m.content.includes('明天去跑步')).length;
    eq(occurrences, 1, 'note appears once');
});
test('stream messages: strict alternation with merged consecutive roles', () => {
    const { messages } = buildStreamMessages({
        message: 'final',
        plan: {},
        conversation: [
            { role: 'assistant', content: 'skipped leading assistant' },
            { role: 'user', content: 'a' },
            { role: 'user', content: 'b' },
            { role: 'assistant', content: 'c' }
        ]
    }, NOW);
    eq(messages[0].role, 'user');
    eq(messages[0].content, 'a\n\nb');
    eq(messages[1].role, 'assistant');
    eq(messages[2].role, 'user');
    eq(messages[2].content, 'final');
});
test('stream messages: system prompt = roleHint + calendar state', () => {
    const { systemPrompt } = buildStreamMessages({ message: 'x', plan: PLAN, roleHint: 'ROLE-HINT' }, NOW);
    ok(systemPrompt.startsWith('ROLE-HINT'), 'roleHint first');
    ok(systemPrompt.includes('[Current calendar state]'), 'state header');
});

// ── tool schema ──
test('streaming toolset includes goal management, excludes respond_text', () => {
    const names = ALL_TOOLS.map(t => t.name);
    for (const required of ['create_event', 'update_event', 'delete_event', 'move_event', 'resize_event', 'create_goal', 'update_goal', 'delete_goal', 'update_profile']) {
        ok(names.includes(required), required);
    }
    const streaming = ALL_TOOLS.filter(t => t.name !== 'respond_text' && t.name !== 'propose_memory');
    ok(!streaming.some(t => t.name === 'respond_text'));
    ok(toolsForAgent('all').length === ALL_TOOLS.length, 'all role sees every tool');
});

// ── validation ──
const CTX = {
    blocks: [{ id: 'b1', title: 'X', start: 600, end: 660 }],
    goals: [{ id: 'g1', title: 'G' }]
};
test('validate: recurrence guard forces none without explicit language', () => {
    const out = validateToolCall(
        { name: 'create_event', args: { title: '复盘', start: 600, end: 660, repeat: { frequency: 'weekly', interval: 1 } } },
        CTX, 'all', '下周三上午复盘一下'
    );
    eq(out.valid, true);
    eq(out.args.repeat.frequency, 'none', 'guarded to none');
});
test('validate: recurrence kept with explicit 每周', () => {
    const out = validateToolCall(
        { name: 'create_event', args: { title: '复盘', start: 600, end: 660, repeat: { frequency: 'weekly', interval: 1 } } },
        CTX, 'all', '每周三上午都复盘'
    );
    eq(out.args.repeat.frequency, 'weekly');
});
test('validate: update_goal requires existing goal', () => {
    eq(validateToolCall({ name: 'update_goal', args: { targetId: 'g1', deadline: '2026-07-01' } }, CTX, 'all', '').valid, true);
    eq(validateToolCall({ name: 'update_goal', args: { targetId: 'nope', deadline: 'x' } }, CTX, 'all', '').valid, false);
    eq(validateToolCall({ name: 'update_goal', args: { targetId: 'g1' } }, CTX, 'all', '').valid, false, 'no fields');
});
test('validate: delete_goal requires existing goal', () => {
    eq(validateToolCall({ name: 'delete_goal', args: { targetId: 'g1' } }, CTX, 'all', '').valid, true);
    eq(validateToolCall({ name: 'delete_goal', args: { targetId: 'g9' } }, CTX, 'all', '').valid, false);
});
test('validate: legacy blocks-array context still works', () => {
    const out = validateToolCalls(
        [{ name: 'delete_event', args: { targetId: 'b1' } }],
        CTX.blocks, 'all', ''
    );
    eq(out[0].valid, true);
});
test('validate: time range sanity', () => {
    eq(validateToolCall({ name: 'create_event', args: { title: 'x', start: 600, end: 601 } }, CTX, 'all', '').valid, false, 'too short');
    eq(validateToolCall({ name: 'create_event', args: { title: 'x', start: 600, end: 605 } }, CTX, 'all', '').valid, true);
    eq(validateToolCall({ name: 'move_event', args: { targetId: 'b1', start: 700, end: 760 } }, CTX, 'all', '').valid, true);
});

console.log('\n---');
console.log(failures ? `${failures} failures` : 'All API tests passed');
process.exit(failures ? 1 : 0);
