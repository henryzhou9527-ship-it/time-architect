/* ── Time Architect: goal-first time blocks + ActivityWatch comparison ── */

const CALENDAR_PLAN_KEY = 'calendar_plan';
const CALENDAR_PLAN_STORAGE_KEY = 'time_architect_plan_v1';
const CALENDAR_ARCHITECT_API = '/api/time-architect';
const CALENDAR_API_CONFIG_STORAGE_KEY = 'time_architect_api_v1';
const CALENDAR_SLOT_MINUTES = 15;
const CALENDAR_SLOT_HEIGHT = 12;
const CALENDAR_DAY_MINUTES = 24 * 60;
const CALENDAR_PRODUCTIVE_CATEGORIES = new Set(['deep', 'study', 'workout', 'admin', 'reflection', 'recovery']);
const CALENDAR_AGENT_ROLES = [
    {
        key: 'planner',
        label: '主脑',
        model: 'Opus 4.6',
        configName: 'Opus Planner',
        modelId: 'claude-opus-4-6',
        job: '目标、估时、健康约束、最终计划'
    },
    {
        key: 'dialogue',
        label: '挑战',
        model: 'Gemini 3.1 Pro',
        configName: 'Gemini Challenger',
        modelId: 'gemini-3.1-pro-preview',
        job: '挑战 Opus 假设、找盲区、提替代方案'
    },
    {
        key: 'auditor',
        label: '审计',
        model: 'DeepSeek V4 Pro',
        configName: 'DeepSeek Auditor',
        modelId: 'deepseek-v4-pro',
        job: '低成本查错：冲突、低估、过载'
    },
    {
        key: 'engineer',
        label: '工程',
        model: 'GPT-5.5',
        configName: 'GPT Engineer',
        modelId: 'gpt-5.5',
        job: '只在修 UI、写码、修 schema 时介入'
    }
];

const CALENDAR_DAYS = [
    { key: 'sun', label: '周日', short: 'Sun' },
    { key: 'mon', label: '周一', short: 'Mon' },
    { key: 'tue', label: '周二', short: 'Tue' },
    { key: 'wed', label: '周三', short: 'Wed' },
    { key: 'thu', label: '周四', short: 'Thu' },
    { key: 'fri', label: '周五', short: 'Fri' },
    { key: 'sat', label: '周六', short: 'Sat' },
];

const CALENDAR_CATEGORIES = {
    deep: { label: '深度工作', color: '#34d399' },
    study: { label: '学习', color: '#38bdf8' },
    workout: { label: '运动', color: '#fb923c' },
    admin: { label: '事务', color: '#a78bfa' },
    life: { label: '生活', color: '#fbbf24' },
    reflection: { label: '复盘', color: '#2dd4bf' },
    recovery: { label: '补救', color: '#f87171' },
    reward: { label: '奖励', color: '#f472b6' },
    rest: { label: '休息', color: '#9ca3af' },
};

const CALENDAR_COMMANDS = [
    '/profile', '/goal', '/estimate', '/build-week', '/build-day', '/24-7',
    '/adjust', '/reflect', '/catch-up', '/audit', '/memory',
    '/light-mode', '/sprint', '/reset'
];

let calendarPlan = null;
let calendarActivity = {
    locked: true,
    scope: 'none',
    devices: [],
    actualBlocks: [],
    loadedAt: null,
    error: ''
};
let calendarActivityInterval = null;
let calendarSelectedBlockId = null;
let calendarDraftText = '';
let calendarSyncStatus = '';
let calendarApiStatus = '输出来源：local fallback';
let calendarCurrentPage = 'calendar';
let calendarChatOpen = true;
let calendarCalendarMode = 'plan';
let calendarSlotSize = 30;
let calendarClockInterval = null;

function calendarEsc(value) {
    if (typeof nbEsc === 'function') return nbEsc(value);
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function calendarId(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function calendarSettingsApi() {
    return typeof SHARED_SETTINGS_API !== 'undefined' ? SHARED_SETTINGS_API : '/api/settings';
}

function calendarDefaultApiConfig(overrides = {}) {
    return {
        id: overrides.id || calendarId('api'),
        name: overrides.name || 'Opus Planner',
        mode: 'chat',
        baseUrl: 'https://api.ikuncode.cc/v1',
        model: 'claude-opus-4-6',
        apiKey: '',
        councilEnabled: true,
        ...overrides
    };
}

function calendarNormalizeApiBaseUrl(value) {
    const raw = String(value || 'https://api.ikuncode.cc/v1').trim().replace(/\/+$/, '');
    try {
        const url = new URL(raw);
        if (url.hostname === 'api.ikuncode.cc' && (url.pathname === '' || url.pathname === '/')) {
            url.pathname = '/v1';
            return url.toString().replace(/\/+$/, '');
        }
    } catch {
        return raw;
    }
    return raw;
}

function calendarCleanApiConfig(raw, index = 0) {
    const base = calendarDefaultApiConfig();
    const source = raw && typeof raw === 'object' ? raw : {};
    const mode = String(source.mode || base.mode).trim().toLowerCase() === 'responses' ? 'responses' : 'chat';
    return {
        id: String(source.id || calendarId('api')).slice(0, 80),
        name: String(source.name || source.label || `API ${index + 1}`).trim().slice(0, 80),
        mode,
        baseUrl: calendarNormalizeApiBaseUrl(source.baseUrl || base.baseUrl).slice(0, 240) || base.baseUrl,
        model: String(source.model || base.model).trim().slice(0, 120) || base.model,
        apiKey: String(source.apiKey || '').trim(),
        councilEnabled: source.councilEnabled === false ? false : true
    };
}

function calendarDefaultApiStore() {
    const profiles = calendarDefaultAgentProfiles();
    const first = profiles[0];
    return {
        activeId: first.id,
        councilMode: false,
        profiles
    };
}

function calendarDefaultAgentProfiles() {
    return CALENDAR_AGENT_ROLES.map(role => calendarDefaultApiConfig({
        id: `agent-${role.key}`,
        name: role.configName,
        model: role.modelId,
        councilEnabled: role.key !== 'engineer'
    }));
}

function calendarCleanApiStore(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const rawProfiles = Array.isArray(source.profiles)
        ? source.profiles
        : (source.model || source.baseUrl || source.apiKey ? [source] : []);
    const profiles = rawProfiles.map((item, index) => calendarCleanApiConfig(item, index)).slice(0, 8);
    if (!profiles.length) return calendarDefaultApiStore();
    const activeId = profiles.some(item => item.id === source.activeId) ? source.activeId : profiles[0].id;
    return {
        activeId,
        councilMode: Boolean(source.councilMode),
        profiles
    };
}

function calendarLoadApiStore() {
    try {
        return calendarCleanApiStore(JSON.parse(localStorage.getItem(CALENDAR_API_CONFIG_STORAGE_KEY)));
    } catch {
        return calendarDefaultApiStore();
    }
}

function calendarSaveApiStore(store) {
    const cleaned = calendarCleanApiStore(store);
    localStorage.setItem(CALENDAR_API_CONFIG_STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
}

function calendarLoadApiConfig() {
    const store = calendarLoadApiStore();
    return store.profiles.find(item => item.id === store.activeId) || store.profiles[0] || calendarDefaultApiConfig();
}

function calendarSaveApiConfig(config) {
    const store = calendarLoadApiStore();
    const cleaned = calendarCleanApiConfig({ ...calendarLoadApiConfig(), ...config });
    const profiles = store.profiles.map(item => item.id === cleaned.id ? cleaned : item);
    const nextStore = calendarSaveApiStore({
        ...store,
        activeId: cleaned.id,
        profiles: profiles.some(item => item.id === cleaned.id) ? profiles : [...profiles, cleaned]
    });
    return nextStore.profiles.find(item => item.id === cleaned.id) || cleaned;
}

function calendarApiProfilesForRequest() {
    const store = calendarLoadApiStore();
    const active = store.profiles.find(item => item.id === store.activeId) || store.profiles[0];
    if (!active) return [];
    const seenModels = new Set();
    const profiles = store.councilMode
        ? [active, ...store.profiles.filter(item => item.id !== active.id && item.councilEnabled)]
        : [active];
    return profiles
        .filter(item => item.apiKey)
        .filter(item => {
            const signature = `${String(item.baseUrl || '').toLowerCase()}::${String(item.model || '').toLowerCase()}`;
            if (seenModels.has(signature)) return false;
            seenModels.add(signature);
            return true;
        })
        .slice(0, 4)
        .map(item => ({
            name: item.name,
            mode: item.mode,
            baseUrl: item.baseUrl,
            model: item.model,
            apiKey: item.apiKey
        }));
}

function calendarActiveApiLabel(config = calendarLoadApiConfig()) {
    return `${config.name} · ${config.baseUrl} · ${config.model} · ${config.mode}`;
}

function calendarSession() {
    return typeof getCurrentSession === 'function' ? getCurrentSession() : null;
}

function calendarCanSync() {
    const user = calendarSession()?.username?.toLowerCase();
    return user === 'henry' || user === 'admin';
}

function calendarCanUseArchitectApi() {
    return true;
}

function calendarPad(value) {
    return String(value).padStart(2, '0');
}

function calendarFormatDate(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function calendarParseDate(dateStr) {
    const [year, month, day] = String(dateStr || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function calendarDatePlus(dateStr, days) {
    const date = calendarParseDate(dateStr) || new Date();
    date.setDate(date.getDate() + days);
    return calendarFormatDate(date);
}

function calendarWeekStart(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return calendarFormatDate(d);
}

function calendarWeekRangeLabel(weekStart) {
    return `${weekStart} - ${calendarDatePlus(weekStart, 6)}`;
}

function calendarDateForDay(weekStart, day) {
    return calendarDatePlus(weekStart, day);
}

function calendarDayIndexForDate(dateStr, weekStart) {
    const start = calendarParseDate(weekStart);
    const current = calendarParseDate(dateStr);
    if (!start || !current) return -1;
    return Math.round((current - start) / 86400000);
}

function calendarCurrentDayIndex(plan = calendarPlan) {
    if (!plan) return -1;
    return calendarDayIndexForDate(calendarFormatDate(new Date()), plan.weekStart);
}

function calendarNowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

function calendarMinutesToTime(minutes) {
    const clamped = Math.max(0, Math.min(CALENDAR_DAY_MINUTES, Math.round(minutes)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${calendarPad(h)}:${calendarPad(m)}`;
}

function calendarTimeToMinutes(value, fallback = 9 * 60) {
    const text = String(value || '').trim().toLowerCase();
    const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
    if (!match) return fallback;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const suffix = match[3];
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return fallback;
    return Math.max(0, Math.min(CALENDAR_DAY_MINUTES, hour * 60 + minute));
}

function calendarRoundToSlot(minutes) {
    return Math.round(minutes / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_MINUTES;
}

function calendarCategoryInfo(category) {
    return CALENDAR_CATEGORIES[category] || CALENDAR_CATEGORIES.deep;
}

function calendarTextArray(value, limit = 12, itemLimit = 120) {
    if (Array.isArray(value)) {
        return value.map(item => String(item || '').trim()).filter(Boolean).slice(0, limit);
    }
    const text = String(value || '').trim();
    if (!text) return [];
    return text
        .split(/[,\n，、;；]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, limit)
        .map(item => item.slice(0, itemLimit));
}

function calendarDefaultProfile() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    return {
        name: 'Henry',
        timezone,
        currentLifeStage: '',
        roles: [],
        fixedCommitments: '',
        sleepWindow: '23:30-08:00',
        mealRoutines: '',
        commuteConstraints: '',
        energyPattern: {
            highFocusTime: '上午或晚间待校准',
            lowEnergyTime: '待校准',
            bestCreativeTime: '',
            bestAdminTime: '晚上'
        },
        healthRecoveryConstraints: '',
        planningStyle: 'hybrid',
        defaultBlockLength: 'variable',
        motivationPattern: '',
        commonFailureModes: ['underestimating workload', 'late-night drift'],
        weeklyCapacityHours: 10,
        preferredReviewCadence: 'daily + weekly'
    };
}

function calendarCleanProfile(raw) {
    const base = calendarDefaultProfile();
    const source = raw && typeof raw === 'object' ? raw : {};
    const energy = source.energyPattern && typeof source.energyPattern === 'object' ? source.energyPattern : {};
    return {
        name: String(source.name || base.name).trim().slice(0, 80),
        timezone: String(source.timezone || base.timezone).trim().slice(0, 80),
        currentLifeStage: String(source.currentLifeStage || '').trim().slice(0, 140),
        roles: calendarTextArray(source.roles, 8, 60),
        fixedCommitments: String(source.fixedCommitments || '').trim().slice(0, 800),
        sleepWindow: String(source.sleepWindow || base.sleepWindow).trim().slice(0, 40),
        mealRoutines: String(source.mealRoutines || '').trim().slice(0, 300),
        commuteConstraints: String(source.commuteConstraints || '').trim().slice(0, 300),
        energyPattern: {
            highFocusTime: String(energy.highFocusTime || base.energyPattern.highFocusTime).trim().slice(0, 120),
            lowEnergyTime: String(energy.lowEnergyTime || base.energyPattern.lowEnergyTime).trim().slice(0, 120),
            bestCreativeTime: String(energy.bestCreativeTime || '').trim().slice(0, 120),
            bestAdminTime: String(energy.bestAdminTime || base.energyPattern.bestAdminTime).trim().slice(0, 120)
        },
        healthRecoveryConstraints: String(source.healthRecoveryConstraints || '').trim().slice(0, 500),
        planningStyle: ['strict', 'flexible', 'hybrid'].includes(source.planningStyle) ? source.planningStyle : base.planningStyle,
        defaultBlockLength: String(source.defaultBlockLength || base.defaultBlockLength).trim().slice(0, 40),
        motivationPattern: String(source.motivationPattern || '').trim().slice(0, 400),
        commonFailureModes: calendarTextArray(source.commonFailureModes || base.commonFailureModes, 12, 80),
        weeklyCapacityHours: Math.max(1, Math.min(80, Number(source.weeklyCapacityHours) || base.weeklyCapacityHours)),
        preferredReviewCadence: String(source.preferredReviewCadence || base.preferredReviewCadence).trim().slice(0, 80)
    };
}

function calendarCleanWorkload(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        minimumHours: Math.max(0, Number(source.minimumHours) || 0),
        realisticHours: Math.max(0, Number(source.realisticHours) || 0),
        strongHours: Math.max(0, Number(source.strongHours) || 0),
        confidence: String(source.confidence || 'low').trim().slice(0, 80)
    };
}

function calendarDefaultPlan() {
    return {
        version: 1,
        weekStart: calendarWeekStart(new Date()),
        profile: calendarDefaultProfile(),
        habits: {
            wake: '08:00',
            sleep: '23:30',
            deepWorkStart: '20:00'
        },
        goals: [],
        blocks: [],
        reflections: []
    };
}

function calendarCleanBlock(raw) {
    const day = Math.max(0, Math.min(6, Number(raw?.day) || 0));
    const start = Math.max(0, Math.min(CALENDAR_DAY_MINUTES - CALENDAR_SLOT_MINUTES, calendarRoundToSlot(Number(raw?.start) || 0)));
    const rawEnd = Number(raw?.end) || start + 60;
    const end = Math.max(start + CALENDAR_SLOT_MINUTES, Math.min(CALENDAR_DAY_MINUTES, calendarRoundToSlot(rawEnd)));
    const category = CALENDAR_CATEGORIES[raw?.category] ? raw.category : 'deep';
    return {
        id: String(raw?.id || calendarId('block')),
        title: String(raw?.title || '未命名').trim().slice(0, 90),
        day,
        start,
        end,
        category,
        goalId: raw?.goalId ? String(raw.goalId) : '',
        source: String(raw?.source || 'manual').slice(0, 90),
        status: ['planned', 'done', 'missed'].includes(raw?.status) ? raw.status : 'planned',
        note: String(raw?.note || '').trim().slice(0, 360),
        exactAction: String(raw?.exactAction || '').trim().slice(0, 420),
        output: String(raw?.output || '').trim().slice(0, 260),
        ifInterrupted: String(raw?.ifInterrupted || '').trim().slice(0, 260),
        ifFinishedEarly: String(raw?.ifFinishedEarly || '').trim().slice(0, 260)
    };
}

function calendarCleanGoal(raw) {
    const workload = calendarCleanWorkload(raw?.estimatedWorkload);
    return {
        id: String(raw?.id || calendarId('goal')),
        title: String(raw?.title || '未命名目标').trim().slice(0, 120),
        type: String(raw?.type || 'project').trim().slice(0, 40),
        desiredOutcome: String(raw?.desiredOutcome || raw?.title || '').trim().slice(0, 240),
        deadline: String(raw?.deadline || '').trim().slice(0, 20),
        successCriteria: String(raw?.successCriteria || '').trim().slice(0, 300),
        currentBaseline: String(raw?.currentBaseline || '').trim().slice(0, 240),
        gap: String(raw?.gap || '').trim().slice(0, 240),
        requiredDeliverables: calendarTextArray(raw?.requiredDeliverables, 16, 140),
        requiredSkills: calendarTextArray(raw?.requiredSkills, 12, 90),
        estimatedWorkload: workload,
        confidence: String(raw?.confidence || workload.confidence || 'low').trim().slice(0, 80),
        risks: calendarTextArray(raw?.risks, 12, 140),
        dependencies: calendarTextArray(raw?.dependencies, 12, 120),
        reviewCheckpoints: calendarTextArray(raw?.reviewCheckpoints, 12, 120),
        priority: String(raw?.priority || 'P2').trim().slice(0, 20),
        consequenceIfDelayed: String(raw?.consequenceIfDelayed || '').trim().slice(0, 220),
        weeklyTarget: String(raw?.weeklyTarget || '').trim().slice(0, 180),
        dailyMinimum: String(raw?.dailyMinimum || '').trim().slice(0, 180),
        status: ['active', 'done', 'paused'].includes(raw?.status) ? raw.status : 'active',
        target: raw?.target && typeof raw.target === 'object' ? raw.target : {},
        createdAt: String(raw?.createdAt || new Date().toISOString()),
        notes: String(raw?.notes || '').trim().slice(0, 600)
    };
}

function calendarCleanReflection(raw) {
    return {
        id: String(raw?.id || calendarId('reflection')),
        at: String(raw?.at || new Date().toISOString()),
        text: String(raw?.text || '').trim().slice(0, 1500),
        messages: Array.isArray(raw?.messages)
            ? raw.messages.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8)
            : []
    };
}

function calendarCleanPlan(raw) {
    const base = calendarDefaultPlan();
    const source = raw && typeof raw === 'object' ? raw : {};
    const habits = source.habits && typeof source.habits === 'object' ? source.habits : {};
    const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(String(source.weekStart || ''))
        ? source.weekStart
        : base.weekStart;

    const goals = Array.isArray(source.goals) ? source.goals.map(calendarCleanGoal).slice(-80) : [];
    const blocks = Array.isArray(source.blocks) ? source.blocks.map(calendarCleanBlock).slice(-700) : [];
    const reflections = Array.isArray(source.reflections) ? source.reflections.map(calendarCleanReflection).slice(-200) : [];

    return {
        version: 1,
        weekStart,
        profile: calendarCleanProfile(source.profile || base.profile),
        habits: {
            wake: String(habits.wake || base.habits.wake),
            sleep: String(habits.sleep || base.habits.sleep),
            deepWorkStart: String(habits.deepWorkStart || base.habits.deepWorkStart)
        },
        goals,
        blocks,
        reflections
    };
}

function calendarLoadLocalPlan() {
    try {
        return calendarCleanPlan(JSON.parse(localStorage.getItem(CALENDAR_PLAN_STORAGE_KEY)));
    } catch {
        return calendarDefaultPlan();
    }
}

async function calendarLoadPlan() {
    const localPlan = calendarLoadLocalPlan();
    calendarPlan = localPlan;
    calendarSyncStatus = calendarCanSync() ? '正在读取云端计划...' : '未登录，计划仅保存在这台设备。';

    if (!calendarCanSync()) return calendarPlan;

    try {
        const user = encodeURIComponent(calendarSession().username || '');
        const res = await fetch(`${calendarSettingsApi()}?key=${encodeURIComponent(CALENDAR_PLAN_KEY)}&user=${user}`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data.value) {
                calendarPlan = calendarCleanPlan(data.value);
                localStorage.setItem(CALENDAR_PLAN_STORAGE_KEY, JSON.stringify(calendarPlan));
                calendarSyncStatus = '已从云端同步。';
                return calendarPlan;
            }
        }
        calendarSyncStatus = '云端暂无计划，正在使用本机计划。';
    } catch {
        calendarSyncStatus = '云端暂不可用，正在使用本机计划。';
    }

    return calendarPlan;
}

async function calendarSavePlan(render = true) {
    calendarPlan = calendarCleanPlan(calendarPlan);
    localStorage.setItem(CALENDAR_PLAN_STORAGE_KEY, JSON.stringify(calendarPlan));
    calendarSyncStatus = calendarCanSync() ? '正在同步计划...' : '已保存到本机。';
    calendarRenderSyncStatus();

    if (calendarCanSync()) {
        try {
            const res = await fetch(calendarSettingsApi(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: CALENDAR_PLAN_KEY,
                    value: calendarPlan,
                    user: calendarSession()?.username || ''
                })
            });
            calendarSyncStatus = res.ok ? '已保存并同步。' : '本机已保存，云端同步被拒绝。';
        } catch {
            calendarSyncStatus = '本机已保存，云端暂不可用。';
        }
    }

    if (render) calendarRender();
    else calendarRenderSyncStatus();
}

function calendarRenderSyncStatus() {
    const el = document.getElementById('calendar-sync-status');
    if (el) el.textContent = calendarSyncStatus;
}

async function openCalendarPlanner() {
    calendarCleanup();
    if (typeof nbCleanup === 'function') nbCleanup();
    const root = document.getElementById('ta-root') || document.getElementById('world-content');
    if (document.getElementById('world-title')) document.getElementById('world-title').textContent = 'Time Architect';
    root.innerHTML = `<div class="ta-shell"><div class="ta-loading">正在打开时间规划...</div></div>`;

    await calendarLoadPlan();
    calendarRender();
    calendarRefreshActivity(false);
    calendarActivityInterval = setInterval(() => calendarRefreshActivity(false), 30000);
    calendarStartClock();
}

function calendarCleanup() {
    if (calendarActivityInterval) {
        clearInterval(calendarActivityInterval);
        calendarActivityInterval = null;
    }
    if (calendarClockInterval) {
        clearInterval(calendarClockInterval);
        calendarClockInterval = null;
    }
}

function calendarStartClock() {
    if (calendarClockInterval) clearInterval(calendarClockInterval);
    calendarClockInterval = setInterval(() => {
        const el = document.getElementById('ta-ribbon-time');
        if (el) el.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
}

function calendarMoveWeek(delta) {
    if (!calendarPlan) return;
    calendarPlan.weekStart = delta === 0
        ? calendarWeekStart(new Date())
        : calendarDatePlus(calendarPlan.weekStart, delta * 7);
    calendarSelectedBlockId = null;
    calendarSavePlan();
    calendarRefreshActivity(false);
}

function calendarRender() {
    if (!calendarPlan) return;
    const root = document.getElementById('ta-root') || document.getElementById('world-content');
    if (!root) return;

    root.innerHTML = `
        <div class="ta-shell${calendarChatOpen ? '' : ' ta-shell--chat-collapsed'}">
            ${calendarSidebarHtml()}
            <div class="ta-main-area">
                ${calendarCurrentPage === 'calendar' ? `
                    ${calendarRibbonHtml()}
                    <main class="ta-calendar">
                        ${calendarCalendarHeadHtml()}
                        ${calendarBoardHtml()}
                    </main>
                ` : calendarPageContentHtml()}
            </div>
            ${calendarChatPanelHtml()}
        </div>
    `;

    calendarRenderActualLayers();
    calendarScrollToWorkingHours();
    calendarScrollChatToBottom();
}

function calendarSetPage(page) {
    calendarCurrentPage = page;
    if (page === 'settings' || page === 'workflow' || page === 'archive' || page === 'profile') {
        calendarChatOpen = false;
    } else {
        calendarChatOpen = true;
    }
    calendarRender();
}

function calendarToggleChat() {
    calendarChatOpen = !calendarChatOpen;
    const shell = document.querySelector('.ta-shell');
    const chat = document.querySelector('.ta-chat');
    const toggle = document.querySelector('.ta-chat__header-toggle');
    if (shell) shell.classList.toggle('ta-shell--chat-collapsed', !calendarChatOpen);
    if (chat) chat.classList.toggle('ta-chat--collapsed', !calendarChatOpen);
    if (toggle) toggle.classList.toggle('ta-chat__header-toggle--collapsed', !calendarChatOpen);
    const chatBtn = document.querySelector('.ta-ribbon__btn--chat');
    if (calendarChatOpen && chatBtn) chatBtn.remove();
    if (!calendarChatOpen && !chatBtn) {
        const ribbonRight = document.querySelector('.ta-ribbon__right');
        if (ribbonRight) {
            ribbonRight.insertAdjacentHTML('beforeend', `<button class="ta-ribbon__btn ta-ribbon__btn--chat" onclick="calendarToggleChat()" title="打开 AI 助手">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                AI
            </button>`);
        }
    }
}

function calendarSetCalendarMode(mode) {
    calendarCalendarMode = ['plan', 'actual', 'compare'].includes(mode) ? mode : 'plan';
    calendarRender();
}

function calendarSetSlotSize(size) {
    calendarSlotSize = [15, 30].includes(size) ? size : 30;
    calendarRender();
}

function calendarScrollChatToBottom() {
    const el = document.getElementById('ta-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
}

function calendarSidebarHtml() {
    const navItems = [
        { key: 'calendar', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1', label: 'Overview' },
        { key: 'settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', label: 'API 设置' },
        { key: 'workflow', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z', label: '工作流视图' },
        { key: 'archive', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: '存档日志' },
        { key: 'profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', label: '用户信息' },
    ];
    const profileName = calendarPlan?.profile?.name || 'Cloud Admin';
    return `
        <nav class="ta-sidebar">
            <div class="ta-sidebar__logo">
                <div class="ta-sidebar__logo-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>
                </div>
                <span class="ta-sidebar__logo-text">Time Architect</span>
            </div>
            <div class="ta-sidebar__nav">
                ${navItems.map(item => `
                    <button class="ta-sidebar__nav-item${calendarCurrentPage === item.key ? ' ta-sidebar__nav-item--active' : ''}" onclick="calendarSetPage('${item.key}')">
                        <span class="ta-sidebar__nav-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${item.icon}"/></svg></span>
                        <span>${calendarEsc(item.label)}</span>
                    </button>
                `).join('')}
            </div>
            <div class="ta-sidebar__profile" onclick="calendarSetPage('profile')">
                <div class="ta-sidebar__avatar">${calendarEsc(profileName.charAt(0).toUpperCase())}</div>
                <div class="ta-sidebar__profile-info">
                    <span class="ta-sidebar__profile-name">${calendarEsc(profileName)}</span>
                    <span class="ta-sidebar__profile-role">Administrator</span>
                </div>
                <span class="ta-sidebar__profile-arrow">›</span>
            </div>
        </nav>
    `;
}

function calendarRibbonHtml() {
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${calendarPad(now.getMonth() + 1)}/${calendarPad(now.getDate())}`;
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const total = calendarPlan.blocks.length;
    const done = calendarPlan.blocks.filter(b => b.status === 'done').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const hasSelection = !!calendarSelectedBlockId;

    return `
        <header class="ta-ribbon">
            <div class="ta-ribbon__left">
                <span class="ta-ribbon__info">
                    <span class="ta-ribbon__info-icon">📅</span>
                    ${calendarEsc(dateStr)}
                </span>
                <span class="ta-ribbon__info">
                    <span class="ta-ribbon__info-icon">🕐</span>
                    <span id="ta-ribbon-time">${calendarEsc(timeStr)}</span>
                </span>
                <span class="ta-ribbon__progress">
                    <span class="ta-ribbon__progress-dot"></span>
                    任务完成情况 ${pct}%
                </span>
            </div>
            <div class="ta-ribbon__right">
                <button class="ta-ribbon__btn" onclick="calendarSavePlan()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    Save
                </button>
                <button class="ta-ribbon__btn ta-ribbon__btn--primary" onclick="calendarShowAddForm()">
                    + Add
                </button>
                <button class="ta-ribbon__btn ta-ribbon__btn--danger" ${hasSelection ? '' : 'disabled'} onclick="calendarDeleteSelectedBlock()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    Delete
                </button>
                <button class="ta-ribbon__btn" ${hasSelection ? '' : 'disabled'} onclick="calendarEditSelectedBlock()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit
                </button>
                ${calendarChatOpen ? '' : `<button class="ta-ribbon__btn ta-ribbon__btn--chat" onclick="calendarToggleChat()" title="打开 AI 助手">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                    AI
                </button>`}
            </div>
        </header>
    `;
}

function calendarShowAddForm() {
    const input = document.getElementById('ta-chat-input');
    if (input) {
        input.value = '/goal ';
        input.focus();
    }
}

function calendarEditSelectedBlock() {
    if (!calendarSelectedBlockId) return;
    const block = calendarPlan.blocks.find(b => b.id === calendarSelectedBlockId);
    if (!block) return;
    const input = document.getElementById('ta-chat-input');
    if (input) {
        input.value = `/adjust ${calendarReadableBlockTitle(block)} `;
        input.focus();
    }
}

function calendarCalendarHeadHtml() {
    const todayIndex = calendarCurrentDayIndex();
    const dayLoads = new Array(7).fill(0);
    calendarPlan.blocks.forEach(b => { dayLoads[b.day] += Math.max(0, b.end - b.start); });

    return `
        <div class="ta-calendar__head">
            <div class="ta-calendar__week-nav">
                <button class="ta-calendar__week-btn" onclick="calendarMoveWeek(-1)" title="上一周">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <span class="ta-calendar__week-label">${calendarEsc(calendarWeekRangeLabel(calendarPlan.weekStart))}</span>
                <button class="ta-calendar__week-btn" onclick="calendarMoveWeek(0)" title="回到本周">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="ta-calendar__week-btn" onclick="calendarMoveWeek(1)" title="下一周">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                </button>
            </div>
            <div class="ta-calendar__day-headers">
                <div class="ta-calendar__time-corner"></div>
                ${CALENDAR_DAYS.map((day, index) => {
                    const dateStr = calendarDateForDay(calendarPlan.weekStart, index);
                    const dayDate = calendarParseDate(dateStr);
                    const dayNum = dayDate ? dayDate.getDate() : '';
                    const monthNum = dayDate ? dayDate.getMonth() + 1 : '';
                    return `
                    <div class="ta-calendar__day-head${index === todayIndex ? ' ta-calendar__day-head--today' : ''}">
                        <span class="ta-calendar__day-name">${calendarEsc(day.short)}</span>
                        <span class="ta-calendar__day-date">${monthNum}/${dayNum}</span>
                    </div>`;
                }).join('')}
            </div>
            <div class="ta-calendar__allday">
                <div class="ta-calendar__allday-label">All day</div>
                ${CALENDAR_DAYS.map(() => `<div class="ta-calendar__allday-cell"></div>`).join('')}
            </div>
        </div>
    `;
}

function calendarChatPanelHtml() {
    const reflections = calendarPlan.reflections || [];
    return `
        <aside class="ta-chat${calendarChatOpen ? '' : ' ta-chat--collapsed'}">
            <div class="ta-chat__header" onclick="calendarToggleChat()">
                <div class="ta-chat__avatar">A</div>
                <div class="ta-chat__header-info">
                    <div class="ta-chat__header-title">AI Assistant</div>
                    <div class="ta-chat__header-status">Online</div>
                </div>
                <span class="ta-chat__header-toggle${calendarChatOpen ? '' : ' ta-chat__header-toggle--collapsed'}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </span>
            </div>
            <div class="ta-chat__body">
                <div class="ta-chat__messages" id="ta-chat-messages">
                    <div class="ta-chat__bubble ta-chat__bubble--ai">
                        Hello! How can I help you today?
                        <span class="ta-chat__bubble-time">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    ${reflections.map(r => calendarChatReflectionHtml(r)).join('')}
                </div>
                <div class="ta-chat__chips">
                    <button class="ta-chat__chip" onclick="calendarInsertCommand('/build-day')">今天怎么做</button>
                    <button class="ta-chat__chip" onclick="calendarInsertCommand('/light-mode')">我累了</button>
                    <button class="ta-chat__chip" onclick="calendarInsertCommand('/estimate')">重新估算</button>
                    <button class="ta-chat__chip" onclick="calendarInsertCommand('/reflect')">复盘</button>
                </div>
                <div class="ta-chat__input-area">
                    <div class="ta-chat__input-wrap">
                        <textarea id="ta-chat-input" class="ta-chat__input" placeholder="Type your message..." rows="1"
                            oninput="calendarDraftText=this.value; this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,80)+'px'"
                            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();calendarSendChatMessage()}">${calendarEsc(calendarDraftText)}</textarea>
                    </div>
                    <button class="ta-chat__send" onclick="calendarSendChatMessage()" title="发送">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                    </button>
                </div>
            </div>
        </aside>
    `;
}

function calendarChatReflectionHtml(reflection) {
    const time = new Date(reflection.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const messages = reflection.messages || [];
    let html = '';
    if (reflection.text) {
        html += `
            <div class="ta-chat__bubble ta-chat__bubble--user">
                ${calendarEsc(reflection.text)}
                <span class="ta-chat__bubble-time">${time}</span>
            </div>
        `;
    }
    if (messages.length) {
        const aiContent = messages.map(m => calendarEsc(String(m))).join('<br>• ');
        html += `
            <div class="ta-chat__bubble ta-chat__bubble--ai">
                ${aiContent.startsWith('• ') ? aiContent : '• ' + aiContent}
                <span class="ta-chat__bubble-time">${time}</span>
            </div>
        `;
    }
    return html;
}

async function calendarSendChatMessage() {
    const input = document.getElementById('ta-chat-input');
    const note = (input?.value || calendarDraftText || '').trim();
    if (!note || !calendarPlan) return;
    calendarDraftText = '';
    if (input) input.value = '';

    const messagesEl = document.getElementById('ta-chat-messages');
    if (messagesEl) {
        const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        messagesEl.insertAdjacentHTML('beforeend', `
            <div class="ta-chat__bubble ta-chat__bubble--user">
                ${calendarEsc(note)}
                <span class="ta-chat__bubble-time">${time} ✓</span>
            </div>
        `);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    await calendarApplyCoachNote(note);
    calendarRender();
}

function calendarPageContentHtml() {
    switch (calendarCurrentPage) {
        case 'settings': return `<div class="ta-page"><h1 class="ta-page__title">API 设置</h1>${calendarMemoryHtml()}</div>`;
        case 'workflow': return `<div class="ta-page"><h1 class="ta-page__title">工作流视图</h1>${calendarGoalsHtml()}</div>`;
        case 'archive': return `<div class="ta-page"><h1 class="ta-page__title">存档日志</h1><div class="ta-page__card" id="calendar-activity-panel">${calendarActivityHtml()}</div></div>`;
        case 'profile': return `<div class="ta-page"><h1 class="ta-page__title">用户信息</h1>${calendarProfileHtml()}</div>`;
        default: return `<div class="ta-page"><h1 class="ta-page__title">Overview</h1>${calendarGoalsHtml()}</div>`;
    }
}

function calendarGeminiDefaultMessage(firstTask, health) {
    if (health.risk !== 'low') {
        return '今天先别硬冲满负荷。我会先挑战 Opus 的乐观估计：哪些任务被低估、哪里缺恢复、哪里需要替代方案。目标是不断线，不自毁。';
    }
    if (firstTask) {
        return `今天先抓住 ${calendarMinutesToTime(firstTask.start)} 的「${calendarReadableBlockTitle(firstTask)}」。做完写下实际耗时，系统会拿它校准下次估时。`;
    }
    return '先告诉我今天的目标和身体状态。我会先挑出计划里的危险假设，再让 Opus 做最终排程，不会为了填满时间而排任务。';
}

function calendarGeminiMessageFromLatest(reflection) {
    const messages = reflection.messages || [];
    const feasibility = messages.find(msg => /Feasibility|不可|缺口|overload|过载/i.test(msg));
    if (feasibility) return `${String(feasibility).slice(0, 150)} 下一步是砍范围、延 deadline，或者承认这是高风险冲刺。`;
    const first = messages.find(Boolean);
    return first ? String(first).slice(0, 190) : '已收到。下一步我会把它转成今天做什么、为什么这样排、崩了怎么办。';
}

function calendarAgentStackHtml() {
    return `
        <div class="ta-page__card">
            <h3>模型团队</h3>
            ${CALENDAR_AGENT_ROLES.map(role => `
                <div style="margin-bottom:8px;padding:8px;border:1px solid var(--ta-border);border-radius:var(--ta-radius-sm)">
                    <strong style="color:var(--ta-text);font-size:13px">${calendarEsc(role.label)} · ${calendarEsc(role.model)}</strong>
                    <div style="color:var(--ta-text-muted);font-size:12px;margin-top:2px">${calendarEsc(role.job)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function calendarHealthStageHtml() {
    const health = calendarHealthPlan();
    return `
        <div class="ta-health-grid">
            <div class="ta-health-item">
                <span>睡眠保护</span>
                <strong>${calendarEsc(health.sleepWindow)}</strong>
                <p>${calendarEsc(health.sleepDetail)}</p>
            </div>
            <div class="ta-health-item">
                <span>今日运动 / 恢复</span>
                <strong>${calendarEsc(health.movement)}</strong>
                <p>${calendarEsc(health.recovery)}</p>
            </div>
            <div class="ta-health-item">
                <span>硬约束</span>
                <strong>${calendarEsc(health.riskLabel)}风险</strong>
                <p>${calendarEsc(health.rule)}</p>
            </div>
        </div>
    `;
}

function calendarTodayBlocks(plan = calendarPlan) {
    const todayIndex = calendarCurrentDayIndex(plan);
    if (todayIndex < 0) return [];
    return (plan.blocks || [])
        .filter(block => block.day === todayIndex)
        .sort((a, b) => a.start - b.start || a.end - b.end);
}

function calendarTaskPredictions(limit = 5) {
    const today = calendarTodayBlocks();
    const source = today.length
        ? today
        : calendarPlan.blocks.slice().sort((a, b) => a.day - b.day || a.start - b.start);
    return source
        .filter(block => CALENDAR_PRODUCTIVE_CATEGORIES.has(block.category) || ['rest', 'life'].includes(block.category))
        .slice(0, limit)
        .map(calendarTaskPredictionForBlock);
}

function calendarTaskPredictionForBlock(block) {
    const duration = Math.max(15, block.end - block.start);
    const title = String(block.title || '').toLowerCase();
    const profile = calendarPlan.profile || calendarDefaultProfile();
    const failures = (profile.commonFailureModes || []).join(' ').toLowerCase();
    let bufferRatio = 0.18;
    let confidence = '中';

    if (['deep', 'study'].includes(block.category)) bufferRatio = 0.28;
    if (/ielts|雅思|mock|模考|writing|写作|deadline|ddl|项目|project/i.test(title)) bufferRatio = 0.42;
    if (block.source === 'manual') {
        bufferRatio += 0.08;
        confidence = '低';
    }
    if (/underestimating|低估/.test(failures)) bufferRatio += 0.08;
    if (duration >= 90 && ['deep', 'study'].includes(block.category)) confidence = '中';
    if (block.category === 'rest' || block.category === 'life') {
        bufferRatio = 0.12;
        confidence = '高';
    }

    const safeMinutes = Math.ceil((duration * (1 + bufferRatio)) / 5) * 5;
    const overrun = Math.round(bufferRatio * 100);
    return {
        taskId: block.id,
        title: calendarReadableBlockTitle(block),
        type: calendarTaskTypeLabel(block),
        realisticMinutes: duration,
        safeMinutes,
        confidence,
        bufferRatio,
        overrunText: `+${overrun}%`,
        reason: calendarPredictionReason(block, safeMinutes)
    };
}

function calendarTaskTypeLabel(block) {
    const title = String(block.title || '').toLowerCase();
    if (/ielts|雅思|writing|reading|listening|speaking|模考/.test(title)) return '考试训练';
    if (block.category === 'deep') return '项目深度';
    if (block.category === 'study') return '学习';
    if (block.category === 'workout') return '运动';
    if (block.category === 'reflection') return '复盘';
    if (block.category === 'admin') return '事务';
    return calendarCategoryInfo(block.category).label;
}

function calendarPredictionReason(block, safeMinutes) {
    if (/writing|写作/i.test(block.title || '')) return '写作本体之外必须留 correction 和整理时间。';
    if (/模考|mock/i.test(block.title || '')) return '模考后如果不复盘，时间块价值会打折。';
    if (['deep', 'study'].includes(block.category)) return `高认知任务按 ${safeMinutes} 分钟安全排，避免虚假乐观。`;
    if (block.category === 'workout') return '运动后要留低刺激恢复，不默认接高认知任务。';
    return '按当前计划块和 Henry 的低估风险加 buffer。';
}

function calendarTaskPredictionCardHtml() {
    const predictions = calendarTaskPredictions(4);
    return `
        <div class="ta-card">
            <h3>任务时间预测</h3>
            ${predictions.length ? `
                <div class="ta-prediction-list">
                    ${predictions.map(item => `
                        <div class="ta-prediction-item">
                            <strong>${calendarEsc(item.title)}</strong>
                            <span>${calendarEsc(item.type)} · ${item.realisticMinutes}m → ${item.safeMinutes}m</span>
                            <small>${calendarEsc(item.overrunText)} · ${calendarEsc(item.confidence)}</small>
                        </div>
                    `).join('')}
                </div>
            ` : '<div class="ta-empty">还没有可预测任务。先建立目标或添加时间块。</div>'}
        </div>
    `;
}

function calendarWorkloadLedger() {
    const profile = calendarPlan.profile || calendarDefaultProfile();
    const weeklyCapacityHours = Math.max(1, Number(profile.weeklyCapacityHours) || 10);
    const minutesByCategory = calendarPlan.blocks.reduce((acc, block) => {
        acc[block.category] = (acc[block.category] || 0) + Math.max(0, block.end - block.start);
        return acc;
    }, {});
    const plannedHours = calendarRoundHours(Object.values(minutesByCategory).reduce((sum, minutes) => sum + minutes, 0) / 60);
    const deepWorkHours = calendarRoundHours(((minutesByCategory.deep || 0) + (minutesByCategory.study || 0)) / 60);
    const healthHours = calendarRoundHours(((minutesByCategory.workout || 0) + (minutesByCategory.rest || 0) + (minutesByCategory.recovery || 0)) / 60);
    const adminHours = calendarRoundHours(((minutesByCategory.admin || 0) + (minutesByCategory.life || 0) + (minutesByCategory.reflection || 0)) / 60);
    const bufferHours = calendarRoundHours(Math.max(0, weeklyCapacityHours - plannedHours));
    const loadRatio = plannedHours / weeklyCapacityHours;
    const overloadRisk = loadRatio > 1 ? 'high' : loadRatio > 0.84 ? 'medium' : 'low';
    const loadPercent = Math.round(loadRatio * 100);
    return {
        weeklyCapacityHours,
        plannedHours,
        deepWorkHours,
        healthHours,
        adminHours,
        bufferHours,
        loadRatio,
        loadPercent,
        loadPercentText: `${loadPercent}%`,
        overloadRisk,
        reason: overloadRisk === 'high'
            ? '这周已经超过可用容量，需要砍目标、延 deadline 或明确接受冲刺风险。'
            : overloadRisk === 'medium'
                ? '容量接近上限，继续加任务前要先保护 buffer。'
                : '容量还没有爆，但仍要看高认知任务是否堆太密。'
    };
}

function calendarRoundHours(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function calendarWorkloadLedgerCardHtml() {
    const ledger = calendarWorkloadLedger();
    return `
        <div class="ta-card">
            <h3>工作量账本</h3>
            <div class="ta-meter ${calendarEsc(ledger.overloadRisk)}">
                <span style="width:${Math.min(100, ledger.loadPercent)}%"></span>
            </div>
            <div class="ta-ledger-grid">
                <div><span>容量</span><strong>${ledger.weeklyCapacityHours}h</strong></div>
                <div><span>已排</span><strong>${ledger.plannedHours}h</strong></div>
                <div><span>深度</span><strong>${ledger.deepWorkHours}h</strong></div>
                <div><span>Buffer</span><strong>${ledger.bufferHours}h</strong></div>
            </div>
            <p>${calendarEsc(ledger.reason)}</p>
        </div>
    `;
}

function calendarHealthPlan() {
    const profile = calendarPlan.profile || calendarDefaultProfile();
    const today = calendarTodayBlocks();
    const ledger = calendarWorkloadLedger();
    const sleepHours = calendarSleepHours(profile.sleepWindow);
    const lateDeep = today.filter(block => ['deep', 'study'].includes(block.category) && block.start >= 20 * 60);
    const workout = today.find(block => block.category === 'workout');
    const rest = today.find(block => ['rest', 'recovery'].includes(block.category));
    const risk = ledger.overloadRisk === 'high' || lateDeep.length >= 2 || sleepHours < 7 ? 'high'
        : ledger.overloadRisk === 'medium' || lateDeep.length ? 'medium'
            : 'low';
    return {
        risk,
        riskLabel: risk === 'high' ? '高' : risk === 'medium' ? '中' : '低',
        sleepWindow: profile.sleepWindow || '23:30-08:00',
        sleepDetail: sleepHours ? `约 ${sleepHours.toFixed(1)}h；睡眠不能被学习和项目吞掉。` : '睡眠窗口待校准。',
        movement: workout ? calendarReadableBlockTitle(workout) : '今天暂无运动块',
        recovery: rest ? calendarReadableBlockTitle(rest) : (lateDeep.length ? '晚上有高认知任务，建议补一个轻复盘或恢复块。' : '恢复压力正常。'),
        rule: risk === 'high'
            ? '今天不建议 sprint；先降级成 light-mode 或砍掉一块深度任务。'
            : risk === 'medium'
                ? '可以推进，但不要把晚上继续当无限 buffer。'
                : '健康约束暂时稳定，继续用真实耗时校准。'
    };
}

function calendarSleepHours(range) {
    const match = String(range || '').match(/(\d{1,2}):(\d{2})\s*[-~—]\s*(\d{1,2}):(\d{2})/);
    if (!match) return 0;
    const start = Number(match[1]) * 60 + Number(match[2]);
    let end = Number(match[3]) * 60 + Number(match[4]);
    if (end <= start) end += CALENDAR_DAY_MINUTES;
    return (end - start) / 60;
}

function calendarHealthPlanCardHtml() {
    const health = calendarHealthPlan();
    return `
        <div class="ta-card">
            <h3>健康安排</h3>
            <div class="ta-health-lines">
                <div><span>睡眠</span><strong>${calendarEsc(health.sleepWindow)}</strong><small>${calendarEsc(health.sleepDetail)}</small></div>
                <div><span>运动</span><strong>${calendarEsc(health.movement)}</strong><small>${calendarEsc(health.recovery)}</small></div>
                <div><span>规则</span><strong class="ta-risk-${calendarEsc(health.risk)}">${calendarEsc(health.riskLabel)}风险</strong><small>${calendarEsc(health.rule)}</small></div>
            </div>
        </div>
    `;
}

function calendarRiskFlagsCardHtml() {
    const checks = calendarAnalyzePlan().slice(0, 4);
    return `
        <div class="ta-card">
            <h3>风险提醒</h3>
            <div class="ta-risk-list">
                ${checks.map(item => `<div class="ta-risk-item ${item.level}">${calendarEsc(item.text)}</div>`).join('')}
            </div>
        </div>
    `;
}

function calendarPredictionAccuracyText() {
    if (calendarActivity.loadedAt && !calendarActivity.locked && !calendarActivity.error) {
        const summary = calendarActivitySummary();
        if (summary.adherence !== null) return `${Math.round(summary.adherence * 100)}%`;
    }
    return calendarPlan.reflections.length >= 3 ? '校准中' : '待校准';
}

function calendarCouncilTranscriptCompactHtml() {
    const checks = calendarAnalyzePlan().slice(0, 2);
    const latest = calendarPlan.reflections[calendarPlan.reflections.length - 1];
    const rows = [
        { speaker: 'Gemini', role: '挑战者', text: latest?.text ? `挑战输入里的危险假设：${latest.text.slice(0, 80)}` : '等待 Henry 输入今天状态和目标；我会先找乐观估计、漏掉的恢复和替代方案。', accepted: true },
        { speaker: 'Opus', role: '主规划', text: '阅读 Gemini 的 challenge 后，再估任务耗时和健康容量，做最终排程裁决。', accepted: true },
        { speaker: 'DeepSeek', role: '便宜审计', text: checks[0]?.text || '当前暂无明显红旗，继续观察低估和过载。', accepted: Boolean(checks[0]) },
        { speaker: 'Gemini', role: '用户解释', text: '如果 Opus 采纳或拒绝 challenge，我负责把原因说清楚：今天做什么、为什么这样排、崩了怎么办。', accepted: true }
    ];
    return `
        <div class="ta-page__card">
            <h3>会诊记录</h3>
            <div class="ta-council-list">
                ${rows.map(row => `
                    <div class="ta-council-row">
                        <div class="ta-council-head">
                            <strong>${calendarEsc(row.speaker)}</strong>
                            <span>${calendarEsc(row.role)}</span>
                            <em class="${row.accepted ? 'accepted' : ''}">${row.accepted ? 'accepted' : 'watching'}</em>
                        </div>
                        <p>${calendarEsc(row.text)}</p>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function calendarScrollToWorkingHours() {
    const scroller = document.getElementById('calendar-board-scroll');
    if (!scroller || scroller.dataset.scrolled) return;
    scroller.dataset.scrolled = '1';
    scroller.scrollTop = Math.max(0, (7 * 60 / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT - 24);
}

function calendarBoardHtml() {
    return `
        <div class="ta-calendar__scroll" id="calendar-board-scroll">
            <div class="ta-calendar__board">
                <div class="ta-calendar__time-axis">${calendarTimeAxisHtml()}</div>
                ${CALENDAR_DAYS.map((day, index) => calendarDayColumnHtml(index)).join('')}
            </div>
        </div>
    `;
}

function calendarTimeAxisHtml() {
    let html = '';
    for (let hour = 0; hour < 24; hour++) {
        const top = (hour * 60 / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
        html += `<div class="ta-calendar__time-label" style="top:${top}px">${calendarPad(hour)}:00</div>`;
    }
    return html;
}

function calendarDayColumnHtml(dayIndex) {
    const showActual = calendarCalendarMode === 'actual' || calendarCalendarMode === 'compare';
    const showPlan = calendarCalendarMode === 'plan' || calendarCalendarMode === 'compare';
    const blocks = showPlan ? calendarPlan.blocks
        .filter(block => block.day === dayIndex)
        .sort((a, b) => a.start - b.start || a.end - b.end) : [];
    const today = dayIndex === calendarCurrentDayIndex();
    const nowTop = today ? (calendarNowMinutes() / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT : null;
    return `
        <div class="ta-calendar__day-col${today ? ' ta-calendar__day-col--today' : ''}" id="calendar-day-${dayIndex}">
            <div class="ta-actual-layer" id="calendar-actual-layer-${dayIndex}"></div>
            ${today && nowTop !== null ? `<div class="ta-calendar__now-line" style="top:${nowTop}px"></div>` : ''}
            ${blocks.map(calendarBlockHtml).join('')}
        </div>
    `;
}

function calendarBlockHtml(block) {
    const info = calendarCategoryInfo(block.category);
    const top = (block.start / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
    const duration = block.end - block.start;
    const height = Math.max(24, (duration / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT - 2);
    const selected = block.id === calendarSelectedBlockId;
    const statusIcon = block.status === 'done' ? '✓' : block.status === 'missed' ? '✗' : '';
    const compactClass = duration <= 30 ? ' compact' : '';
    return `
        <button class="ta-block${selected ? ' selected' : ''}${compactClass}"
            onclick="calendarSelectBlock('${calendarEsc(block.id)}')"
            title="${calendarEsc(calendarBlockTitle(block))}"
            style="top:${top}px;height:${height}px;--cat-color:${info.color}">
            ${statusIcon ? `<span class="ta-block__status">${statusIcon}</span>` : ''}
            <span class="ta-block__title">${calendarEsc(calendarReadableBlockTitle(block))}</span>
            <span class="ta-block__time">${calendarEsc(calendarMinutesToTime(block.start))}</span>
            <span class="ta-block__tooltip">${calendarBlockTooltipHtml(block)}</span>
        </button>
    `;
}

function calendarBlockTitle(block) {
    const info = calendarCategoryInfo(block.category);
    const goal = calendarPlan?.goals?.find(item => item.id === block.goalId);
    const parts = [
        `${calendarReadableBlockTitle(block)} · ${calendarMinutesToTime(block.start)}-${calendarMinutesToTime(block.end)}`,
        `类型：${info.label}`,
        goal ? `目标：${goal.title}` : '',
        `行动：${calendarBlockExactAction(block)}`,
        `产出：${calendarBlockOutput(block)}`,
        `被打断：${calendarBlockFallback(block)}`
    ].filter(Boolean);
    return parts.join('\n');
}

function calendarReadableBlockTitle(block) {
    return String(block?.title || '未命名时间块')
        .replace(/^IELTS\s+/i, 'IELTS ')
        .trim()
        .slice(0, 52);
}

function calendarBlockNaturalSummary(block) {
    const output = calendarBlockOutput(block);
    const title = String(block?.title || '').toLowerCase();
    if (/daily|每日|复盘|reflection/.test(title)) return '记录完成、卡点和明天要保护的一块时间。';
    if (/writing task 2|写作/.test(title)) return '限时写作后立刻纠错，留下可复用的改进清单。';
    if (/reading|阅读|精读/.test(title)) return '做一组限时阅读，把错题原因写进 error log。';
    if (/listening|听力|跟听/.test(title)) return '听写/跟读一组材料，标出漏听和连读问题。';
    if (/speaking|口语|录音/.test(title)) return '录一轮口语回答，回听并改掉最明显的问题。';
    if (/模考|mock/.test(title)) return '按考试节奏完成一段模考，并马上标记薄弱点。';
    if (/训练|力量|有氧|长走/.test(title)) return '完成训练或长走，保护恢复，不用额外加码。';
    if (/备餐|体重/.test(title)) return '更新体重趋势，准备下一轮饮食和训练条件。';
    if (/补救/.test(title)) return '只做最小补救动作，让计划重新接上线。';
    if (/奖励|休息/.test(title)) return '明确开始和结束的奖励休息，不吞掉后续安排。';
    if (block.note) return block.note;
    return output ? `完成：${output}` : '完成这个时间块定义的一个明确小产出。';
}

function calendarBlockExactAction(block) {
    if (block.exactAction) return block.exactAction;
    const title = String(block?.title || '').toLowerCase();
    if (/writing task 2|写作/.test(title)) return '40 分钟完成一篇 Task 2，剩余时间检查结构、论证、语法和例子。';
    if (/reading|阅读|精读/.test(title)) return '完成一篇限时阅读，标出错题类型、定位句和误判原因。';
    if (/listening|听力|跟听/.test(title)) return '完成一组听力/跟听，记录漏听、拼写和同义替换问题。';
    if (/speaking|口语|录音/.test(title)) return '选择 2-3 个题目录音回答，回听并重说一遍最差的问题。';
    if (/词汇|错题/.test(title)) return '复习错题本和高频词，删除已经掌握的项，保留真正会错的项。';
    if (/模考复盘/.test(title)) return '回看模考错题，给每个错误写一个可执行修正动作。';
    if (/半套模考|mock|模考/.test(title)) return '按计时完成半套模考，不中途查答案，结束后先标记不确定题。';
    if (/每日|复盘|reflection/.test(title)) return '回答：完成了什么、没完成什么、原因、精力 1-10、明天保护哪一块。';
    if (/补救/.test(title)) return '从没完成的任务里切一个 30 分钟以内的最小动作，只恢复节奏。';
    if (/奖励|休息/.test(title)) return '离开工作界面，做一个明确结束的低刺激休息。';
    if (block.note) return block.note;
    return `推进「${calendarReadableBlockTitle(block)}」，结束前写下实际产出和下一步。`;
}

function calendarBlockOutput(block) {
    if (block.output) return block.output;
    const title = String(block?.title || '').toLowerCase();
    if (/writing task 2|写作/.test(title)) return '1 篇文章 + 5 条纠错 notes';
    if (/reading|阅读|精读/.test(title)) return '1 组阅读题 + 错题原因表';
    if (/listening|听力|跟听/.test(title)) return '1 组听力记录 + 漏听词表';
    if (/speaking|口语|录音/.test(title)) return '2-3 段录音 + 3 个口语修正点';
    if (/词汇|错题/.test(title)) return '更新后的 error log';
    if (/模考/.test(title)) return '模考结果 + 薄弱点列表';
    if (/每日|复盘/.test(title)) return '今日复盘 + 明日一个保护块';
    if (/训练|力量|有氧|长走/.test(title)) return '完成训练记录';
    if (/备餐|体重/.test(title)) return '体重趋势 + 备餐/饮食安排';
    if (/补救/.test(title)) return '一个最小可交付动作完成';
    if (/奖励|休息/.test(title)) return '恢复完成，按时回到下一个块';
    return block.note || '一个明确产出';
}

function calendarBlockFallback(block) {
    if (block.ifInterrupted) return block.ifInterrupted;
    const title = String(block?.title || '').toLowerCase();
    if (/writing task 2|写作/.test(title)) return '只完成 outline + intro，完整文章移到下一块。';
    if (/模考/.test(title)) return '保留已完成部分，下一块先复盘错题再继续。';
    if (/复盘/.test(title)) return '只记三件事：完成、没完成、明天保护块。';
    return '保留当前进度，下一次从最小动作继续，不整块作废。';
}

function calendarBlockTooltipHtml(block) {
    const info = calendarCategoryInfo(block.category);
    const goal = calendarPlan?.goals?.find(item => item.id === block.goalId);
    return `
        <strong>${calendarEsc(calendarReadableBlockTitle(block))}</strong>
        <em>${calendarEsc(calendarMinutesToTime(block.start))}-${calendarEsc(calendarMinutesToTime(block.end))} · ${calendarEsc(info.label)}</em>
        ${goal ? `<span>目标：${calendarEsc(goal.title)}</span>` : ''}
        <span>${calendarEsc(calendarBlockExactAction(block))}</span>
    `;
}

function calendarArchitectIntroHtml() {
    const coreCommands = ['/goal', '/reflect', '/catch-up', '/audit', '/light-mode', '/reset', '/memory'];
    return `
        <div class="ta-page__card">
            <h3>命令参考</h3>
            <div class="ta-flow-steps">
                <span>目标</span><span>→</span><span>工作量</span><span>→</span><span>可行性</span><span>→</span><span>时间块</span><span>→</span><span>反馈</span>
            </div>
            <div class="ta-cmd-grid">
                ${coreCommands.map(cmd => `<button onclick="calendarInsertCommand('${calendarEsc(cmd)}')">${calendarEsc(cmd)}</button>`).join('')}
            </div>
        </div>
    `;
}

function calendarCoachHtml() {
    const latest = calendarPlan.reflections[calendarPlan.reflections.length - 1];
    return `
        <div class="ta-page__card">
            <h3>最近反馈</h3>
            <div class="ta-coach-output">
                ${latest ? calendarReflectionHtml(latest) : '<p>用 AI 命令栏输入目标或命令开始规划。</p>'}
            </div>
        </div>
    `;
}

function calendarInsertCommand(command, targetId = '') {
    const input = targetId
        ? document.getElementById(targetId)
        : document.getElementById('ta-chat-input');
    const current = input?.value || calendarDraftText || '';
    const prefix = current.trim() ? `${current.trim()}\n` : '';
    calendarDraftText = `${prefix}${command} `;
    if (input) {
        input.value = calendarDraftText;
        input.focus();
    }
}

function calendarReflectionHtml(reflection) {
    const messages = reflection.messages || [];
    return `
        <div class="ta-reflection">
            <span>${calendarEsc(new Date(reflection.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
            ${messages.length ? `<ul>${messages.map(msg => `<li>${calendarEsc(msg)}</li>`).join('')}</ul>` : '<p>已记录。</p>'}
        </div>
    `;
}

function calendarManualHtml() {
    const dayOptions = CALENDAR_DAYS.map((day, index) => `<option value="${index}">${calendarEsc(day.label)}</option>`).join('');
    const categoryOptions = Object.entries(CALENDAR_CATEGORIES)
        .map(([key, item]) => `<option value="${key}">${calendarEsc(item.label)}</option>`)
        .join('');
    return `
        <div class="ta-page__card">
            <h3>手动加块</h3>
            <div class="ta-manual-grid">
                <input id="calendar-manual-title" placeholder="标题">
                <select id="calendar-manual-day">${dayOptions}</select>
                <input id="calendar-manual-start" type="time" value="20:00">
                <input id="calendar-manual-duration" type="number" min="15" max="360" step="15" value="60" title="分钟">
                <select id="calendar-manual-category">${categoryOptions}</select>
                <button onclick="calendarAddManualBlock()">添加</button>
            </div>
        </div>
    `;
}

function calendarProfileHtml() {
    const profile = calendarPlan.profile || calendarDefaultProfile();
    const energy = profile.energyPattern || {};
    return `
        <div class="ta-page__card">
            <h3>Profile</h3>
            <div class="ta-form-grid">
                <label>名字<input id="calendar-profile-name" value="${calendarEsc(profile.name)}"></label>
                <label>时区<input id="calendar-profile-timezone" value="${calendarEsc(profile.timezone)}"></label>
                <label>每周可用小时<input id="calendar-profile-capacity" type="number" min="1" max="80" value="${calendarEsc(profile.weeklyCapacityHours)}"></label>
                <label>计划风格<select id="calendar-profile-style">
                    <option value="hybrid"${profile.planningStyle === 'hybrid' ? ' selected' : ''}>混合</option>
                    <option value="strict"${profile.planningStyle === 'strict' ? ' selected' : ''}>严格</option>
                    <option value="flexible"${profile.planningStyle === 'flexible' ? ' selected' : ''}>灵活</option>
                </select></label>
                <label>睡眠窗口<input id="calendar-profile-sleep" value="${calendarEsc(profile.sleepWindow)}"></label>
                <label>高专注时段<input id="calendar-profile-focus" value="${calendarEsc(energy.highFocusTime || '')}"></label>
                <label>低能量时段<input id="calendar-profile-low" value="${calendarEsc(energy.lowEnergyTime || '')}"></label>
                <label>常见失败模式<input id="calendar-profile-failures" value="${calendarEsc((profile.commonFailureModes || []).join(', '))}"></label>
            </div>
            <button class="ta-btn-primary" onclick="calendarSaveProfileFromForm()">保存 Profile</button>
        </div>
    `;
}

function calendarSaveProfileFromForm() {
    if (!calendarPlan) return;
    const current = calendarPlan.profile || calendarDefaultProfile();
    calendarPlan.profile = calendarCleanProfile({
        ...current,
        name: document.getElementById('calendar-profile-name')?.value || current.name,
        timezone: document.getElementById('calendar-profile-timezone')?.value || current.timezone,
        weeklyCapacityHours: Number(document.getElementById('calendar-profile-capacity')?.value) || current.weeklyCapacityHours,
        planningStyle: document.getElementById('calendar-profile-style')?.value || current.planningStyle,
        sleepWindow: document.getElementById('calendar-profile-sleep')?.value || current.sleepWindow,
        energyPattern: {
            ...current.energyPattern,
            highFocusTime: document.getElementById('calendar-profile-focus')?.value || current.energyPattern.highFocusTime,
            lowEnergyTime: document.getElementById('calendar-profile-low')?.value || current.energyPattern.lowEnergyTime
        },
        commonFailureModes: calendarTextArray(document.getElementById('calendar-profile-failures')?.value, 12, 80)
    });
    calendarPlan.reflections.push(calendarCleanReflection({
        text: 'profile update',
        messages: ['已更新长期 profile；后续排程会按新的可用时间、精力曲线和失败模式计算。'],
        at: new Date().toISOString()
    }));
    calendarSavePlan();
}

function calendarGoalsHtml() {
    const activeGoals = calendarPlan.goals.filter(goal => goal.status === 'active').slice(-8).reverse();
    return `
        <div class="ta-page__card">
            <h3>Goal Contracts</h3>
            <div class="ta-goal-list">
                ${activeGoals.length ? activeGoals.map(goal => {
                    const feasibility = calendarGoalFeasibility(goal);
                    return `
                    <div class="ta-goal-item">
                        <strong>${calendarEsc(goal.title)}</strong>
                        <span>${calendarEsc(goal.type)}${goal.deadline ? ` · ${calendarEsc(goal.deadline)}` : ''}</span>
                        <small>${calendarEsc(feasibility.label)} · ${feasibility.requiredHours}h / ${feasibility.capacityHours}h</small>
                        ${goal.successCriteria ? `<p>${calendarEsc(goal.successCriteria)}</p>` : ''}
                    </div>
                `;}).join('') : '<div class="ta-empty">还没有目标。用 AI 命令栏输入 /goal 建立目标。</div>'}
            </div>
        </div>
    `;
}

function calendarGoalHorizonWeeks(goal) {
    if (goal.target?.weeks) return Math.max(1, Number(goal.target.weeks) || 1);
    if (goal.deadline) {
        const deadline = calendarParseDate(goal.deadline);
        if (deadline) {
            const days = Math.max(1, Math.ceil((deadline - new Date()) / 86400000));
            return Math.max(1, Math.ceil(days / 7));
        }
    }
    return 1;
}

function calendarGoalFeasibility(goal) {
    const profile = calendarPlan?.profile || calendarDefaultProfile();
    const workload = calendarCleanWorkload(goal.estimatedWorkload);
    const requiredHours = Math.round(workload.realisticHours || workload.minimumHours || 0);
    const weeks = calendarGoalHorizonWeeks(goal);
    const capacityHours = Math.round((Number(profile.weeklyCapacityHours) || 10) * weeks);
    const gap = requiredHours - capacityHours;
    let label = 'Feasible with conditions';
    if (!requiredHours) label = 'Estimate pending';
    else if (gap > 0) label = 'Not feasible under current constraints';
    else if (capacityHours - requiredHours < Math.max(5, requiredHours * 0.15)) label = 'Feasible but tight';
    return { requiredHours, capacityHours, gap, weeks, label };
}

function calendarReviewTemplatesHtml() {
    return `
        <div class="ta-page__card">
            <h3>复盘模板</h3>
            <div class="ta-cmd-grid">
                <button onclick="calendarInsertCommand('/reflect 今天完成：；没完成：；原因：；精力 1-10：；明天要保护的时间块：')">每日复盘</button>
                <button onclick="calendarInsertCommand('/catch-up 原计划：；实际：；卡点：；今天还剩可用时间：')">落后补救</button>
                <button onclick="calendarInsertCommand('/audit 检查本周计划是否过载、低效或偏离目标')">计划审计</button>
            </div>
        </div>
    `;
}

function calendarMemoryHtml() {
    const snapshot = calendarMemorySnapshot();
    const apiStore = calendarLoadApiStore();
    const apiConfig = apiStore.profiles.find(item => item.id === apiStore.activeId) || apiStore.profiles[0] || calendarDefaultApiConfig();
    const hasLocalKey = Boolean(apiConfig.apiKey);
    const profileOptions = apiStore.profiles.map(item => {
        const status = item.apiKey ? 'key' : 'no key';
        return `<option value="${calendarEsc(item.id)}"${item.id === apiStore.activeId ? ' selected' : ''}>${calendarEsc(item.name)} · ${calendarEsc(item.model)} · ${status}</option>`;
    }).join('');
    const councilCount = calendarApiProfilesForRequest().length;
    return `
        <div class="ta-page__card" id="calendar-memory-panel">
            <h3>模型设置</h3>
            <div class="ta-form-grid">
                <label>Active API<select id="calendar-api-profile" onchange="calendarSwitchApiProfile(this.value)">${profileOptions}</select></label>
                <label class="ta-toggle"><input id="calendar-api-council-mode" type="checkbox"${apiStore.councilMode ? ' checked' : ''} onchange="calendarToggleCouncilMode()"> 不同模型会诊${councilCount ? ` · ${councilCount} 可用` : ''}</label>
                <label>Name<input id="calendar-api-name" value="${calendarEsc(apiConfig.name)}" placeholder="Gemini / GPT / Claude"></label>
                <label>Mode<select id="calendar-api-mode">
                    <option value="responses"${apiConfig.mode === 'responses' ? ' selected' : ''}>Responses API</option>
                    <option value="chat"${apiConfig.mode === 'chat' ? ' selected' : ''}>Chat Completions</option>
                </select></label>
                <label>Base URL<input id="calendar-api-base" value="${calendarEsc(apiConfig.baseUrl)}" placeholder="https://api.ikuncode.cc/v1"></label>
                <label>Model<input id="calendar-api-model" value="${calendarEsc(apiConfig.model)}" placeholder="claude-opus-4-6"></label>
                <label>API key<input id="calendar-api-key" type="password" placeholder="${hasLocalKey ? '已保存，留空保留' : 'sk-...'}"></label>
                <label class="ta-toggle"><input id="calendar-api-council-enabled" type="checkbox"${apiConfig.councilEnabled ? ' checked' : ''}> 加入会诊</label>
            </div>
            <div class="ta-btn-row">
                <button onclick="calendarSaveApiConfigFromForm()">保存</button>
                <button onclick="calendarCreateApiProfile()">新建</button>
                <button onclick="calendarDeleteApiProfile()">删除</button>
                <button onclick="calendarClearLocalApiKey()">清 key</button>
                <button onclick="calendarCheckArchitectApi()">检查</button>
            </div>
            <div class="ta-api-stack">
                ${apiStore.profiles.map(item => `
                    <button class="${item.id === apiStore.activeId ? 'active' : ''}" onclick="calendarSwitchApiProfile('${calendarEsc(item.id)}')">
                        <strong>${calendarEsc(item.name)}</strong>
                        <span>${calendarEsc(item.model)} · ${item.apiKey ? 'key' : 'no key'}${item.councilEnabled ? ' · council' : ''}</span>
                    </button>
                `).join('')}
            </div>
            <div class="ta-memory-stats">
                <span>Profile ${snapshot.profileFacts.length}</span>
                <span>Goals ${snapshot.goals.length}</span>
                <span>Reflections ${snapshot.reflections.length}</span>
            </div>
            <div class="ta-btn-row">
                <button onclick="calendarExportMemory()">查看 JSON</button>
                <button onclick="calendarClearReflections()">清空复盘</button>
            </div>
            <textarea id="calendar-memory-json" class="ta-json-area" readonly placeholder="点击"查看 JSON""></textarea>
        </div>
    `;
}

function calendarMemorySnapshot() {
    const plan = calendarPlan || calendarDefaultPlan();
    const profile = calendarCleanProfile(plan.profile);
    const profileFacts = [
        ['name', profile.name],
        ['timezone', profile.timezone],
        ['weeklyCapacityHours', `${profile.weeklyCapacityHours}`],
        ['sleepWindow', profile.sleepWindow],
        ['highFocusTime', profile.energyPattern.highFocusTime],
        ['lowEnergyTime', profile.energyPattern.lowEnergyTime],
        ['planningStyle', profile.planningStyle],
        ['failureModes', (profile.commonFailureModes || []).join(', ')]
    ].filter(([, value]) => String(value || '').trim());
    return {
        profileFacts,
        profile,
        goals: plan.goals || [],
        reflections: plan.reflections || [],
        blocks: plan.blocks || []
    };
}

function calendarExportMemory() {
    const el = document.getElementById('calendar-memory-json');
    if (!el) return;
    const snapshot = calendarMemorySnapshot();
    el.value = JSON.stringify({
        profile: snapshot.profile,
        goals: snapshot.goals,
        recentReflections: snapshot.reflections.slice(-20),
        blocks: snapshot.blocks
    }, null, 2);
    el.focus();
    el.select();
}

async function calendarCheckArchitectApi() {
    const apiStore = calendarLoadApiStore();
    const local = calendarLoadApiConfig();
    const requestProfiles = calendarApiProfilesForRequest();
    if (apiStore.councilMode && requestProfiles.length > 1) {
        calendarApiStatus = `不同模型会诊已就绪：${requestProfiles.length} 个模型会先各自给方案，再由主模型综合。`;
        calendarRenderApiStatus();
        return;
    }
    if (apiStore.councilMode && requestProfiles.length === 1) {
        calendarApiStatus = `会诊模式已开启，但当前只有 1 个可用 key；将先按 ${requestProfiles[0].name} 单模型执行。`;
        calendarRenderApiStatus();
        return;
    }
    if (local.apiKey) {
        calendarApiStatus = `本机 BYOK 已配置：${calendarActiveApiLabel(local)}。下一次排程会通过 /api/time-architect 代理调用。`;
        calendarRenderApiStatus();
        return;
    }
    calendarApiStatus = '正在检查 server /api/time-architect...';
    calendarRenderApiStatus();
    try {
        const res = await fetch(CALENDAR_ARCHITECT_API, { cache: 'no-store' });
        const data = await res.json();
        calendarApiStatus = data.configured
            ? `Server API ready: ${data.provider} · ${data.model} · ${data.mode}`
            : `API 未配置：将使用 local fallback。需要 TIME_ARCHITECT_API_KEY 或 OPENAI_API_KEY。`;
    } catch {
        calendarApiStatus = 'API 检查失败：当前使用 local fallback。';
    }
    calendarRenderApiStatus();
}

function calendarRenderApiStatus() {
    const el = document.getElementById('calendar-api-status') || document.getElementById('ta-ribbon-time');
    if (el && el.id === 'calendar-api-status') el.textContent = calendarApiStatus;
}

function calendarParseApiSecretInput(value) {
    const text = String(value || '').trim();
    if (!text.startsWith('{')) return { apiKey: text };
    try {
        const parsed = JSON.parse(text);
        return {
            apiKey: String(parsed.key || parsed.apiKey || '').trim(),
            baseUrl: parsed.url ? calendarNormalizeApiBaseUrl(parsed.url) : '',
            model: String(parsed.model || '').trim()
        };
    } catch {
        return { apiKey: text };
    }
}

function calendarSwitchApiProfile(id) {
    const store = calendarLoadApiStore();
    const next = store.profiles.find(item => item.id === id);
    if (!next) return;
    calendarSaveApiStore({ ...store, activeId: next.id });
    calendarApiStatus = `已切换 API：${calendarActiveApiLabel(next)}`;
    calendarRender();
}

function calendarToggleCouncilMode() {
    const store = calendarLoadApiStore();
    const councilMode = Boolean(document.getElementById('calendar-api-council-mode')?.checked);
    calendarSaveApiStore({ ...store, councilMode });
    const count = calendarApiProfilesForRequest().length;
    calendarApiStatus = councilMode
        ? `不同模型会诊已开启：当前 ${count} 个不同模型有 key 并允许加入。`
        : '不同模型会诊已关闭：只使用当前 Active API。';
    calendarRender();
}

function calendarCreateApiProfile() {
    const store = calendarLoadApiStore();
    const next = calendarDefaultApiConfig({
        name: `API ${store.profiles.length + 1}`,
        councilEnabled: true
    });
    calendarSaveApiStore({
        ...store,
        activeId: next.id,
        profiles: [...store.profiles, next].slice(0, 8)
    });
    calendarApiStatus = '已新建 API 配置。填入 Base URL、model 和 key 后保存即可切换使用。';
    calendarRender();
}

function calendarDeleteApiProfile() {
    const store = calendarLoadApiStore();
    if (store.profiles.length <= 1) {
        calendarApiStatus = '至少保留一个 API 槽位；你可以清除当前 key 或直接覆盖配置。';
        calendarRenderApiStatus();
        return;
    }
    const active = store.profiles.find(item => item.id === store.activeId) || store.profiles[0];
    if (!confirm(`删除 API 配置 "${active.name}"？本机保存的 key 也会一起移除。`)) return;
    const profiles = store.profiles.filter(item => item.id !== active.id);
    calendarSaveApiStore({
        ...store,
        activeId: profiles[0].id,
        profiles
    });
    calendarApiStatus = `已删除 API 配置：${active.name}`;
    calendarRender();
}

function calendarSaveApiConfigFromForm() {
    const existing = calendarLoadApiConfig();
    const secret = calendarParseApiSecretInput(document.getElementById('calendar-api-key')?.value);
    const config = calendarSaveApiConfig({
        name: document.getElementById('calendar-api-name')?.value || existing.name,
        mode: document.getElementById('calendar-api-mode')?.value || existing.mode,
        baseUrl: secret.baseUrl || document.getElementById('calendar-api-base')?.value || existing.baseUrl,
        model: secret.model || document.getElementById('calendar-api-model')?.value || existing.model,
        apiKey: secret.apiKey || existing.apiKey,
        councilEnabled: Boolean(document.getElementById('calendar-api-council-enabled')?.checked)
    });
    const store = calendarLoadApiStore();
    calendarSaveApiStore({
        ...store,
        councilMode: Boolean(document.getElementById('calendar-api-council-mode')?.checked)
    });
    calendarApiStatus = config.apiKey
        ? `本机 BYOK 已保存：${calendarActiveApiLabel(config)}`
        : `本机 API 设置已保存但没有 key；会使用 server key 或 fallback。`;
    const keyInput = document.getElementById('calendar-api-key');
    if (keyInput) keyInput.value = '';
    calendarRender();
}

function calendarClearLocalApiKey() {
    const config = calendarLoadApiConfig();
    config.apiKey = '';
    calendarSaveApiConfig(config);
    calendarApiStatus = `已清除当前 API key：${config.name}。`;
    calendarRenderApiStatus();
    calendarRender();
}

function calendarClearReflections() {
    if (!calendarPlan) return;
    if (!confirm('确定清空 Time Architect 复盘记录？Profile、Goals 和时间块会保留。')) return;
    calendarPlan.reflections = [];
    calendarSavePlan();
}

function calendarSelectedBlockHtml() {
    return '';
}

function calendarSanityHtml() {
    const checks = calendarAnalyzePlan();
    return `
        <div class="ta-page__card">
            <h3>Sanity Check</h3>
            <div class="ta-check-list">
                ${checks.map(item => `<div class="ta-check ${item.level}">${calendarEsc(item.text)}</div>`).join('')}
            </div>
        </div>
    `;
}

function calendarInsightsHtml() {
    const metrics = calendarPlanMetrics();
    const latest = calendarPlan.reflections[calendarPlan.reflections.length - 1];
    const checks = calendarAnalyzePlan().slice(0, 4);
    return `
        <div class="ta-page__card">
            <h3>洞察报告</h3>
            <div class="ta-insight-metrics">
                <div><span>本周</span><strong>${calendarEsc(metrics.totalText)}</strong></div>
                <div><span>高认知</span><strong>${calendarEsc(metrics.focusText)}</strong></div>
                <div><span>目标</span><strong>${metrics.activeGoals}</strong></div>
                <div><span>风险</span><strong>${metrics.riskyGoals}</strong></div>
            </div>
            <p>${calendarEsc(metrics.narrative)}</p>
            ${checks.length ? `<ul>${checks.map(item => `<li>${calendarEsc(item.text)}</li>`).join('')}</ul>` : ''}
            ${latest ? `<p class="ta-muted">最近：${calendarEsc((latest.messages || []).join(' / ').slice(0, 260))}</p>` : ''}
        </div>
    `;
}

function calendarPlanMetrics() {
    const totalMinutes = calendarPlan.blocks.reduce((sum, block) => sum + Math.max(0, block.end - block.start), 0);
    const focusMinutes = calendarPlan.blocks
        .filter(block => ['deep', 'study'].includes(block.category))
        .reduce((sum, block) => sum + Math.max(0, block.end - block.start), 0);
    const activeGoals = calendarPlan.goals.filter(goal => goal.status === 'active');
    const riskyGoals = activeGoals.filter(goal => calendarGoalFeasibility(goal).gap > 0);
    const totalHours = totalMinutes / 60;
    const focusHours = focusMinutes / 60;
    const narrative = activeGoals.length
        ? `当前周历安排了 ${totalHours.toFixed(1)} 小时，其中 ${focusHours.toFixed(1)} 小时属于学习/深度工作。你有 ${activeGoals.length} 个 active goal，${riskyGoals.length} 个目标在当前容量下存在缺口；优先处理缺口目标，不要继续往晚上堆任务。`
        : `当前周历安排了 ${totalHours.toFixed(1)} 小时。还没有 active goal；建议先用 /goal 建立 Goal Contract，再排时间块。`;
    return {
        totalText: `${totalHours.toFixed(1)}h`,
        focusText: `${focusHours.toFixed(1)}h`,
        activeGoals: activeGoals.length,
        riskyGoals: riskyGoals.length,
        narrative
    };
}

function calendarAnalyzePlan() {
    const checks = [];
    const totals = new Array(7).fill(0);
    const productive = new Array(7).fill(0);
    const lateBlocks = [];
    const overlaps = [];

    for (const block of calendarPlan.blocks) {
        const duration = block.end - block.start;
        totals[block.day] += duration;
        if (CALENDAR_PRODUCTIVE_CATEGORIES.has(block.category)) productive[block.day] += duration;
        if (block.end > 23 * 60 || block.start < 6 * 60) lateBlocks.push(block);
    }

    for (let day = 0; day < 7; day++) {
        const blocks = calendarPlan.blocks.filter(block => block.day === day).sort((a, b) => a.start - b.start);
        for (let i = 1; i < blocks.length; i++) {
            if (blocks[i].start < blocks[i - 1].end) overlaps.push(blocks[i]);
        }
    }

    const heavyDay = productive.findIndex(minutes => minutes > 8 * 60);
    if (heavyDay >= 0) {
        checks.push({ level: 'warn', text: `${CALENDAR_DAYS[heavyDay].label} 的高强度安排超过 8 小时，执行风险偏高，建议拆掉一块或换成低强度复盘。` });
    }

    const packedDay = totals.findIndex(minutes => minutes > 12 * 60);
    if (packedDay >= 0) {
        checks.push({ level: 'warn', text: `${CALENDAR_DAYS[packedDay].label} 总安排超过 12 小时，真实生活里很容易被吃掉缓冲。` });
    }

    if (lateBlocks.length) {
        checks.push({ level: 'info', text: `有 ${lateBlocks.length} 个时间块靠近睡眠区间；如果第二天要高强度学习，尽量不要用熬夜补债。` });
    }

    if (overlaps.length) {
        checks.push({ level: 'warn', text: `发现 ${overlaps.length} 个重叠时间块，我会在自动安排时避开，但手动块需要你确认。` });
    }

    calendarPlan.goals.forEach(goal => {
        const feasibility = calendarGoalFeasibility(goal);
        if (feasibility.requiredHours && feasibility.gap > 0) {
            checks.push({ level: 'warn', text: `${goal.title} 需要约 ${feasibility.requiredHours}h，但当前容量约 ${feasibility.capacityHours}h，缺口 ${feasibility.gap}h。需要延长期限、增加投入或降低范围。` });
        } else if (feasibility.requiredHours && feasibility.label === 'Feasible but tight') {
            checks.push({ level: 'info', text: `${goal.title} 可行但很紧：需 ${feasibility.requiredHours}h / 可用 ${feasibility.capacityHours}h，建议保留缓冲并每周复盘。` });
        }
        if (goal.type === 'weight' && goal.target?.kg && goal.target?.weeks) {
            const rate = goal.target.kg / goal.target.weeks;
            if (rate > 1) {
                checks.push({ level: 'warn', text: `减重目标约 ${rate.toFixed(1)}kg/周，偏激进。建议补充身高、体重、体脂、运动基础；避免极端节食，必要时找医生或营养师确认。` });
            } else if (rate > 0.75) {
                checks.push({ level: 'info', text: `减重速度约 ${rate.toFixed(1)}kg/周，属于需要认真管理饮食、训练和睡眠的区间。` });
            }
        }
    });

    const todayIndex = calendarCurrentDayIndex();
    if (todayIndex >= 0 && !calendarActivity.locked && !calendarActivity.error && calendarActivity.loadedAt) {
        const summary = calendarActivitySummary();
        if (summary.plannedElapsedSec > 0 && summary.adherence !== null) {
            checks.push({
                level: summary.adherence >= 0.65 ? 'ok' : 'info',
                text: `今天到目前为止，计划匹配度约 ${Math.round(summary.adherence * 100)}%。`
            });
        }
    }

    if (!checks.length) {
        checks.push({ level: 'ok', text: '当前周历没有明显过载。下一步是每天用真实执行情况校准它。' });
    }
    return checks;
}

function calendarActivityHtml() {
    if (calendarActivity.locked) {
        return `
            <h3>ActivityWatch 对照</h3>
            <div class="ta-empty">登录 Henry 或 admin 后，这里会显示实际活动叠到周历上。</div>
            <button class="ta-btn-primary" onclick="calendarCleanup(); openWorld('sculpture')">去雕像登录</button>
        `;
    }
    if (calendarActivity.error) {
        return `
            <h3>ActivityWatch 对照</h3>
            <div class="ta-check warn">${calendarEsc(calendarActivity.error)}</div>
            <button class="ta-btn-primary" onclick="calendarRefreshActivity(false)">重试</button>
        `;
    }

    const summary = calendarActivitySummary();
    const current = calendarCurrentActivityText();
    const scopeText = calendarActivity.scope === 'week' ? '整周' : '今日';

    return `
        <h3>ActivityWatch 对照</h3>
        <div class="ta-aw-now">
            <span>正在</span>
            <strong>${calendarEsc(current)}</strong>
        </div>
        <div class="ta-aw-stats">
            <div><span>${scopeText}</span><strong>${calendarEsc(summary.actualText)}</strong></div>
            <div><span>已过计划</span><strong>${calendarEsc(summary.plannedText)}</strong></div>
            <div><span>匹配度</span><strong>${summary.adherence === null ? '--' : Math.round(summary.adherence * 100) + '%'}</strong></div>
        </div>
    `;
}

function calendarCurrentActivityText() {
    const devices = calendarActivity.devices || [];
    if (!devices.length) return '暂无在线设备';
    const rules = typeof nbGetRules === 'function' ? nbGetRules() : null;
    const online = devices.filter(device => {
        const diff = (Date.now() - new Date(device.last_seen)) / 60000;
        const ignored = rules && typeof nbIsIgnoredApp === 'function' ? nbIsIgnoredApp(device.current_app, rules) : false;
        return diff < 5 && !device.is_afk && !ignored;
    });
    if (!online.length) return '暂时离开或离线';
    return online.map(device => {
        const doing = typeof nbDeviceStatusLabel === 'function' ? nbDeviceStatusLabel(device, 'online') : (device.current_app || '活动中');
        return `${doing} · ${device.current_app || '未知应用'}`;
    }).join(' / ');
}

function calendarActivitySummary() {
    const todayIndex = calendarCurrentDayIndex();
    const nowMin = calendarNowMinutes();
    if (todayIndex < 0) {
        return { actualText: '--', plannedText: '--', plannedElapsedSec: 0, adherence: null };
    }

    const planBlocks = calendarPlan.blocks
        .filter(block => block.day === todayIndex && CALENDAR_PRODUCTIVE_CATEGORIES.has(block.category))
        .map(block => ({
            ...block,
            elapsedEnd: Math.min(block.end, nowMin)
        }))
        .filter(block => block.elapsedEnd > block.start);

    const plannedElapsedSec = planBlocks.reduce((sum, block) => sum + (block.elapsedEnd - block.start) * 60, 0);
    const actualToday = (calendarActivity.actualBlocks || []).filter(block => block.day === todayIndex);
    const actualSec = actualToday.reduce((sum, block) => sum + (block.end - block.start) * 60, 0);
    let matchedSec = 0;

    actualToday.forEach(actual => {
        planBlocks.forEach(plan => {
            if (!calendarCategoriesCompatible(plan.category, actual.category)) return;
            const overlap = Math.max(0, Math.min(actual.end, plan.elapsedEnd) - Math.max(actual.start, plan.start));
            matchedSec += overlap * 60;
        });
    });

    return {
        actualText: typeof nbFmtDur === 'function' ? nbFmtDur(actualSec) : `${Math.round(actualSec / 60)}分`,
        plannedText: typeof nbFmtDur === 'function' ? nbFmtDur(plannedElapsedSec) : `${Math.round(plannedElapsedSec / 60)}分`,
        plannedElapsedSec,
        adherence: plannedElapsedSec > 0 ? Math.min(1, matchedSec / plannedElapsedSec) : null
    };
}

function calendarCategoriesCompatible(planCategory, actualCategory) {
    if (planCategory === actualCategory) return true;
    if (planCategory === 'study' && actualCategory === 'deep') return true;
    if (planCategory === 'deep' && actualCategory === 'study') return true;
    if (planCategory === 'admin' && ['admin', 'deep'].includes(actualCategory)) return true;
    if (planCategory === 'reflection' && ['admin', 'study', 'deep'].includes(actualCategory)) return true;
    return false;
}

async function calendarRefreshActivity(renderAll = false) {
    if (!document.getElementById('calendar-activity-panel') && !renderAll) return;
    const session = calendarSession();
    if (!session) {
        calendarActivity = { locked: true, scope: 'none', devices: [], actualBlocks: [], loadedAt: null, error: '' };
        calendarRenderActivityParts();
        return;
    }

    calendarActivity = { ...calendarActivity, locked: false, error: '' };
    try {
        if (typeof nbEnsureRulesLoaded === 'function') await nbEnsureRulesLoaded();
        await ensureSiteConfigLoaded?.();

        const isAdmin = session.role === 'admin';
        const today = calendarFormatDate(new Date());
        const startDate = isAdmin ? calendarPlan.weekStart : today;
        const endDate = isAdmin ? calendarDatePlus(calendarPlan.weekStart, 7) : calendarDatePlus(today, 1);
        const startIso = typeof nbLocalDateStartIso === 'function' ? nbLocalDateStartIso(startDate) : new Date(`${startDate}T00:00:00`).toISOString();
        const endIso = typeof nbLocalDateStartIso === 'function' ? nbLocalDateStartIso(endDate) : new Date(`${endDate}T00:00:00`).toISOString();

        const [devices, timeline, events] = await Promise.all([
            nbGet('device_status', 'order=last_seen.desc&limit=100'),
            nbGet('activity_timeline', `started_at=gte.${startIso}&started_at=lt.${endIso}&order=started_at.asc&limit=5000`),
            nbGet('activity_events', `recorded_at=gte.${startIso}&recorded_at=lt.${endIso}&order=recorded_at.asc&limit=5000`)
        ]);

        const enabledDevice = row => !row.device_name || (typeof nbDeviceEnabled !== 'function' || nbDeviceEnabled(row.device_name));
        const visibleDevices = devices
            .filter(row => typeof nbIsInternalDeviceName !== 'function' || !nbIsInternalDeviceName(row.device_name))
            .filter(enabledDevice);
        const rules = typeof nbGetRules === 'function' ? nbGetRules() : null;
        const timelineRows = typeof nbCountableTimeline === 'function'
            ? nbCountableTimeline(timeline.filter(enabledDevice), rules)
            : timeline.filter(enabledDevice);
        const fallbackRows = events
            .filter(enabledDevice)
            .filter(row => !rules || typeof nbShouldCountApp !== 'function' || nbShouldCountApp(row.app_name, rules))
            .map(row => ({ ...row, started_at: row.recorded_at }));
        const rows = timelineRows.length ? timelineRows : fallbackRows;

        calendarActivity = {
            locked: false,
            scope: isAdmin ? 'week' : 'today',
            devices: visibleDevices,
            actualBlocks: calendarRowsToActualBlocks(rows, rules),
            loadedAt: new Date().toISOString(),
            error: ''
        };
    } catch (error) {
        calendarActivity = {
            locked: false,
            scope: 'none',
            devices: [],
            actualBlocks: [],
            loadedAt: new Date().toISOString(),
            error: 'ActivityWatch 暂时读不到，计划本身仍可使用。'
        };
    }

    if (renderAll) calendarRender();
    else calendarRenderActivityParts();
}

function calendarRowsToActualBlocks(rows, rules) {
    return rows.map(row => {
        const startDate = new Date(row.started_at || row.recorded_at || '');
        if (Number.isNaN(startDate.getTime())) return null;
        const day = calendarDayIndexForDate(calendarFormatDate(startDate), calendarPlan.weekStart);
        if (day < 0 || day > 6) return null;
        const start = startDate.getHours() * 60 + startDate.getMinutes();
        const duration = Math.max(0, Number(row.duration_seconds) || 0);
        const end = Math.min(CALENDAR_DAY_MINUTES, start + Math.max(1, Math.round(duration / 60)));
        if (end <= start) return null;
        const category = calendarActivityCategory(row.app_name, rules);
        return {
            day,
            start,
            end,
            category,
            title: row.app_name || 'Activity',
            color: calendarCategoryInfo(category).color
        };
    }).filter(Boolean);
}

function calendarActivityCategory(appName, rules) {
    const cat = rules && typeof nbCategorize === 'function' ? nbCategorize(appName, rules) : 'other';
    if (cat === 'work') return 'deep';
    if (cat === 'browse' || cat === 'comm' || cat === 'system') return 'admin';
    if (cat === 'media') return 'rest';
    return 'deep';
}

function calendarRenderActivityParts() {
    const panel = document.getElementById('calendar-activity-panel');
    if (panel) panel.innerHTML = calendarActivityHtml();
    calendarRenderActualLayers();
}

function calendarRenderActualLayers() {
    if (calendarCalendarMode === 'plan') return;
    for (let day = 0; day < 7; day++) {
        const layer = document.getElementById(`calendar-actual-layer-${day}`);
        if (!layer) continue;
        const blocks = (calendarActivity.actualBlocks || []).filter(block => block.day === day);
        layer.innerHTML = blocks.map(block => {
            const top = (block.start / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
            const height = Math.max(3, ((block.end - block.start) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT);
            const label = `${block.title} · ${calendarMinutesToTime(block.start)}-${calendarMinutesToTime(block.end)}`;
            return `
                <div class="ta-actual-block" title="${calendarEsc(label)}" style="top:${top}px;height:${height}px;background:${block.color}">
                    <span class="ta-actual-tooltip">
                        <strong>${calendarEsc(block.title)}</strong>
                        <em>${calendarEsc(calendarMinutesToTime(block.start))}-${calendarEsc(calendarMinutesToTime(block.end))}</em>
                    </span>
                </div>
            `;
        }).join('');
    }
}

async function calendarApplyCoachNote(noteOverride = '') {
    const input = document.getElementById('ta-chat-input');
    const note = (noteOverride || input?.value || '').trim();
    if (!note || !calendarPlan) return;

    const apiStore = calendarLoadApiStore();
    const requestProfiles = calendarApiProfilesForRequest();
    calendarApiStatus = calendarCanUseArchitectApi()
        ? (apiStore.councilMode && requestProfiles.length > 1
            ? `正在调用 ${requestProfiles.length} 个不同模型会诊...`
            : '正在调用 /api/time-architect...')
        : '使用 local fallback。';
    calendarRenderApiStatus();

    let result = calendarCanUseArchitectApi() ? await calendarCallArchitectApi(note) : null;
    if (!result) {
        result = calendarBuildCoachUpdate(note);
        result.messages = [`输出来源：local fallback（未使用 LLM API）`, ...(result.messages || [])];
    }

    const memoryMessages = (result.memoryCandidates || []).map(item => {
        return `Memory/Profile candidate: ${item.fact || ''} Why it matters: ${item.why || ''} Suggested field: ${item.field || ''}`;
    });
    calendarPlan = calendarCleanPlan(result.plan || calendarPlan);
    calendarPlan.reflections.push(calendarCleanReflection({
        text: note,
        messages: [...(result.messages || []), ...memoryMessages],
        at: new Date().toISOString()
    }));
    calendarDraftText = '';
    calendarSelectedBlockId = null;
    calendarSavePlan();
}

async function calendarCallArchitectApi(note) {
    try {
        const localApiConfig = calendarLoadApiConfig();
        const apiStore = calendarLoadApiStore();
        const clientConfigs = calendarApiProfilesForRequest();
        const res = await fetch(CALENDAR_ARCHITECT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: note,
                plan: calendarPlan,
                user: calendarSession()?.username || 'public',
                clientConfig: localApiConfig,
                clientConfigs,
                council: apiStore.councilMode
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            calendarApiStatus = data.error
                ? `API 不可用：${data.error}，已切回 local fallback。`
                : 'API 不可用，已切回 local fallback。';
            calendarRenderApiStatus();
            return null;
        }
        const sourceLabel = data.api?.source === 'council'
            ? `不同模型会诊 · ${data.api?.participants?.length || clientConfigs.length} 个模型`
            : `${data.api?.source === 'client' ? 'local BYOK' : 'server key'} · ${data.api?.provider || 'custom'} · ${data.api?.model || ''}`;
        calendarApiStatus = `输出来源：${sourceLabel}`;
        calendarRenderApiStatus();
        return {
            plan: data.plan,
            messages: [`输出来源：${sourceLabel}`, ...(data.messages || [])],
            memoryCandidates: data.memoryCandidates || []
        };
    } catch {
        calendarApiStatus = 'API 请求失败，已切回 local fallback。';
        calendarRenderApiStatus();
        return null;
    }
}

function calendarBuildCoachUpdate(note) {
    const plan = calendarCleanPlan(calendarPlan);
    const messages = [];
    const lower = note.toLowerCase();
    let handled = false;

    const command = calendarExtractCommand(note);
    if (command) {
        handled = calendarApplyCommand(plan, command, note, messages);
    }

    calendarApplyProfileSignals(plan, note, messages);

    const weight = calendarParseWeightGoal(note);
    if (weight) {
        handled = true;
        calendarApplyWeightPlan(plan, weight, messages);
    }

    if (/ielts|雅思/i.test(note)) {
        handled = true;
        calendarApplyIeltsPlan(plan, note, messages);
    }

    if (calendarLooksLikeMiss(note)) {
        handled = true;
        calendarApplyRecovery(plan, messages);
    }

    if (calendarLooksLikeAhead(note)) {
        handled = true;
        calendarApplyReward(plan, messages);
    }

    if (!handled || (/deadline|due|ddl|截至|截止|到期/i.test(note) && !/ielts|雅思|kg|kilogram|公斤|千克|减重|减肥|瘦/i.test(note))) {
        calendarApplyGenericPlan(plan, note, messages);
    }

    calendarEnsureDailyReflection(plan, messages);
    calendarRepairOverlaps(plan, messages);

    if (!messages.length) messages.push('已记录你的更新，并保留当前时间表。');
    if (plan.goals.length) {
        const active = plan.goals.filter(goal => goal.status === 'active');
        const infeasible = active.map(goal => ({ goal, feasibility: calendarGoalFeasibilityForPlan(plan, goal) })).filter(item => item.feasibility.gap > 0);
        if (infeasible.length) {
            const item = infeasible[0];
            messages.push(`Feasibility result: ${item.goal.title} 当前不可稳妥完成。需 ${item.feasibility.requiredHours}h，可用 ${item.feasibility.capacityHours}h，缺口 ${item.feasibility.gap}h。`);
        }
    }
    return { plan, messages };
}

function calendarExtractCommand(note) {
    const match = String(note || '').trim().match(/^\/[a-z0-9-]+/i);
    return match ? match[0].toLowerCase() : '';
}

function calendarApplyCommand(plan, command, note, messages) {
    if (command === '/reset') {
        plan.blocks = plan.blocks.filter(block => block.source === 'manual');
        messages.push('已执行 /reset：保留手动块，清理自动排程，回到最小可行计划。');
        return true;
    }
    if (command === '/audit') {
        calendarAnalyzePlanFor(plan).forEach(item => messages.push(`Audit: ${item.text}`));
        return true;
    }
    if (command === '/profile') {
        messages.push('Profile mode: 我会提取长期稳定信息，例如每周容量、精力曲线、固定约束和失败模式。');
        return true;
    }
    if (command === '/memory') {
        messages.push('Memory/Profile candidate: 请告诉我哪条信息要长期保存；我会写入 Profile，而不是把一次性情绪当事实。');
        return true;
    }
    if (command === '/reflect' || command === '/adjust' || command === '/catch-up') {
        messages.push('Adjustment: 我会先判断偏差原因，再决定 keep / move / split / drop / replace / defer。');
        return true;
    }
    if (command === '/build-day') {
        messages.push(calendarTodayPlanSummary(plan));
        return true;
    }
    if (command === '/build-week' || command === '/24-7') {
        messages.push('Weekly Plan: 已把 active goals 映射到本周 24/7 表。深度任务优先放在高能量窗口，复盘和补救放在低认知窗口。');
        return true;
    }
    if (command === '/estimate') {
        messages.push('Workload before calendar: 我会先估算 minimum / realistic / strong hours，再比较可用容量。');
        return true;
    }
    if (command === '/light-mode') {
        calendarApplyLightMode(plan, messages);
        return true;
    }
    if (command === '/sprint') {
        messages.push('Sprint mode: 可以短期冲刺，但会提高过载风险；我会保留睡眠、吃饭和最低恢复窗口。');
        return true;
    }
    return false;
}

function calendarGoalFeasibilityForPlan(plan, goal) {
    const profile = plan.profile || calendarDefaultProfile();
    const workload = calendarCleanWorkload(goal.estimatedWorkload);
    const requiredHours = Math.round(workload.realisticHours || workload.minimumHours || 0);
    const weeks = calendarGoalHorizonWeeks(goal);
    const capacityHours = Math.round((Number(profile.weeklyCapacityHours) || 10) * weeks);
    const gap = requiredHours - capacityHours;
    let label = 'Feasible with conditions';
    if (!requiredHours) label = 'Estimate pending';
    else if (gap > 0) label = 'Not feasible under current constraints';
    else if (capacityHours - requiredHours < Math.max(5, requiredHours * 0.15)) label = 'Feasible but tight';
    return { requiredHours, capacityHours, gap, weeks, label };
}

function calendarAnalyzePlanFor(plan) {
    const original = calendarPlan;
    calendarPlan = plan;
    const checks = calendarAnalyzePlan();
    calendarPlan = original;
    return checks;
}

function calendarTodayPlanSummary(plan) {
    const day = calendarCurrentDayIndex(plan);
    if (day < 0) return "Today's Plan: 当前查看的周不是本周，先切回本周。";
    const blocks = plan.blocks.filter(block => block.day === day).sort((a, b) => a.start - b.start);
    if (!blocks.length) return "Today's Plan: 今天还没有时间块。先用 /goal 或手动加块。";
    return `Today's Plan: ${blocks.slice(0, 6).map(block => `${calendarMinutesToTime(block.start)} ${block.title}`).join('；')}`;
}

function calendarApplyLightMode(plan, messages) {
    const day = calendarCurrentDayIndex(plan);
    if (day < 0) return;
    calendarRemoveSource(plan, 'coach:light-mode');
    const slot = calendarFindNextFreeSlot(plan, 30, [20 * 60, 21 * 60, 9 * 60]);
    if (slot) {
        plan.blocks.push(calendarCleanBlock({
            title: '低强度不断线',
            category: 'reflection',
            day: slot.day,
            start: slot.start,
            end: slot.start + 30,
            source: 'coach:light-mode',
            note: '疲惫时保持链条，不追求高产出。'
        }));
    }
    messages.push('Light mode: 今天改成不断线版本，只保留一个低强度块，不用硬扛高认知任务。');
}

function calendarApplyProfileSignals(plan, note, messages) {
    const lower = String(note || '').toLowerCase();
    const profile = calendarCleanProfile(plan.profile);
    const capacity = calendarParseWeeklyCapacity(note);
    if (capacity) {
        profile.weeklyCapacityHours = capacity;
        messages.push(`Profile updated: 当前每周可用容量设为 ${capacity} 小时；所有 feasibility 都会基于这个数重算。`);
    }
    if (/晚上.*(学不进去|效率低|不适合|崩)|evening.*(cannot|can't|low|bad|tired)/i.test(lower)) {
        if (/记住|保存|save|remember|加入 profile/i.test(note)) {
            profile.energyPattern.lowEnergyTime = '晚上不适合高强度学习';
            profile.energyPattern.bestAdminTime = '晚上适合复盘、整理、准备明天';
            messages.push('Profile updated: 已记录"晚上不适合高强度学习"，以后晚上优先排复盘/轻任务。');
        } else {
            messages.push('Memory/Profile candidate: 你晚上不适合高强度学习。Why it matters: 写作、模考、复杂任务应前移；晚上改成复盘/轻阅读。Should I save this as a long-term profile item?');
        }
    }
    if (/拖延|procrastinat|avoidance|overplanning|underestimating|低估/i.test(lower)) {
        const failures = new Set(profile.commonFailureModes || []);
        if (/低估|underestimating/i.test(lower)) failures.add('underestimating workload');
        if (/拖延|procrastinat|avoidance/i.test(lower)) failures.add('avoidance before unclear tasks');
        if (/过度计划|overplanning/i.test(lower)) failures.add('overplanning');
        profile.commonFailureModes = [...failures].slice(0, 12);
        messages.push('Profile insight: 已把这次反馈纳入失败模式判断；之后会优先拆小任务、写清开始条件和 fallback。');
    }
    plan.profile = profile;
}

function calendarParseWeeklyCapacity(text) {
    const lower = String(text || '').toLowerCase();
    const match = lower.match(/(?:每周|weekly|per week|week)\D{0,12}(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|小時)?/)
        || lower.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|小時)\D{0,12}(?:每周|weekly|per week|week)/);
    if (!match) return null;
    const value = Number(match[1]);
    return value ? Math.max(1, Math.min(80, value)) : null;
}

function calendarParseWeightGoal(text) {
    const lower = text.toLowerCase();
    const kgMatch = lower.match(/(?:lose|减重|减肥|瘦|降低)\s*(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|公斤|千克)/i)
        || lower.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|公斤|千克).*?(?:two|2|二|两|\d+)\s*(?:months?|个月|月|weeks?|周)/i);
    if (!kgMatch) return null;
    const kg = Number(kgMatch[1]);
    const nearby = text.slice(Math.max(0, kgMatch.index || 0));
    const weeks = calendarParseHorizonWeeks(nearby) || 8;
    if (!kg || !weeks) return null;
    return { kg, weeks };
}

function calendarNumberWord(value) {
    const normalized = String(value || '').toLowerCase();
    const words = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
        一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
        七: 7, 八: 8, 九: 9, 十: 10
    };
    if (words[normalized]) return words[normalized];
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function calendarParseHorizonWeeks(text, anchor = '') {
    let lower = String(text || '').toLowerCase();
    if (anchor) {
        const index = lower.indexOf(anchor.toLowerCase());
        if (index >= 0) lower = lower.slice(index, index + 120);
    }
    const numberPattern = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|一|二|两|三|四|五|六|七|八|九|十)';
    const monthMatch = lower.match(new RegExp(`${numberPattern}\\s*(?:months?|个月|月)`, 'i'));
    if (monthMatch) return Math.max(1, calendarNumberWord(monthMatch[1]) * 4);
    const weekMatch = lower.match(new RegExp(`${numberPattern}\\s*(?:weeks?|周|星期)`, 'i'));
    if (weekMatch) return Math.max(1, calendarNumberWord(weekMatch[1]));
    return null;
}

function calendarEnsureGoal(plan, type, title, extra = {}) {
    const existing = plan.goals.find(goal => {
        if (goal.type !== type || goal.status !== 'active') return false;
        return type === 'project' ? goal.title === title : true;
    });
    if (existing) {
        Object.assign(existing, extra, { title: existing.title || title });
        return existing;
    }
    const goal = calendarCleanGoal({
        id: calendarId('goal'),
        type,
        title,
        createdAt: new Date().toISOString(),
        ...extra
    });
    plan.goals.push(goal);
    return goal;
}

function calendarApplyWeightPlan(plan, weight, messages) {
    const rate = weight.kg / weight.weeks;
    const goal = calendarEnsureGoal(plan, 'weight', `${weight.weeks}周减重 ${weight.kg}kg`, {
        target: { kg: weight.kg, weeks: weight.weeks },
        desiredOutcome: `${weight.weeks}周内减重 ${weight.kg}kg，同时保护睡眠、训练恢复和健康。`,
        deadline: calendarDatePlus(calendarFormatDate(new Date()), weight.weeks * 7),
        successCriteria: `平均趋势下降 ${weight.kg}kg；不使用极端节食；训练、备餐、复盘闭环完成。`,
        currentBaseline: '未知：[待提供当前体重、身高、体脂、运动基础后校准]',
        gap: `目标速度约 ${rate.toFixed(1)}kg/周`,
        requiredDeliverables: ['每周 3 次训练', '每周 1 次长走', '每周备餐计划', '每周体重趋势复盘'],
        requiredSkills: ['热量管理', '力量/有氧训练', '恢复管理'],
        estimatedWorkload: {
            minimumHours: Math.round(weight.weeks * 3),
            realisticHours: Math.round(weight.weeks * 5),
            strongHours: Math.round(weight.weeks * 7),
            confidence: 'low until body baseline is known'
        },
        risks: ['目标速度过快', '极端节食风险', '训练恢复不足', '睡眠不足'],
        dependencies: ['当前体重/身高/体脂', '伤病限制', '可训练场地'],
        reviewCheckpoints: ['每周体重趋势', '训练完成率', '睡眠和饥饿感'],
        priority: 'P1',
        weeklyTarget: '3 次训练 + 1 次长走 + 1 次备餐 + 2 次体重/饮食复盘',
        dailyMinimum: '记录体重/饮食趋势或完成 20 分钟低强度活动',
        notes: '默认采用保守训练和复盘模板；精确饮食需要身高、体重、体脂、疾病/伤病限制。'
    });

    calendarRemoveSource(plan, 'coach:weight');
    calendarAddTemplateBlock(plan, 'coach:weight', goal.id, '力量/有氧训练', 'workout', [1, 3, 5], 18 * 60 + 30, 45);
    calendarAddTemplateBlock(plan, 'coach:weight', goal.id, '低强度长走', 'workout', [0], 17 * 60, 45);
    calendarAddTemplateBlock(plan, 'coach:weight', goal.id, '备餐与体重记录', 'life', [0], 19 * 60, 45);
    calendarAddTemplateBlock(plan, 'coach:weight', goal.id, '体重/饮食复盘', 'reflection', [1, 4], 8 * 60, 15);

    const feasibility = calendarGoalFeasibilityForPlan(plan, goal);
    messages.push(`Goal Contract: 减重目标初始估算 realistic ${feasibility.requiredHours}h；当前容量约 ${feasibility.capacityHours}h，${feasibility.label}。`);
    if (rate > 1) {
        messages.push(`减重 ${weight.kg}kg/${weight.weeks}周约 ${rate.toFixed(1)}kg/周，偏激进；先按训练、备餐、复盘排块，不建议用熬夜或极端节食硬顶。`);
    } else {
        messages.push(`已把减重目标拆成每周训练、长走、备餐和体重复盘。当前速度约 ${rate.toFixed(1)}kg/周。`);
    }
}

function calendarApplyIeltsPlan(plan, note, messages) {
    const weeks = calendarParseHorizonWeeks(note, 'ielts') || calendarParseHorizonWeeks(note, '雅思');
    const deadline = weeks ? calendarDatePlus(calendarFormatDate(new Date()), weeks * 7) : '';
    const goal = calendarEnsureGoal(plan, 'ielts', 'IELTS 冲刺', {
        target: weeks ? { weeks } : {},
        desiredOutcome: 'IELTS 目标分数达成，默认假设 Overall 7.0 且 no band below 6.5。',
        deadline,
        successCriteria: '完成诊断、分项训练、写作/口语反馈、模考和错题复盘。',
        currentBaseline: 'unknown, placeholder 6.0 until diagnostic test',
        gap: '待首次模考后校准听说读写差距',
        requiredDeliverables: [
            '1 次 diagnostic test',
            '每周 listening drills',
            '每周 reading timed practice',
            'Task 1 / Task 2 写作反馈循环',
            'Speaking topic bank + recording review',
            '每 1-2 周模考与复盘'
        ],
        requiredSkills: ['listening', 'reading', 'writing task response', 'speaking fluency', 'error log review'],
        estimatedWorkload: {
            minimumHours: 150,
            realisticHours: 220,
            strongHours: 300,
            confidence: 'low until diagnostic test'
        },
        risks: ['baseline unknown', 'writing feedback bottleneck', 'mock review skipped', 'too much passive input'],
        dependencies: ['diagnostic test', 'essay feedback source', 'exam date'],
        reviewCheckpoints: ['diagnostic test', 'weekly error log', 'biweekly mock', 'Sunday plan review'],
        priority: 'P1',
        weeklyTarget: '12-18 小时，覆盖听说读写 + 模考复盘',
        dailyMinimum: '30 分钟错题/词汇/跟读，保持不断线',
        notes: '默认用输入、输出、模考、复盘循环；可以继续补充分数目标和考试日期。'
    });

    calendarRemoveSource(plan, 'coach:ielts');
    const items = [
        [1, 'IELTS Reading 精读', 20 * 60, 75],
        [2, 'IELTS Listening 跟听', 20 * 60, 75],
        [3, 'IELTS Writing Task 2', 20 * 60, 90],
        [4, 'IELTS Speaking 录音', 20 * 60, 60],
        [5, 'IELTS 词汇与错题', 20 * 60, 60],
        [6, 'IELTS 半套模考', 9 * 60 + 30, 120],
        [0, 'IELTS 模考复盘', 10 * 60 + 30, 75],
    ];
    items.forEach(([day, title, start, duration]) => {
        calendarAddTemplateBlock(plan, 'coach:ielts', goal.id, title, 'study', [day], start, duration);
    });
    const feasibility = calendarGoalFeasibilityForPlan(plan, goal);
    messages.push(`Goal Contract: IELTS 初始估算 minimum 150h / realistic 220h / strong 300h；当前容量约 ${feasibility.capacityHours}h，${feasibility.label}。`);
    messages.push('已把 IELTS 拆成阅读、听力、写作、口语、错题和周末模考复盘，不把所有压力堆到同一天。');
}

function calendarLooksLikeMiss(text) {
    return /miss|skip|failed|didn'?t|没做|没完成|漏了|拖延|没跟上|失败/i.test(text);
}

function calendarLooksLikeAhead(text) {
    return /ahead|提前|超额|做完|完成了|比计划好|better than planned|finished/i.test(text);
}

function calendarApplyRecovery(plan, messages) {
    calendarRemoveSource(plan, 'coach:recovery-once');
    const slot = calendarFindNextFreeSlot(plan, 30, [21 * 60, 20 * 60, 8 * 60]);
    if (slot) {
        plan.blocks.push(calendarCleanBlock({
            title: '补救与复盘',
            category: 'recovery',
            day: slot.day,
            start: slot.start,
            end: slot.start + 30,
            source: 'coach:recovery-once',
            note: '漏做后的轻补救，不用熬夜。'
        }));
        messages.push('检测到漏做/拖延：安排一个 30 分钟补救块。惩罚不靠自责，靠立刻恢复节奏。');
    }
}

function calendarApplyReward(plan, messages) {
    calendarRemoveSource(plan, 'coach:reward-once');
    const slot = calendarFindNextFreeSlot(plan, 30, [21 * 60 + 30, 16 * 60, 19 * 60]);
    if (slot) {
        plan.blocks.push(calendarCleanBlock({
            title: '奖励休息',
            category: 'reward',
            day: slot.day,
            start: slot.start,
            end: slot.start + 30,
            source: 'coach:reward-once',
            note: '提前完成后的正反馈。'
        }));
        messages.push('检测到完成得比计划好：加一个 30 分钟奖励块，奖励要明确结束，不侵蚀后面的时间。');
    }
}

function calendarApplyGenericPlan(plan, note, messages) {
    const title = calendarSummarizeTitle(note);
    const duration = calendarExtractDurationMinutes(note, /deadline|due|ddl|截至|截止|到期/i.test(note) ? 240 : 60);
    const everyDay = /每天|every day|daily/i.test(note);
    const category = /study|learn|ielts|雅思|学习|背|阅读|写作/i.test(note) ? 'study' : 'deep';
    const deadlineDay = calendarDetectWeekday(note);
    const goal = calendarEnsureGoal(plan, 'project', title, {
        desiredOutcome: title,
        deadline: deadlineDay !== null ? calendarDateForDay(plan.weekStart, deadlineDay) : '',
        successCriteria: '按时间块完成可交付成果，并在结束时复盘偏差。',
        currentBaseline: 'unknown',
        gap: '待用户补充当前进度后校准',
        requiredDeliverables: [title],
        estimatedWorkload: {
            minimumHours: Math.max(1, Math.round(duration / 60 * 0.8)),
            realisticHours: Math.max(1, Math.round(duration / 60)),
            strongHours: Math.max(1, Math.round(duration / 60 * 1.4)),
            confidence: 'medium-low'
        },
        risks: ['scope unclear', 'deadline pressure', 'underestimating review time'],
        reviewCheckpoints: ['block end review'],
        weeklyTarget: `${duration} 分钟`,
        dailyMinimum: '至少推进一个最小可交付动作'
    });
    const source = `coach:generic:${calendarSlug(title)}`;
    calendarRemoveSource(plan, source);

    if (everyDay) {
        calendarAddTemplateBlock(plan, source, goal.id, title, category, [0, 1, 2, 3, 4, 5, 6], 20 * 60, Math.min(duration, 120));
        messages.push(`已按"每天"把「${title}」放进本周，每次 ${Math.min(duration, 120)} 分钟。`);
        return;
    }

    const deadline = deadlineDay === null ? 5 : deadlineDay;
    const blocks = calendarScheduleBeforeDay(plan, source, goal.id, title, category, duration, deadline);
    if (blocks > 0) {
        messages.push(`已为「${title}」在截止前拆出 ${blocks} 个时间块，总计约 ${duration} 分钟。`);
    } else {
        messages.push(`我想安排「${title}」，但本周可用空档太少。建议先删除低优先级块或延长截止日期。`);
    }
}

function calendarSummarizeTitle(text) {
    const firstLine = String(text || '').split(/\n/).map(line => line.trim()).find(Boolean) || '新任务';
    return firstLine
        .replace(/^(i want to|i need to|我要|我想|计划|安排|帮我)/i, '')
        .replace(/\s+/g, ' ')
        .slice(0, 42)
        .trim() || '新任务';
}

function calendarSlug(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'task';
}

function calendarExtractDurationMinutes(text, fallback) {
    const lower = String(text || '').toLowerCase();
    const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|小時)/i);
    if (hourMatch) return Math.max(15, Math.round(Number(hourMatch[1]) * 60 / 15) * 15);
    const minMatch = lower.match(/(\d+)\s*(?:m|min|mins|minute|minutes|分钟|分鐘)/i);
    if (minMatch) return Math.max(15, Math.round(Number(minMatch[1]) / 15) * 15);
    return fallback;
}

function calendarDetectWeekday(text) {
    const lower = String(text || '').toLowerCase();
    const dateMatch = lower.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (dateMatch) {
        const date = dateMatch.length === 4
            ? new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
            : new Date(new Date().getFullYear(), Number(dateMatch[1]) - 1, Number(dateMatch[2]));
        const day = calendarDayIndexForDate(calendarFormatDate(date), calendarPlan.weekStart);
        if (day >= 0 && day <= 6) return day;
    }
    if (/today|今天/.test(lower)) return calendarCurrentDayIndex() >= 0 ? calendarCurrentDayIndex() : new Date().getDay();
    if (/tomorrow|明天/.test(lower)) return (new Date().getDay() + 1) % 7;

    const patterns = [
        [/sunday|sun|周日|星期日|礼拜日|週日/, 0],
        [/monday|mon|周一|星期一|礼拜一|週一/, 1],
        [/tuesday|tue|周二|星期二|礼拜二|週二/, 2],
        [/wednesday|wed|周三|星期三|礼拜三|週三/, 3],
        [/thursday|thu|周四|星期四|礼拜四|週四/, 4],
        [/friday|fri|周五|星期五|礼拜五|週五/, 5],
        [/saturday|sat|周六|星期六|礼拜六|週六/, 6],
    ];
    const found = patterns.find(([regex]) => regex.test(lower));
    return found ? found[1] : null;
}

function calendarRemoveSource(plan, source) {
    plan.blocks = plan.blocks.filter(block => block.source !== source);
}

function calendarAddTemplateBlock(plan, source, goalId, title, category, days, preferredStart, duration) {
    days.forEach(day => {
        const slot = calendarFindFreeSlot(plan, day, duration, [preferredStart, preferredStart - 60, preferredStart + 60, 9 * 60, 14 * 60]);
        if (!slot) return;
        const detailSeed = { title, category, day, start: slot, end: slot + duration };
        plan.blocks.push(calendarCleanBlock({
            title,
            category,
            day,
            start: slot,
            end: slot + duration,
            source,
            goalId,
            exactAction: calendarBlockExactAction(detailSeed),
            output: calendarBlockOutput(detailSeed),
            ifInterrupted: calendarBlockFallback(detailSeed)
        }));
    });
}

function calendarScheduleBeforeDay(plan, source, goalId, title, category, totalMinutes, deadlineDay) {
    let remaining = Math.max(15, totalMinutes);
    let count = 0;
    const today = calendarCurrentDayIndex();
    const startDay = today >= 0 ? today : 0;

    for (let day = Math.min(deadlineDay, 6); day >= startDay && remaining > 0; day--) {
        const duration = Math.min(90, Math.max(45, Math.ceil(Math.min(remaining, 90) / 15) * 15));
        const slot = calendarFindFreeSlot(plan, day, duration, [20 * 60, 9 * 60, 14 * 60, 18 * 60 + 30]);
        if (!slot) continue;
        const detailSeed = { title, category, day, start: slot, end: slot + duration };
        plan.blocks.push(calendarCleanBlock({
            title,
            category,
            day,
            start: slot,
            end: slot + duration,
            source,
            goalId,
            exactAction: calendarBlockExactAction(detailSeed),
            output: calendarBlockOutput(detailSeed),
            ifInterrupted: calendarBlockFallback(detailSeed)
        }));
        remaining -= duration;
        count++;
    }
    return count;
}

function calendarFindNextFreeSlot(plan, duration, preferredStarts) {
    const today = calendarCurrentDayIndex();
    const start = today >= 0 ? today : new Date().getDay();
    for (let offset = 0; offset < 7; offset++) {
        const day = (start + offset) % 7;
        const minStart = offset === 0 ? calendarRoundToSlot(calendarNowMinutes() + CALENDAR_SLOT_MINUTES) : null;
        const slot = calendarFindFreeSlot(plan, day, duration, preferredStarts, minStart);
        if (slot !== null) return { day, start: slot };
    }
    return null;
}

function calendarFindFreeSlot(plan, day, duration, preferredStarts = [], minimumStart = null) {
    const wake = calendarTimeToMinutes(plan.habits?.wake, 8 * 60);
    const sleep = calendarTimeToMinutes(plan.habits?.sleep, 23 * 60 + 30);
    const earliest = minimumStart === null ? wake : Math.max(wake, minimumStart);
    const starts = [
        ...preferredStarts,
        8 * 60,
        9 * 60,
        10 * 60 + 30,
        14 * 60,
        16 * 60,
        18 * 60 + 30,
        20 * 60,
        21 * 60 + 30
    ]
        .map(calendarRoundToSlot)
        .filter(start => start >= earliest && start + duration <= sleep);

    for (const start of starts) {
        if (calendarSlotIsFree(plan, day, start, start + duration)) return start;
    }

    for (let start = calendarRoundToSlot(earliest); start + duration <= sleep; start += CALENDAR_SLOT_MINUTES) {
        if (calendarSlotIsFree(plan, day, start, start + duration)) return start;
    }
    return null;
}

function calendarSlotIsFree(plan, day, start, end, ignoreId = '') {
    return !plan.blocks.some(block => {
        if (block.day !== day || block.id === ignoreId) return false;
        return start < block.end && end > block.start;
    });
}

function calendarEnsureDailyReflection(plan, messages) {
    const source = 'system:daily-reflection';
    let added = 0;
    for (let day = 0; day < 7; day++) {
        if (plan.blocks.some(block => block.source === source && block.day === day)) continue;
        const slot = calendarFindFreeSlot(plan, day, 15, [22 * 60 + 30, 21 * 60 + 30, 20 * 60 + 30]);
        if (slot === null) continue;
        const title = '每日复盘';
        const detailSeed = { title, category: 'reflection', day, start: slot, end: slot + 15 };
        plan.blocks.push(calendarCleanBlock({
            title,
            category: 'reflection',
            day,
            start: slot,
            end: slot + 15,
            source,
            exactAction: calendarBlockExactAction(detailSeed),
            output: calendarBlockOutput(detailSeed),
            ifInterrupted: calendarBlockFallback(detailSeed)
        }));
        added++;
    }
    if (added) messages.push(`已补上 ${added} 个每日复盘块，用来接收你的当日反馈并调整后续安排。`);
}

function calendarRepairOverlaps(plan, messages) {
    let moved = 0;
    const sorted = [...plan.blocks].sort((a, b) => a.day - b.day || a.start - b.start);
    sorted.forEach(block => {
        if (calendarSlotIsFree(plan, block.day, block.start, block.end, block.id)) return;
        const duration = block.end - block.start;
        const slot = calendarFindFreeSlot({
            ...plan,
            blocks: plan.blocks.filter(item => item.id !== block.id)
        }, block.day, duration, [block.start + duration, block.start - duration, 20 * 60, 9 * 60]);
        if (slot !== null) {
            block.start = slot;
            block.end = slot + duration;
            const target = plan.blocks.find(item => item.id === block.id);
            if (target) {
                target.start = block.start;
                target.end = block.end;
            }
            moved++;
        }
    });
    if (moved) messages.push(`我顺手移动了 ${moved} 个重叠块，避免同一时间塞两件事。`);
}

function calendarAddManualBlock() {
    if (!calendarPlan) return;
    const title = document.getElementById('calendar-manual-title')?.value.trim() || '手动时间块';
    const day = Number(document.getElementById('calendar-manual-day')?.value || 0);
    const start = calendarTimeToMinutes(document.getElementById('calendar-manual-start')?.value, 20 * 60);
    const duration = Math.max(15, Math.min(360, Number(document.getElementById('calendar-manual-duration')?.value) || 60));
    const category = document.getElementById('calendar-manual-category')?.value || 'deep';
    let finalStart = start;
    let note = '';
    if (!calendarSlotIsFree(calendarPlan, day, start, start + duration)) {
        const slot = calendarFindFreeSlot(calendarPlan, day, duration, [start + duration, start - duration, 20 * 60, 9 * 60]);
        if (slot === null) return;
        finalStart = slot;
        note = '原时间重叠，已自动移到最近空档。';
    }
    calendarPlan.blocks.push(calendarCleanBlock({
        title,
        day,
        start: finalStart,
        end: finalStart + duration,
        category,
        source: 'manual',
        note
    }));
    calendarSavePlan();
}

function calendarSelectBlock(id) {
    calendarSelectedBlockId = id;
    calendarRender();
}

function calendarSetSelectedStatus(status) {
    const block = calendarPlan?.blocks.find(item => item.id === calendarSelectedBlockId);
    if (!block) return;
    block.status = status;
    calendarSavePlan();
}

function calendarDeleteSelectedBlock() {
    if (!calendarPlan || !calendarSelectedBlockId) return;
    calendarPlan.blocks = calendarPlan.blocks.filter(block => block.id !== calendarSelectedBlockId);
    calendarSelectedBlockId = null;
    calendarSavePlan();
}

function calendarClearGeneratedBlocks() {
    if (!calendarPlan) return;
    calendarPlan.blocks = calendarPlan.blocks.filter(block => !String(block.source || '').startsWith('coach:') && !String(block.source || '').startsWith('system:'));
    calendarPlan.reflections.push(calendarCleanReflection({
        text: '清理自动安排',
        messages: ['已清理自动生成块，保留手动添加的时间块。'],
        at: new Date().toISOString()
    }));
    calendarSavePlan();
}
