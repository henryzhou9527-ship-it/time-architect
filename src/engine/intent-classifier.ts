import { extractCommand, commandPayload } from './command-parser';

export type IntentKey =
  | 'planner' | 'engineer' | 'calendar-edit' | 'flash'
  | 'audit' | 'challenge' | 'dialogue';

export type AgentKey = 'planner' | 'engineer' | 'auditor' | 'dialogue';

export type OutputMode = 'calendar-draft' | 'dialogue-advice' | 'review-advice' | 'engineering-advice';

export interface FastModeIntent {
  key: IntentKey;
  reason: string;
  match: (label: string) => boolean;
}

export interface UserIntent {
  kind: string;
  raw: string;
}

export interface RequestRoute {
  requestType: IntentKey;
  reason: string;
  agentKey: AgentKey;
  outputMode: OutputMode;
  draftMode: boolean;
  confidence: number;
  match: (label: string) => boolean;
  routerSource: string;
}

export function looksLikeCalendarEditInput(note: unknown): boolean {
  const text = String(note || '').toLowerCase();
  const hasEditVerb = /(加入|添加|新增|新建|安排|排进|排到|加到|加一个|预约|预定|订|删除|删掉|取消|移除|不要这个|改到|移动|挪到|调整|延后|提前|\badd\b|\bcreate\b|\bschedule\b|\bbook\b|\breserve\b|\bput\b|\bplan\b|\bdelete\b|\bremove\b|\bcancel\b|\bdrop\b|\bmove\b|\breschedule\b|\bshift\b)/i.test(text);
  if (!hasEditVerb) return false;
  const hasDeleteOrMoveVerb = /(删除|删掉|取消|移除|不要这个|改到|移动|挪到|调整|延后|提前|\bdelete\b|\bremove\b|\bcancel\b|\bdrop\b|\bmove\b|\breschedule\b|\bshift\b)/i.test(text);
  const hasCalendarObject = /(行程|日程|时间块|任务|事件|计划|安排|会议|咨询|心理|看诊|问诊|预约|block|event|task|calendar|meeting|session|appointment|consult|consulting|therapy|mental health|doctor|workout|yoga|call|review|draft|practice)/i.test(text);
  const hasTimeHint = /(today|tomorrow|tonight|next\s+week|this\s+week|morning|afternoon|evening|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?|下周|本周|周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|今晚|上午|下午|晚上|早上|[01]?\d|2[0-3])[:：][0-5]\d|\b[1-9]\d?\s*(am|pm)\b|\bfor\s+\d+\s*(m|min|mins|minute|minutes|h|hr|hour|hours)\b|\d+\s*(分钟|小时|min|mins|minutes|hour|hours)/i.test(text);
  if (hasDeleteOrMoveVerb && text.length <= 80) return true;
  return hasCalendarObject || hasTimeHint;
}

export function looksLikeTired(text: unknown): boolean {
  return /(累|疲惫|没精神|精力低|撑不住|burnout|tired|exhausted|low energy)/i.test(String(text || ''));
}

export function looksLikeDeleteRequest(text: unknown): boolean {
  return /(删除|删掉|取消|移除|不要这个|drop|delete|remove|cancel).{0,80}(时间块|安排|任务|block|event|计划)?/i.test(String(text || ''));
}

export function looksLikeLongProfileInput(text: unknown): boolean {
  const raw = String(text || '');
  if (raw.length < 60) return false;
  const hits = [
    /(我是|我现在|目前|身份|工作|学生|考试|项目|兼职)/,
    /(每周|固定|周一|周二|周三|周四|周五|周末|上课|会议|通勤)/,
    /(睡眠|睡觉|起床|作息|晚饭|吃饭|运动|恢复|健康)/,
    /(上午|下午|晚上|精力|专注|效率|拖延|低估|失败模式)/,
  ].filter(regex => regex.test(raw)).length;
  return hits >= 2;
}

export function looksLikeMultiGoalInput(text: unknown): boolean {
  const raw = String(text || '');
  const numbered = raw.match(/(^|\n)\s*(?:\d+[.)、]|[-*•])\s*\S+/g) || [];
  if (numbered.length >= 2) return true;
  const connectors = /(同时|还要|另外|除此之外|and also|as well as)/i.test(raw);
  const goalWords = (raw.match(/(目标|完成|准备|学习|训练|项目|考试|交付|减重|雅思|IELTS|demo|presentation|report|paper)/ig) || []).length;
  return connectors && goalWords >= 3;
}

export function fastModeIntent(note: unknown): FastModeIntent {
  const text = String(note || '').toLowerCase();
  const command = extractCommand(note);

  if (looksLikeMultiGoalInput(note)) {
    return { key: 'planner', reason: '多目标规划', match: (label) => /claude|opus|planner/.test(label) };
  }
  if ((command === '/profile' && commandPayload(note)) || looksLikeLongProfileInput(note)) {
    return { key: 'planner', reason: 'Profile/规划记忆更新', match: (label) => /claude|opus|planner/.test(label) };
  }
  if (/gpt|工程|代码|编程|实现|改代码|修代码|bug|debug|\bui\b|css|html|javascript|js\b|\bapi\b|schema|json|vercel|部署|github|commit|pull request|pr\b|refactor|frontend|backend|typescript|react|node/.test(text)) {
    return { key: 'engineer', reason: '工程/代码请求', match: (label) => /gpt|engineer/.test(label) };
  }
  if (/flash|快速|轻量|便宜|小改|小的|quick|fast/.test(text)) {
    return { key: 'flash', reason: '轻量快速请求', match: (label) => /deepseek-v4-flash|flash/.test(label) };
  }
  if (/审计|检查|查错|冲突|过载|风险|低估|audit|sanity|red flag|deepseek|dsk/.test(text)) {
    return { key: 'audit', reason: '审计/风险检查', match: (label) => /deepseek-v4-pro|deepseek|auditor/.test(label) };
  }
  if (command === '/light-mode' || (command === '/health' && looksLikeTired(note))) {
    return { key: 'calendar-edit', reason: '健康轻量执行', match: (label) => /gpt|engineer/.test(label) };
  }
  if (looksLikeCalendarEditInput(note)) {
    return { key: 'calendar-edit', reason: '日历行程执行', match: (label) => /gpt|engineer/.test(label) };
  }
  if (/挑战|反驳|盲区|第二意见|gemini|challenge|critic|alternative/.test(text)) {
    return { key: 'challenge', reason: '挑战假设/找盲区', match: (label) => /gemini|challenger/.test(label) };
  }
  if (['/goal', '/estimate', '/build-day', '/build-week', '/24-7', '/adjust', '/reflect', '/catch-up', '/light-mode', '/sprint', '/reset'].includes(command)) {
    return { key: 'planner', reason: '规划/排程命令', match: (label) => /claude|opus|planner/.test(label) };
  }
  return { key: 'dialogue', reason: '默认普通对话', match: (label) => /gemini|challenger|dialogue/.test(label) };
}

export function agentKeyForIntentKey(intentKey: IntentKey): AgentKey {
  if (intentKey === 'calendar-edit') return 'engineer';
  if (intentKey === 'engineer') return 'engineer';
  if (intentKey === 'audit' || intentKey === 'flash') return 'auditor';
  if (intentKey === 'challenge' || intentKey === 'dialogue') return 'dialogue';
  return 'planner';
}

export function routeMatcher(agentKey: AgentKey, requestType = ''): (label: string) => boolean {
  if (agentKey === 'planner') return (label) => /claude|opus|planner/.test(label);
  if (agentKey === 'engineer') return (label) => /gpt|engineer/.test(label);
  if (agentKey === 'auditor' && requestType === 'flash') return (label) => /deepseek-v4-flash|flash/.test(label);
  if (agentKey === 'auditor') return (label) => /deepseek-v4-pro|deepseek|auditor/.test(label);
  return (label) => /gemini|challenger|dialogue/.test(label);
}

export function classifyUserIntent(note: unknown, command = ''): UserIntent {
  const raw = String(note || '');
  const text = raw.toLowerCase();
  const payload = commandPayload(raw);

  if (command === '/commands' || command === '/help' || /每(一|个).*\/.*(指令|命令)|指令.*用途|命令.*用途|slash command|commands?/i.test(raw)) {
    return { kind: 'command-help', raw };
  }
  if (command === '/report' || /(总结|汇总|复盘报告|日报|周报|月报|report|summary)/i.test(raw)) {
    return { kind: 'report', raw };
  }
  if (command === '/why' || /(为什么|为何|怎么安排|安排.*原因|原因是什么|理由|rationale|why this|why did)/i.test(raw)) {
    return { kind: 'why', raw };
  }
  if (command === '/health' || /(我的|我现在|今天|最近).{0,12}(health|健康|身体|精力|睡眠|恢复|疲惫|累|状态)/i.test(raw) || /(health|健康).{0,12}(怎么看|如何|状态|summary|report)/i.test(raw)) {
    return { kind: 'health-query', raw };
  }
  if ((command === '/profile' && !payload) || /(我的|你).*?(profile|画像|用户信息|长期信息|怎么看我|如何看待我|了解我)/i.test(raw)) {
    return { kind: 'profile-query', raw };
  }
  if (/(challenge|反驳|质疑|挑战|盲区|不对|你确定|有没有更好|第二意见|critic|push back)/i.test(raw)) {
    return { kind: 'challenge', raw };
  }
  if (looksLikeDeleteRequest(raw)) return { kind: 'delete', raw };
  if (looksLikeMultiGoalInput(raw)) return { kind: 'multi-goal', raw };
  if (looksLikeLongProfileInput(raw)) return { kind: 'profile-input', raw };
  if (!command && /^(hi|hello|hey|你好|在吗|谢谢|thx|thanks|哈哈|ok|好的|收到)[\s。！!,.，]*$/i.test(text.trim())) {
    return { kind: 'casual', raw };
  }
  return { kind: 'planning', raw };
}

export function requestRoute(note: unknown): RequestRoute {
  const intent = fastModeIntent(note);
  const agentKey = agentKeyForIntentKey(intent.key);
  const draftMode = agentKey === 'planner' || intent.key === 'calendar-edit';
  const outputMode: OutputMode = draftMode
    ? 'calendar-draft'
    : (agentKey === 'auditor' ? 'review-advice' : (agentKey === 'engineer' ? 'engineering-advice' : 'dialogue-advice'));
  return {
    requestType: intent.key,
    reason: intent.reason,
    agentKey,
    outputMode,
    draftMode,
    confidence: 0.7,
    match: intent.match,
    routerSource: 'local',
  };
}

export function normalizeRoute(raw: Partial<RequestRoute> | null, fallback?: RequestRoute): RequestRoute {
  const fb = fallback || requestRoute('');
  const requestTypes = new Set<string>(['planner', 'calendar-edit', 'engineer', 'audit', 'flash', 'challenge', 'dialogue']);
  const agentKeys = new Set<string>(['planner', 'engineer', 'auditor', 'dialogue']);

  const requestType = requestTypes.has(String(raw?.requestType || '').trim())
    ? String(raw!.requestType).trim() as IntentKey
    : fb.requestType;

  let agentKey = agentKeys.has(String(raw?.agentKey || '').trim())
    ? String(raw!.agentKey).trim() as AgentKey
    : fb.agentKey;

  if (requestType === 'calendar-edit' || requestType === 'engineer') agentKey = 'engineer';
  if (requestType === 'audit' || requestType === 'flash') agentKey = 'auditor';
  if (requestType === 'challenge' || requestType === 'dialogue') agentKey = 'dialogue';
  if (requestType === 'planner') agentKey = 'planner';

  const draftMode = requestType === 'calendar-edit' || agentKey === 'planner';
  const outputMode: OutputMode = draftMode
    ? 'calendar-draft'
    : (agentKey === 'auditor' ? 'review-advice' : (agentKey === 'engineer' ? 'engineering-advice' : 'dialogue-advice'));

  return {
    requestType,
    reason: String(raw?.reason || fb.reason || 'AI Router 判断').slice(0, 160),
    agentKey,
    outputMode,
    draftMode,
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence ?? fb.confidence ?? 0.5) || 0.5)),
    match: routeMatcher(agentKey, requestType),
    routerSource: raw?.routerSource || fb.routerSource || 'local',
  };
}

export function intentIsReadOnly(intent: UserIntent | null, command = ''): boolean {
  if (['/commands', '/help', '/health', '/why', '/report'].includes(command)) return true;
  if (command === '/profile' && !commandPayload(intent?.raw || '')) return true;
  return ['casual', 'profile-query', 'health-query', 'why', 'command-help', 'report', 'challenge'].includes(intent?.kind || '');
}
