import { describe, it, expect } from 'vitest';
import {
  looksLikeCalendarEditInput, looksLikeTired, looksLikeDeleteRequest,
  looksLikeLongProfileInput, looksLikeMultiGoalInput, fastModeIntent,
  agentKeyForIntentKey, classifyUserIntent, requestRoute, intentIsReadOnly,
} from '../intent-classifier';

describe('looksLikeCalendarEditInput', () => {
  it('detects add event', () => {
    expect(looksLikeCalendarEditInput('add a meeting tomorrow at 10am')).toBe(true);
    expect(looksLikeCalendarEditInput('添加一个行程')).toBe(true);
  });
  it('detects delete', () => {
    expect(looksLikeCalendarEditInput('删除这个')).toBe(true);
    expect(looksLikeCalendarEditInput('delete the event')).toBe(true);
  });
  it('rejects non-calendar input', () => {
    expect(looksLikeCalendarEditInput('hello how are you')).toBe(false);
    expect(looksLikeCalendarEditInput('what is the weather')).toBe(false);
  });
});

describe('looksLikeTired', () => {
  it('detects tiredness', () => {
    expect(looksLikeTired('我好累')).toBe(true);
    expect(looksLikeTired('feeling tired and exhausted')).toBe(true);
  });
  it('rejects normal text', () => {
    expect(looksLikeTired('I feel great')).toBe(false);
  });
});

describe('looksLikeDeleteRequest', () => {
  it('detects delete', () => {
    expect(looksLikeDeleteRequest('删除这个时间块')).toBe(true);
    expect(looksLikeDeleteRequest('delete the event')).toBe(true);
    expect(looksLikeDeleteRequest('cancel the meeting')).toBe(true);
  });
});

describe('looksLikeLongProfileInput', () => {
  it('detects multi-signal long input', () => {
    const input = '我是大学生，目前在准备考试，每天都很忙。每周有固定的上课时间，周一到周五都有课，还有兼职工作。晚上精力比较好，上午容易拖延，效率不高。睡眠比较晚，一般12点才睡觉。';
    expect(looksLikeLongProfileInput(input)).toBe(true);
  });
  it('rejects short input', () => {
    expect(looksLikeLongProfileInput('我是学生')).toBe(false);
  });
});

describe('looksLikeMultiGoalInput', () => {
  it('detects numbered list', () => {
    const input = '1. 完成雅思\n2. 减重5公斤\n3. 学习React';
    expect(looksLikeMultiGoalInput(input)).toBe(true);
  });
  it('detects connector + multiple goals', () => {
    const input = '我同时要完成项目交付、学习训练、准备考试，还要减重';
    expect(looksLikeMultiGoalInput(input)).toBe(true);
  });
  it('rejects simple single goal', () => {
    expect(looksLikeMultiGoalInput('完成报告')).toBe(false);
  });
});

describe('fastModeIntent', () => {
  it('routes calendar edit to engineer', () => {
    const intent = fastModeIntent('book next Wednesday 10am consulting');
    expect(intent.key).toBe('calendar-edit');
    expect(intent.match('gpt-engineer')).toBe(true);
  });
  it('routes engineering requests', () => {
    const intent = fastModeIntent('fix the CSS bug');
    expect(intent.key).toBe('engineer');
  });
  it('routes audit requests', () => {
    const intent = fastModeIntent('检查冲突');
    expect(intent.key).toBe('audit');
  });
  it('defaults to dialogue', () => {
    const intent = fastModeIntent('hello there');
    expect(intent.key).toBe('dialogue');
  });
  it('routes planning commands', () => {
    const intent = fastModeIntent('/build-week');
    expect(intent.key).toBe('planner');
  });
});

describe('agentKeyForIntentKey', () => {
  it('maps intent keys to agent keys', () => {
    expect(agentKeyForIntentKey('calendar-edit')).toBe('engineer');
    expect(agentKeyForIntentKey('engineer')).toBe('engineer');
    expect(agentKeyForIntentKey('audit')).toBe('auditor');
    expect(agentKeyForIntentKey('flash')).toBe('auditor');
    expect(agentKeyForIntentKey('challenge')).toBe('dialogue');
    expect(agentKeyForIntentKey('dialogue')).toBe('dialogue');
    expect(agentKeyForIntentKey('planner')).toBe('planner');
  });
});

describe('classifyUserIntent', () => {
  it('classifies commands', () => {
    expect(classifyUserIntent('/help', '/help').kind).toBe('command-help');
    expect(classifyUserIntent('/report', '/report').kind).toBe('report');
    expect(classifyUserIntent('/why', '/why').kind).toBe('why');
  });
  it('classifies casual', () => {
    expect(classifyUserIntent('hello').kind).toBe('casual');
    expect(classifyUserIntent('谢谢').kind).toBe('casual');
  });
  it('classifies challenge', () => {
    expect(classifyUserIntent('challenge this plan').kind).toBe('challenge');
  });
  it('classifies delete', () => {
    expect(classifyUserIntent('删除这个').kind).toBe('delete');
  });
  it('defaults to planning', () => {
    expect(classifyUserIntent('安排周三10点开会').kind).toBe('planning');
  });
});

describe('requestRoute', () => {
  it('produces valid route', () => {
    const route = requestRoute('add meeting tomorrow');
    expect(route.agentKey).toBe('engineer');
    expect(route.draftMode).toBe(true);
    expect(route.outputMode).toBe('calendar-draft');
    expect(route.routerSource).toBe('local');
  });
  it('routes dialogue correctly', () => {
    const route = requestRoute('how are you');
    expect(route.agentKey).toBe('dialogue');
    expect(route.draftMode).toBe(false);
    expect(route.outputMode).toBe('dialogue-advice');
  });
});

describe('intentIsReadOnly', () => {
  it('read-only for help commands', () => {
    expect(intentIsReadOnly(null, '/help')).toBe(true);
    expect(intentIsReadOnly(null, '/report')).toBe(true);
  });
  it('read-only for casual intent', () => {
    expect(intentIsReadOnly({ kind: 'casual', raw: 'hi' })).toBe(true);
  });
  it('not read-only for planning', () => {
    expect(intentIsReadOnly({ kind: 'planning', raw: 'plan my week' })).toBe(false);
  });
});
