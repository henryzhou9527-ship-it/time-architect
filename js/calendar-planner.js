/* ── Time Architect: goal-first time blocks + ActivityWatch comparison ── */

const CALENDAR_PLAN_KEY = 'calendar_plan';
const CALENDAR_PLAN_STORAGE_KEY = 'time_architect_plan_v1';
const CALENDAR_ARCHITECT_API = '/api/time-architect';
const CALENDAR_ARCHITECT_CLIENT_TIMEOUT_MS = 210000;
const CALENDAR_API_CONFIG_STORAGE_KEY = 'time_architect_api_v1';
const CALENDAR_FAST_MODE_KEY = 'ta_fast_mode_v1';
const CALENDAR_DEFAULT_DIALOGUE_PROFILE_KEY = 'ta_default_dialogue_profile_v1';
const CALENDAR_SLOT_MINUTES = 15;
const CALENDAR_INPUT_STEP_MINUTES = 5;
const CALENDAR_MIN_BLOCK_MINUTES = 5;
const CALENDAR_SLOT_HEIGHT = 12;
const CALENDAR_DAY_MINUTES = 24 * 60;
const CALENDAR_PRODUCTIVE_CATEGORIES = new Set(['deep', 'study', 'workout', 'admin', 'reflection', 'recovery']);
const CALENDAR_AGENT_ROLES = [
    {
        key: 'planner',
        label: '主脑',
        model: 'Opus 4.6',
        configName: 'claude-opus-4-6-thinking',
        modelId: 'claude-opus-4-6-thinking',
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
const CALENDAR_WORKFLOW_PROMPT_VERSION = 4;

const CALENDAR_DEFAULT_GLOBAL_PROMPT = `你是 Time Architect，一个个人时间管理助手。用用户的语言回复。

## 行为规则
- 简单明确的请求（有标题+日期+时间）直接用工具执行，不要反复确认
- 复杂或模糊的请求先对话确认再执行
- 缺关键信息就问，不要猜
- 执行完工具后简短说明做了什么
- 不要在回复里输出 JSON 或重复工具参数

## 工具格式
- start/end = 从午夜起的分钟数（600=10:00, 810=13:30, 1440=24:00）
- date = YYYY-MM-DD
- category: deep, study, workout, admin, life, reflection, recovery, reward, rest
- kind: fixed, deadline, spark, routine, general
- repeat.frequency 默认 none，只有用户明确说"每天/每周/每月/daily/weekly/monthly"才设为对应值
- "明天""下周三"等日期词是一次性的，不是重复
- 修改/删除/移动已有日程时用 [Blocks] 里的 id

## 上下文说明
系统会自动附带 [Profile]、[Blocks]、[Goals]、[Free slots] 等当前日历状态，你可以直接引用。`;

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

const CALENDAR_TASK_KINDS = {
    fixed: { label: '固定时间', description: '预约、会议、考试等已经有明确时间的事件。' },
    deadline: { label: '截止任务', description: '需要在 deadline 前拆解完成的目标。' },
    spark: { label: '灵感想法', description: '有空时智能塞进 spare time，不强制完成。' },
    routine: { label: '固定习惯', description: '明确要求每天/每周/每月重复的安排。' },
    general: { label: '普通任务', description: '没有特殊约束的一次性时间块。' }
};

const CALENDAR_REPEAT_OPTIONS = {
    none: { label: '不重复' },
    daily: { label: '每天' },
    weekly: { label: '每周' },
    monthly: { label: '每月' }
};

const CALENDAR_COMMANDS = [
    '/profile', '/goal', '/estimate', '/build-week', '/build-day', '/24-7',
    '/adjust', '/reflect', '/catch-up', '/audit', '/memory',
    '/light-mode', '/sprint', '/council', '/why', '/health', '/report',
    '/commands', '/command', '/help', '/reset'
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
let calendarSelectedOccurrenceDate = '';
let calendarEditingBlockId = null;
let calendarEditingOccurrenceDate = '';
let calendarDraftText = '';
let calendarSyncStatus = '';
let calendarApiStatus = 'API-only：等待在线模型。';
let calendarCurrentPage = 'calendar';
let calendarLastRenderedPage = '';
let calendarChatOpen = true;
let calendarCalendarMode = 'plan';
let calendarSlotSize = 30;
let calendarClockInterval = null;
let calendarFirstRender = true;
let calendarArchiveFilter = 'all';
let calendarExpandedArchiveId = null;
let calendarEditingMemoryId = null;
let calendarDragState = null;
let calendarApiStoreCache = null;
let calendarServerApiProfiles = [];
let calendarFastMode = calendarLoadFastModeSetting();
let calendarActiveConversation = null;
let calendarAgentTurnRunning = false;
let calendarAgentTurnStartedAt = null;
let calendarAgentTurnLabel = '';
let calendarAgentTurnTick = null;
let calendarCloudSyncBlocked = false;
let calendarPreviewDraft = false;
let calendarActiveStreamController = null;

/* ── Auth & Encryption ── */
const CALENDAR_AUTH_KEY = 'ta_auth_v1';
const CALENDAR_ENC_PLAN_KEY = 'ta_enc_plan_v1';
const CALENDAR_ENC_API_KEY = 'ta_enc_api_v1';
const CALENDAR_SESSION_KEY = 'ta_session_key';
const CALENDAR_TEST_SESSION_KEY = 'ta_test_session_v1';
const CALENDAR_TEST_PLAN_PREFIX = 'ta_test_plan_v1_';
const CALENDAR_TEST_API_PREFIX = 'ta_test_api_v1_';
const CALENDAR_PBKDF2_ITERATIONS = 100000;
const CALENDAR_TEST_ACCOUNTS = [
    {
        id: 'demo',
        username: 'test-demo',
        label: '演示压力型',
        meta: '周五 Demo · 晚间高效',
        description: '项目演示临近，会议挤压，适合测试自然语言调整。'
    },
    {
        id: 'student',
        username: 'test-student',
        label: '考试冲刺型',
        meta: '雅思/考试 · 复盘缺口',
        description: '学习任务很多，容易低估纠错和恢复时间。'
    },
    {
        id: 'fragmented',
        username: 'test-fragmented',
        label: '碎片日程型',
        meta: '兼职/生活事务 · 时间破碎',
        description: '只有零散窗口，适合测试最小行动和补救策略。'
    }
];

let calendarEncKey = null;
let calendarAuthUser = '';

function calendarB64Enc(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function calendarB64Dec(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function calendarIsAuthMeta(auth) {
    return auth
        && typeof auth === 'object'
        && typeof auth.username === 'string'
        && auth.username.trim().length > 0
        && typeof auth.salt === 'string'
        && auth.salt.length > 0
        && typeof auth.verifier === 'string'
        && auth.verifier.length > 0;
}

function calendarHasPlainData() {
    return !!(localStorage.getItem(CALENDAR_PLAN_STORAGE_KEY) || localStorage.getItem(CALENDAR_API_CONFIG_STORAGE_KEY));
}

function calendarHasProtectedData() {
    return !!(localStorage.getItem(CALENDAR_ENC_PLAN_KEY) || localStorage.getItem(CALENDAR_ENC_API_KEY));
}

function calendarClearLocalAccountData() {
    localStorage.removeItem(CALENDAR_AUTH_KEY);
    localStorage.removeItem(CALENDAR_ENC_PLAN_KEY);
    localStorage.removeItem(CALENDAR_ENC_API_KEY);
    localStorage.removeItem(CALENDAR_PLAN_STORAGE_KEY);
    localStorage.removeItem(CALENDAR_API_CONFIG_STORAGE_KEY);
    sessionStorage.removeItem(CALENDAR_SESSION_KEY);
    calendarEncKey = null;
    calendarAuthUser = '';
    calendarApiStoreCache = null;
    calendarPlan = null;
}

async function calendarDeriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: CALENDAR_PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function calendarCreateVerifier(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    const hash = await crypto.subtle.digest('SHA-256', raw);
    return calendarB64Enc(hash);
}

async function calendarEncrypt(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: calendarB64Enc(iv), ct: calendarB64Enc(ct) };
}

async function calendarDecrypt(key, envelope) {
    const iv = new Uint8Array(calendarB64Dec(envelope.iv));
    const ct = new Uint8Array(calendarB64Dec(envelope.ct));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
}

function calendarLoadAuth() {
    try {
        const auth = JSON.parse(localStorage.getItem(CALENDAR_AUTH_KEY));
        if (!calendarIsAuthMeta(auth)) return null;
        return { ...auth, username: auth.username.trim() };
    } catch { return null; }
}

function calendarSaveAuth(meta) {
    localStorage.setItem(CALENDAR_AUTH_KEY, JSON.stringify(meta));
}

function calendarHasAccount() {
    return !!calendarLoadAuth();
}

function calendarTestAccountById(id) {
    return CALENDAR_TEST_ACCOUNTS.find(account => account.id === id) || null;
}

function calendarTestSession() {
    try {
        const raw = JSON.parse(sessionStorage.getItem(CALENDAR_TEST_SESSION_KEY));
        const account = calendarTestAccountById(raw?.id);
        if (!account) {
            sessionStorage.removeItem(CALENDAR_TEST_SESSION_KEY);
            return null;
        }
        return {
            id: account.id,
            username: account.username,
            label: account.label,
            startedAt: String(raw?.startedAt || '')
        };
    } catch {
        sessionStorage.removeItem(CALENDAR_TEST_SESSION_KEY);
        return null;
    }
}

function calendarIsTestSession() {
    return !!calendarTestSession();
}

function calendarTestPlanStorageKey(id = calendarTestSession()?.id) {
    return id ? `${CALENDAR_TEST_PLAN_PREFIX}${id}` : '';
}

function calendarTestApiStorageKey(id = calendarTestSession()?.id) {
    return id ? `${CALENDAR_TEST_API_PREFIX}${id}` : '';
}

function calendarTestAccountsHtml() {
    return `
        <section class="ta-auth__test" aria-label="测试账号">
            <div class="ta-auth__test-head">
                <span>测试账号</span>
                <small>隔离数据，不改真实账户</small>
            </div>
            <div class="ta-auth__test-list">
                ${CALENDAR_TEST_ACCOUNTS.map(account => `
                    <div class="ta-auth__test-row">
                        <button type="button" class="ta-auth__test-main" onclick="calendarStartTestAccount('${calendarEsc(account.id)}')">
                            <strong>${calendarEsc(account.label)}</strong>
                            <span>${calendarEsc(account.meta)}</span>
                            <em>${calendarEsc(account.description)}</em>
                        </button>
                        <button type="button" class="ta-auth__test-reset" title="重置并进入" aria-label="重置并进入 ${calendarEsc(account.label)}" onclick="calendarStartTestAccount('${calendarEsc(account.id)}', true)">
                            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
                        </button>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function calendarTestBlock(title, day, start, end, category, note = '', extra = {}) {
    return calendarCleanBlock({
        id: calendarId('test-block'),
        title,
        day,
        start: calendarTimeToMinutes(start),
        end: calendarTimeToMinutes(end),
        category,
        source: 'test-account',
        note,
        ...extra
    });
}

function calendarTestGoal(plan, title, day, workload, extra = {}) {
    return calendarCleanGoal({
        id: calendarId('test-goal'),
        title,
        type: extra.type || 'project',
        desiredOutcome: extra.desiredOutcome || title,
        deadline: calendarDateForDay(plan.weekStart, day),
        successCriteria: extra.successCriteria || '',
        currentBaseline: extra.currentBaseline || '',
        estimatedWorkload: workload,
        confidence: extra.confidence || 'medium',
        risks: extra.risks || [],
        dependencies: extra.dependencies || [],
        reviewCheckpoints: extra.reviewCheckpoints || [],
        priority: extra.priority || 'P1',
        weeklyTarget: extra.weeklyTarget || '',
        dailyMinimum: extra.dailyMinimum || '',
        notes: extra.notes || ''
    });
}

function calendarBuildTestPlan(accountId) {
    const account = calendarTestAccountById(accountId) || CALENDAR_TEST_ACCOUNTS[0];
    const plan = calendarDefaultPlan();
    plan.weekStart = calendarWeekStart(new Date());
    plan.profile.name = account.username;
    plan.reflections = [calendarCleanReflection({
        text: `载入测试账号：${account.label}`,
        messages: [
            '这是隔离测试数据，可直接在对话框里输入真实口吻的调整请求。',
            '重置按钮会重新生成这一套测试场景，不影响真实账户。'
        ],
        at: new Date().toISOString()
    })];

    if (account.id === 'student') {
        plan.profile = calendarCleanProfile({
            name: account.username,
            currentLifeStage: '考试冲刺期学生，目标清晰但复盘经常被挤掉',
            roles: ['student', 'test persona'],
            fixedCommitments: '周一到周四 14:00-17:00 有课；周六上午家庭安排；每天晚饭 18:30-19:20。',
            sleepWindow: '00:00-07:45',
            mealRoutines: '晚饭后需要 20 分钟缓冲，否则很难直接进入学习。',
            energyPattern: {
                highFocusTime: '09:00-11:30',
                lowEnergyTime: '14:30-17:00',
                bestCreativeTime: '上午',
                bestAdminTime: '晚上 21:30 后'
            },
            planningStyle: 'hybrid',
            commonFailureModes: ['skipping review', 'underestimating correction time', 'late-night drift'],
            weeklyCapacityHours: 18,
            preferredReviewCadence: 'daily short review + Sunday mock review'
        });
        plan.habits = { wake: '07:45', sleep: '00:00', deepWorkStart: '09:00' };
        plan.goals = [
            calendarTestGoal(plan, '两周内完成一轮雅思弱项冲刺', 6, { minimumHours: 9, realisticHours: 15, strongHours: 20, confidence: 'medium' }, {
                type: 'exam',
                desiredOutcome: '把写作和阅读错题变成可复用的改进清单',
                successCriteria: '完成 1 次半套模考、3 篇 Task 2、2 轮错题复盘',
                risks: ['只刷题不复盘', '晚上拖太晚影响第二天上午'],
                weeklyTarget: '本周完成写作 3 篇、阅读 2 组、半套模考 1 次',
                dailyMinimum: '30 分钟错题或一段限时训练'
            })
        ];
        plan.blocks = [
            calendarTestBlock('Task 2 限时写作', 1, '09:00', '10:00', 'study', '40 分钟写作，20 分钟检查结构和例子。'),
            calendarTestBlock('写作纠错清单', 1, '10:15', '11:00', 'reflection', '只抓 3 个最高频错误。'),
            calendarTestBlock('阅读限时训练', 2, '09:15', '10:15', 'study', '完成一组题，不中途查答案。'),
            calendarTestBlock('课程', 2, '14:00', '17:00', 'life', '固定占用，不可移动。'),
            calendarTestBlock('口语录音复盘', 3, '20:00', '20:45', 'study', '录 2 道题，回听后重说一次。'),
            calendarTestBlock('半套模考', 5, '09:00', '11:00', 'study', '结束后先标记不确定题。'),
            calendarTestBlock('模考复盘', 5, '11:20', '12:10', 'reflection', '把错误写成下一周动作。')
        ];
        return calendarCleanPlan(plan);
    }

    if (account.id === 'fragmented') {
        plan.profile = calendarCleanProfile({
            name: account.username,
            currentLifeStage: '兼职项目和生活事务并行，连续大块时间稀缺',
            roles: ['freelancer', 'caregiver', 'test persona'],
            fixedCommitments: '周一/三/五 10:30-12:00 客户沟通；每天 17:30-20:00 家庭事务；周四上午办事。',
            sleepWindow: '23:00-06:50',
            mealRoutines: '午饭后 30 分钟低能量，晚间只能做低摩擦任务。',
            commuteConstraints: '周四外出，移动中只适合语音和轻整理。',
            energyPattern: {
                highFocusTime: '07:30-09:15',
                lowEnergyTime: '13:30-15:00',
                bestCreativeTime: '早晨',
                bestAdminTime: '午后'
            },
            planningStyle: 'flexible',
            commonFailureModes: ['context switching', 'missing small admin tasks', 'all-or-nothing planning'],
            weeklyCapacityHours: 8,
            preferredReviewCadence: 'morning triage + Friday reset'
        });
        plan.habits = { wake: '06:50', sleep: '23:00', deepWorkStart: '07:30' };
        plan.goals = [
            calendarTestGoal(plan, '交付客户方案初稿', 5, { minimumHours: 4, realisticHours: 7, strongHours: 9, confidence: 'low' }, {
                desiredOutcome: '周五前交出结构完整、风险清楚的方案初稿',
                successCriteria: '大纲、关键页、报价假设、下一步问题列表齐全',
                risks: ['碎片时间里只处理消息，不推进交付物', '周四外出导致上下文丢失'],
                weeklyTarget: '每天保护一个 45-75 分钟推进窗口',
                dailyMinimum: '写出一个可交付小块'
            })
        ];
        plan.blocks = [
            calendarTestBlock('方案大纲 45 分钟', 1, '07:30', '08:15', 'deep', '只写标题和决策点，不排版。'),
            calendarTestBlock('客户沟通', 1, '10:30', '12:00', 'admin', '固定会议。'),
            calendarTestBlock('报价假设整理', 2, '08:00', '09:00', 'deep', '列 3 个假设和需要确认的问题。'),
            calendarTestBlock('生活事务', 2, '17:30', '20:00', 'life', '不可移动。'),
            calendarTestBlock('移动中语音备注', 4, '10:00', '10:30', 'admin', '只收集问题，不做深度判断。'),
            calendarTestBlock('初稿拼接', 5, '07:30', '09:00', 'deep', '把前面的小块拼成可发版本。'),
            calendarTestBlock('周五补救窗口', 5, '14:00', '14:45', 'recovery', '只处理最影响交付的一处缺口。')
        ];
        return calendarCleanPlan(plan);
    }

    plan.profile = calendarCleanProfile({
        name: account.username,
        currentLifeStage: '产品负责人，周五要做 20 分钟产品演示',
        roles: ['product lead', 'demo owner', 'test persona'],
        fixedCommitments: '周一/三 13:00 standup；周二 16:00 评审；每天晚饭 18:30-19:30。',
        sleepWindow: '00:10-08:00',
        mealRoutines: '晚饭后 20:00 起更容易进入专注。',
        energyPattern: {
            highFocusTime: '09:30-12:00 和 20:00-22:30',
            lowEnergyTime: '15:00-17:00',
            bestCreativeTime: '晚上',
            bestAdminTime: '午后'
        },
        planningStyle: 'hybrid',
        commonFailureModes: ['overpolishing slides', 'underestimating rehearsal', 'late-night drift'],
        weeklyCapacityHours: 12,
        preferredReviewCadence: 'daily demo readiness check'
    });
    plan.habits = { wake: '08:00', sleep: '00:10', deepWorkStart: '20:00' };
    plan.goals = [
        calendarTestGoal(plan, '周五 20 分钟产品演示', 5, { minimumHours: 5, realisticHours: 8, strongHours: 10, confidence: 'medium' }, {
            desiredOutcome: '讲清产品价值、展示核心流程、留下下一步决策',
            successCriteria: '故事线、大纲、PPT、排练和最终检查齐全',
            risks: ['把 20 分钟演示误当成 20 分钟准备', '周三晚上冲突后未重排'],
            weeklyTarget: '周五前完成 2 次排练和一版可讲 deck',
            dailyMinimum: '推进一个演示交付物'
        })
    ];
    plan.blocks = [
        calendarTestBlock('演示故事线', 1, '09:30', '10:45', 'deep', '确定受众、冲突、价值和结尾请求。'),
        calendarTestBlock('产品演示大纲', 2, '20:00', '21:15', 'deep', '只写结构，不做 PPT 细节。'),
        calendarTestBlock('PPT 草稿', 3, '20:00', '21:30', 'deep', '先完成可讲版本，允许粗糙。'),
        calendarTestBlock('评审会', 4, '16:00', '17:00', 'admin', '收集演示反馈。'),
        calendarTestBlock('第一次排练', 4, '20:30', '21:10', 'reflection', '计时 20 分钟，记录卡顿。'),
        calendarTestBlock('最终检查', 5, '09:30', '10:30', 'deep', '修正最高风险的 3 页。'),
        calendarTestBlock('产品演示', 5, '15:00', '15:30', 'deep', '正式 20 分钟演示，预留 10 分钟切换。')
    ];
    return calendarCleanPlan(plan);
}

async function calendarStartTestAccount(accountId, reset = false) {
    const account = calendarTestAccountById(accountId);
    if (!account) {
        calendarSetAuthError('找不到这个测试账号。');
        return;
    }
    const planKey = calendarTestPlanStorageKey(account.id);
    const apiKey = calendarTestApiStorageKey(account.id);
    if (reset) {
        localStorage.removeItem(planKey);
        localStorage.removeItem(apiKey);
    }
    if (!localStorage.getItem(planKey)) {
        localStorage.setItem(planKey, JSON.stringify(calendarBuildTestPlan(account.id)));
    }
    sessionStorage.setItem(CALENDAR_TEST_SESSION_KEY, JSON.stringify({
        id: account.id,
        username: account.username,
        startedAt: new Date().toISOString()
    }));
    calendarCleanup();
    calendarEncKey = null;
    calendarAuthUser = account.username;
    calendarApiStoreCache = null;
    calendarPlan = null;
    await calendarPostAuth();
}

async function calendarRegister(username, password) {
    if (calendarHasAccount()) throw new Error('当前设备已有账户，请先重置账户后再创建新账户。');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await calendarDeriveKey(password, salt);
    const verifier = await calendarCreateVerifier(key);
    calendarSaveAuth({ username, salt: calendarB64Enc(salt), verifier });
    calendarEncKey = key;
    calendarAuthUser = username;

    const oldPlan = localStorage.getItem(CALENDAR_PLAN_STORAGE_KEY);
    const oldApi = localStorage.getItem(CALENDAR_API_CONFIG_STORAGE_KEY);
    let planData = null, apiData = null;
    if (oldPlan) try { planData = calendarCleanPlan(JSON.parse(oldPlan)); } catch {}
    if (oldApi) try { apiData = calendarCleanApiStore(JSON.parse(oldApi)); } catch {}

    const planToSave = planData || calendarDefaultPlan();
    const apiToSave = apiData || calendarDefaultApiStore();

    localStorage.setItem(CALENDAR_ENC_PLAN_KEY, JSON.stringify(await calendarEncrypt(key, planToSave)));
    localStorage.setItem(CALENDAR_ENC_API_KEY, JSON.stringify(await calendarEncrypt(key, apiToSave)));

    if (oldPlan) localStorage.removeItem(CALENDAR_PLAN_STORAGE_KEY);
    if (oldApi) localStorage.removeItem(CALENDAR_API_CONFIG_STORAGE_KEY);

    const rawBytes = await crypto.subtle.exportKey('raw', key);
    sessionStorage.setItem(CALENDAR_SESSION_KEY, calendarB64Enc(rawBytes));

    calendarApiStoreCache = apiToSave;
    return { ok: true };
}

async function calendarLogin(password) {
    const auth = calendarLoadAuth();
    if (!auth) return { ok: false, error: '未找到账户' };
    const salt = new Uint8Array(calendarB64Dec(auth.salt));
    const key = await calendarDeriveKey(password, salt);
    const verifier = await calendarCreateVerifier(key);
    if (verifier !== auth.verifier) return { ok: false, error: '密码错误' };

    calendarEncKey = key;
    calendarAuthUser = auth.username;

    const rawBytes = await crypto.subtle.exportKey('raw', key);
    sessionStorage.setItem(CALENDAR_SESSION_KEY, calendarB64Enc(rawBytes));

    try {
        const encApi = JSON.parse(localStorage.getItem(CALENDAR_ENC_API_KEY));
        calendarApiStoreCache = encApi ? calendarCleanApiStore(await calendarDecrypt(key, encApi)) : calendarDefaultApiStore();
    } catch { calendarApiStoreCache = calendarDefaultApiStore(); }

    return { ok: true };
}

function calendarLogout() {
    calendarEncKey = null;
    calendarAuthUser = '';
    calendarApiStoreCache = null;
    calendarPlan = null;
    sessionStorage.removeItem(CALENDAR_TEST_SESSION_KEY);
    sessionStorage.removeItem(CALENDAR_SESSION_KEY);
    calendarRenderAuthScreen();
}

async function calendarTrySessionRestore() {
    const testSession = calendarTestSession();
    if (testSession) {
        calendarEncKey = null;
        calendarAuthUser = testSession.username;
        calendarApiStoreCache = null;
        return true;
    }

    const stored = sessionStorage.getItem(CALENDAR_SESSION_KEY);
    if (!stored) return false;
    const auth = calendarLoadAuth();
    if (!auth) {
        sessionStorage.removeItem(CALENDAR_SESSION_KEY);
        return false;
    }
    try {
        const rawBytes = calendarB64Dec(stored);
        const key = await crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const verifier = await calendarCreateVerifier(key);
        if (verifier !== auth.verifier) {
            sessionStorage.removeItem(CALENDAR_SESSION_KEY);
            return false;
        }
        calendarEncKey = key;
        calendarAuthUser = auth.username;

        try {
            const encApi = JSON.parse(localStorage.getItem(CALENDAR_ENC_API_KEY));
            calendarApiStoreCache = encApi ? calendarCleanApiStore(await calendarDecrypt(key, encApi)) : calendarDefaultApiStore();
        } catch { calendarApiStoreCache = calendarDefaultApiStore(); }

        return true;
    } catch {
        sessionStorage.removeItem(CALENDAR_SESSION_KEY);
        return false;
    }
}

function calendarAuthScreenHtml(mode) {
    const auth = calendarLoadAuth();
    const hasAccount = !!auth;
    const hasPlainData = calendarHasPlainData();
    const hasProtectedData = calendarHasProtectedData();
    const username = auth?.username || '';
    const testAccounts = calendarTestAccountsHtml();
    const registerNote = hasPlainData
        ? '<p class="ta-auth__migrate-note">已发现现有计划和 API 配置，将用新密码加密保护。</p>'
        : (!hasAccount && hasProtectedData ? '<p class="ta-auth__migrate-note">已发现旧的加密数据，但缺少账户信息。创建账户会替换这些本机数据。</p>' : '');
    const registerFooter = hasAccount ? `
                <div class="ta-auth__footer">
                    <button type="button" class="ta-auth__link" onclick="calendarRenderAuthScreen('login')">返回登录</button>
                </div>` : '';

    if (mode === 'register') {
        return `<div class="ta-auth">
            <div class="ta-auth__card">
                <div class="ta-auth__logo">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span class="ta-auth__brand">Time Architect</span>
                </div>
                <h2 class="ta-auth__title">创建本机账户</h2>
                <p class="ta-auth__subtitle">用密码加密保护你的计划和 API 配置</p>
                ${hasAccount ? `<p class="ta-auth__migrate-note">当前设备已有账户「${calendarEsc(username)}」。请返回登录并重置后再创建新账户。</p>` : registerNote}
                <div class="ta-auth__error" id="ta-auth-error" role="alert" aria-live="polite"></div>
                <div class="ta-auth__field">
                    <label for="ta-auth-username">用户名</label>
                    <input id="ta-auth-username" type="text" class="ta-auth__input" placeholder="输入用户名" autocomplete="username">
                </div>
                <div class="ta-auth__field">
                    <label for="ta-auth-password">密码</label>
                    <div class="ta-auth__input-wrap">
                        <input id="ta-auth-password" type="password" class="ta-auth__input" placeholder="至少 6 位" autocomplete="new-password">
                        ${calendarPasswordToggleButton('ta-auth-password')}
                    </div>
                </div>
                <div class="ta-auth__field">
                    <label for="ta-auth-confirm">确认密码</label>
                    <div class="ta-auth__input-wrap">
                        <input id="ta-auth-confirm" type="password" class="ta-auth__input" placeholder="再次输入密码" autocomplete="new-password">
                        ${calendarPasswordToggleButton('ta-auth-confirm')}
                    </div>
                </div>
                <button class="ta-auth__btn" id="ta-auth-submit" onclick="calendarHandleRegister()">创建账户</button>
                ${registerFooter}
                ${testAccounts}
            </div>
        </div>`;
    }

    return `<div class="ta-auth">
        <div class="ta-auth__card">
            <div class="ta-auth__logo">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span class="ta-auth__brand">Time Architect</span>
            </div>
            <h2 class="ta-auth__title">欢迎回来</h2>
            <p class="ta-auth__subtitle">输入密码解锁「${calendarEsc(username)}」的本机数据</p>
            <div class="ta-auth__error" id="ta-auth-error" role="alert" aria-live="polite"></div>
            <div class="ta-auth__field">
                <label for="ta-auth-username-display">用户名</label>
                <input id="ta-auth-username-display" type="text" class="ta-auth__input" value="${calendarEsc(username)}" aria-label="当前用户名" readonly disabled>
            </div>
            <div class="ta-auth__field">
                <label for="ta-auth-password">密码</label>
                <div class="ta-auth__input-wrap">
                    <input id="ta-auth-password" type="password" class="ta-auth__input" placeholder="输入密码" autocomplete="current-password">
                    ${calendarPasswordToggleButton('ta-auth-password')}
                </div>
            </div>
            <button class="ta-auth__btn" id="ta-auth-submit" onclick="calendarHandleLogin()">登录</button>
            <div class="ta-auth__footer">
                <button type="button" class="ta-auth__link" onclick="calendarHandleResetAccount()">忘记密码？重置账户</button>
                <button type="button" class="ta-auth__link" onclick="calendarSwitchToRegister()">重置并创建新账户</button>
            </div>
            ${testAccounts}
        </div>
    </div>`;
}

function calendarRenderAuthScreen(forceMode) {
    const root = document.getElementById('ta-root') || document.getElementById('world-content');
    if (!root) return;
    const hasAccount = calendarHasAccount();
    const mode = forceMode === 'login' && !hasAccount
        ? 'register'
        : (forceMode || (hasAccount ? 'login' : 'register'));
    root.innerHTML = calendarAuthScreenHtml(mode);
    setTimeout(() => {
        const firstInput = root.querySelector('#ta-auth-username') || root.querySelector('#ta-auth-password');
        if (firstInput) firstInput.focus();
        const pwInputs = root.querySelectorAll('#ta-auth-password, #ta-auth-confirm');
        pwInputs.forEach(input => {
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    (mode === 'register' ? calendarHandleRegister : calendarHandleLogin)();
                }
            });
        });
        const unInput = root.querySelector('#ta-auth-username');
        if (unInput) unInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); root.querySelector('#ta-auth-password')?.focus(); }
        });
    }, 50);
}

function calendarPasswordToggleButton(inputId) {
    return `<button type="button" class="ta-auth__eye" aria-label="显示密码" aria-pressed="false" aria-controls="${calendarEsc(inputId)}" title="显示密码" onclick="calendarTogglePasswordVisibility('${calendarEsc(inputId)}', this)">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>
    </button>`;
}

function calendarSetAuthError(message, focusId) {
    const errEl = document.getElementById('ta-auth-error');
    if (errEl) errEl.textContent = message;
    if (focusId) document.getElementById(focusId)?.focus();
}

function calendarTogglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    if (button) {
        const label = showPassword ? '隐藏密码' : '显示密码';
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.setAttribute('aria-pressed', showPassword ? 'true' : 'false');
    }
    input.focus({ preventScroll: true });
}

async function calendarHandleRegister() {
    const errEl = document.getElementById('ta-auth-error');
    const username = (document.getElementById('ta-auth-username')?.value || '').trim();
    const password = document.getElementById('ta-auth-password')?.value || '';
    const confirm = document.getElementById('ta-auth-confirm')?.value || '';

    if (calendarHasAccount()) {
        calendarSetAuthError('当前设备已有账户。请先返回登录并重置账户，再创建新账户。');
        return;
    }
    if (!username) { calendarSetAuthError('请输入用户名', 'ta-auth-username'); return; }
    if (password.length < 6) { calendarSetAuthError('密码至少需要 6 位', 'ta-auth-password'); return; }
    if (password !== confirm) { calendarSetAuthError('两次密码不一致', 'ta-auth-confirm'); return; }

    const btn = document.getElementById('ta-auth-submit');
    btn.textContent = '加密中...';
    btn.disabled = true;
    if (errEl) errEl.textContent = '';

    try {
        await calendarRegister(username, password);
        await calendarPostAuth();
    } catch (e) {
        calendarSetAuthError('注册失败: ' + (e.message || e));
        btn.textContent = '创建账户';
        btn.disabled = false;
    }
}

async function calendarHandleLogin() {
    const errEl = document.getElementById('ta-auth-error');
    const password = document.getElementById('ta-auth-password')?.value || '';

    if (!password) { calendarSetAuthError('请输入密码', 'ta-auth-password'); return; }

    const btn = document.getElementById('ta-auth-submit');
    btn.textContent = '验证中...';
    btn.disabled = true;
    if (errEl) errEl.textContent = '';

    try {
        const result = await calendarLogin(password);
        if (!result.ok) {
            calendarSetAuthError(result.error, 'ta-auth-password');
            btn.textContent = '登录';
            btn.disabled = false;
            return;
        }
        await calendarPostAuth();
    } catch (e) {
        calendarSetAuthError('登录失败: ' + (e.message || e), 'ta-auth-password');
        btn.textContent = '登录';
        btn.disabled = false;
    }
}

function calendarHandleResetAccount() {
    const auth = calendarLoadAuth();
    const accountName = auth?.username ? `「${auth.username}」` : '当前账户';
    if (!confirm(`重置账户将永久删除 ${accountName} 的本机加密数据，且无法恢复。\n\n确定要重置吗？`)) return;
    calendarClearLocalAccountData();
    calendarRenderAuthScreen();
}

function calendarSwitchToRegister() {
    const auth = calendarLoadAuth();
    if (auth) {
        if (!confirm(`当前设备只支持一个本机加密账户。创建新账户会删除「${auth.username}」的本机加密数据，且无法恢复。\n\n确定要重置并创建新账户吗？`)) return;
        calendarClearLocalAccountData();
    }
    calendarRenderAuthScreen('register');
}

async function calendarPostAuth() {
    const root = document.getElementById('ta-root') || document.getElementById('world-content');
    const loadingLabel = calendarIsTestSession() ? '正在载入测试账号...' : '正在解密数据...';
    root.innerHTML = `<div class="ta-shell"><div class="ta-loading">${loadingLabel}</div></div>`;
    await calendarLoadPlan();
    await calendarRefreshServerApiProfiles(false);
    calendarRender();
    calendarRefreshActivity(false);
    calendarActivityInterval = setInterval(() => calendarRefreshActivity(false), 30000);
    calendarStartClock();
}

/* ── End Auth & Encryption ── */

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
        ...overrides
    };
}

function calendarNormalizeApiBaseUrl(value, options = {}) {
    const raw = String(value || 'https://api.ikuncode.cc/v1').trim().replace(/\/+$/, '');
    try {
        const url = new URL(raw);
        if ((options.assumeV1 || url.hostname === 'api.ikuncode.cc') && (url.pathname === '' || url.pathname === '/')) {
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
        server: Boolean(source.server)
    };
}

function calendarDefaultApiStore() {
    const profiles = calendarDefaultAgentProfiles();
    const first = profiles.find(item => item.id === 'agent-dialogue') || profiles[0];
    return {
        activeId: first.id,
        profiles
    };
}

function calendarDefaultAgentProfiles() {
    return CALENDAR_AGENT_ROLES.map(role => calendarDefaultApiConfig({
        id: `agent-${role.key}`,
        name: role.configName,
        model: role.modelId
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
        profiles
    };
}

function calendarLoadApiStore() {
    if (calendarIsTestSession()) {
        if (calendarApiStoreCache) return calendarMergeServerApiProfiles(calendarApiStoreCache);
        try {
            const key = calendarTestApiStorageKey();
            const raw = key ? localStorage.getItem(key) : null;
            return calendarMergeServerApiProfiles(calendarCleanApiStore(JSON.parse(raw)));
        } catch {
            return calendarMergeServerApiProfiles(calendarDefaultApiStore());
        }
    }
    if (calendarApiStoreCache) return calendarMergeServerApiProfiles(calendarApiStoreCache);
    if (calendarEncKey) return calendarMergeServerApiProfiles(calendarDefaultApiStore());
    try {
        return calendarMergeServerApiProfiles(calendarCleanApiStore(JSON.parse(localStorage.getItem(CALENDAR_API_CONFIG_STORAGE_KEY))));
    } catch {
        return calendarMergeServerApiProfiles(calendarDefaultApiStore());
    }
}

function calendarSaveApiStore(store) {
    const cleaned = calendarCleanApiStore(store);
    calendarApiStoreCache = cleaned;
    if (calendarIsTestSession()) {
        const key = calendarTestApiStorageKey();
        if (key) localStorage.setItem(key, JSON.stringify(cleaned));
    } else if (calendarEncKey) {
        calendarEncrypt(calendarEncKey, cleaned).then(enc => {
            localStorage.setItem(CALENDAR_ENC_API_KEY, JSON.stringify(enc));
        }).catch(() => {});
    } else {
        localStorage.setItem(CALENDAR_API_CONFIG_STORAGE_KEY, JSON.stringify(cleaned));
    }
    return cleaned;
}

function calendarLoadFastModeSetting() {
    try {
        return localStorage.getItem(CALENDAR_FAST_MODE_KEY) !== 'false';
    } catch {
        return true;
    }
}

function calendarSaveFastModeSetting() {
    try {
        localStorage.setItem(CALENDAR_FAST_MODE_KEY, calendarFastMode ? 'true' : 'false');
    } catch {}
}

function calendarToggleFastMode() {
    calendarFastMode = !calendarFastMode;
    calendarSaveFastModeSetting();
    calendarApiStatus = calendarFastMode
        ? 'Fast mode 已开启：将按请求内容自动选择模型；普通对话使用你设置的默认模型。'
        : 'Fast mode 已关闭：使用手动选择的模型。';
    calendarRender();
}

function calendarDialogueProfileFallback(store = calendarLoadApiStore()) {
    return calendarFindApiProfile(store, (label) => /gemini|challenger|dialogue/.test(label))
        || calendarFindAnyApiProfile(store, (label) => /gemini|challenger|dialogue/.test(label))
        || (store.profiles || []).find(calendarApiProfileIsReady)
        || store.profiles?.[0]
        || calendarDefaultApiConfig();
}

function calendarLoadDefaultDialogueProfileId(store = calendarLoadApiStore()) {
    let stored = '';
    try {
        stored = localStorage.getItem(CALENDAR_DEFAULT_DIALOGUE_PROFILE_KEY) || '';
    } catch {}
    const profiles = store?.profiles || [];
    if (stored && profiles.some(item => item.id === stored)) return stored;
    return calendarDialogueProfileFallback(store)?.id || '';
}

function calendarDefaultDialogueProfile(store = calendarLoadApiStore()) {
    const id = calendarLoadDefaultDialogueProfileId(store);
    return (store.profiles || []).find(item => item.id === id)
        || calendarDialogueProfileFallback(store);
}

function calendarSaveDefaultDialogueProfileId(id) {
    const store = calendarLoadApiStore();
    const next = (store.profiles || []).find(item => item.id === id);
    if (!next) return calendarDefaultDialogueProfile(store);
    try {
        localStorage.setItem(CALENDAR_DEFAULT_DIALOGUE_PROFILE_KEY, next.id);
    } catch {}
    return next;
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
    if (!active || !active.apiKey) return [];
    return [{
        name: active.name,
        mode: active.mode,
        baseUrl: active.baseUrl,
        model: active.model,
        apiKey: active.apiKey
    }];
}

function calendarApiProfileIsReady(profile) {
    return Boolean(profile?.apiKey || profile?.server);
}

function calendarApiProfilesMatch(a, b) {
    const leftModel = String(a?.model || '').trim().toLowerCase();
    const rightModel = String(b?.model || '').trim().toLowerCase();
    const leftName = String(a?.name || '').trim().toLowerCase();
    const rightName = String(b?.name || '').trim().toLowerCase();
    const leftId = String(a?.id || '').trim().toLowerCase();
    const rightText = `${rightName} ${rightModel}`;
    if (leftModel && rightModel && leftModel === rightModel) return true;
    if (leftName && rightName && leftName === rightName) return true;
    if (a?.server && b?.server) return false;
    if (leftId === 'agent-planner' && /(claude|opus)/.test(rightText)) return true;
    if (leftId === 'agent-dialogue' && /gemini/.test(rightText)) return true;
    if (leftId === 'agent-engineer' && /gpt/.test(rightText)) return true;
    if (leftId === 'agent-auditor' && /deepseek-v4-pro/.test(rightText)) return true;
    return false;
}

function calendarApiProfileSearchText(profile) {
    return `${profile?.id || ''} ${profile?.name || ''} ${profile?.model || ''}`.toLowerCase();
}

function calendarFindApiProfile(store, predicate) {
    return (store?.profiles || []).find(profile => calendarApiProfileIsReady(profile) && predicate(calendarApiProfileSearchText(profile), profile));
}

function calendarFindAnyApiProfile(store, predicate) {
    return (store?.profiles || []).find(profile => predicate(calendarApiProfileSearchText(profile), profile));
}

function calendarLooksLikeCalendarEditInput(note) {
    const text = String(note || '').toLowerCase();
    const hasEditVerb = /(加入|添加|新增|新建|安排|排进|排到|加到|加一个|预约|预定|订|删除|删掉|取消|移除|不要这个|改到|移动|挪到|调整|延后|提前|\badd\b|\bcreate\b|\bschedule\b|\bbook\b|\breserve\b|\bput\b|\bplan\b|\bdelete\b|\bremove\b|\bcancel\b|\bdrop\b|\bmove\b|\breschedule\b|\bshift\b)/i.test(text);
    if (!hasEditVerb) return false;
    const hasDeleteOrMoveVerb = /(删除|删掉|取消|移除|不要这个|改到|移动|挪到|调整|延后|提前|\bdelete\b|\bremove\b|\bcancel\b|\bdrop\b|\bmove\b|\breschedule\b|\bshift\b)/i.test(text);
    const hasCalendarObject = /(行程|日程|时间块|任务|事件|计划|安排|会议|咨询|心理|看诊|问诊|预约|block|event|task|calendar|meeting|session|appointment|consult|consulting|therapy|mental health|doctor|workout|yoga|call|review|draft|practice)/i.test(text);
    const hasTimeHint = /(today|tomorrow|tonight|next\s+week|this\s+week|morning|afternoon|evening|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?|下周|本周|周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|今晚|上午|下午|晚上|早上|[01]?\d|2[0-3])[:：][0-5]\d|\b[1-9]\d?\s*(am|pm)\b|\bfor\s+\d+\s*(m|min|mins|minute|minutes|h|hr|hour|hours)\b|\d+\s*(分钟|小时|min|mins|minutes|hour|hours)/i.test(text);
    if (hasDeleteOrMoveVerb && text.length <= 80) return true;
    return hasCalendarObject || hasTimeHint;
}

function calendarFastModeIntent(note) {
    const text = String(note || '').toLowerCase();
    const command = calendarExtractCommand(note);
    if (calendarLooksLikeMultiGoalInput(note)) {
        return {
            key: 'planner',
            reason: '多目标规划',
            match: (label) => /claude|opus|planner/.test(label)
        };
    }
    if ((command === '/profile' && calendarCommandPayload(note)) || calendarLooksLikeLongProfileInput(note)) {
        return {
            key: 'planner',
            reason: 'Profile/规划记忆更新',
            match: (label) => /claude|opus|planner/.test(label)
        };
    }
    if (/gpt|工程|代码|编程|实现|改代码|修代码|bug|debug|\bui\b|css|html|javascript|js\b|\bapi\b|schema|json|vercel|部署|github|commit|pull request|pr\b|refactor|frontend|backend|typescript|react|node/.test(text)) {
        return {
            key: 'engineer',
            reason: '工程/代码请求',
            match: (label) => /gpt|engineer/.test(label)
        };
    }
    if (/flash|快速|轻量|便宜|小改|小的|quick|fast/.test(text)) {
        return {
            key: 'flash',
            reason: '轻量快速请求',
            match: (label) => /deepseek-v4-flash|flash/.test(label)
        };
    }
    if (/审计|检查|查错|冲突|过载|风险|低估|audit|sanity|red flag|deepseek|dsk/.test(text)) {
        return {
            key: 'audit',
            reason: '审计/风险检查',
            match: (label) => /deepseek-v4-pro|deepseek|auditor/.test(label)
        };
    }
    if (command === '/light-mode' || (command === '/health' && calendarLooksLikeTired(note))) {
        return {
            key: 'calendar-edit',
            reason: '健康轻量执行',
            match: (label) => /gpt|engineer/.test(label)
        };
    }
    if (calendarLooksLikeCalendarEditInput(note)) {
        return {
            key: 'calendar-edit',
            reason: '日历行程执行',
            match: (label) => /gpt|engineer/.test(label)
        };
    }
    if (/挑战|反驳|盲区|第二意见|gemini|challenge|critic|alternative/.test(text)) {
        return {
            key: 'challenge',
            reason: '挑战假设/找盲区',
            match: (label) => /gemini|challenger/.test(label)
        };
    }
    if (['/goal', '/estimate', '/build-day', '/build-week', '/24-7', '/adjust', '/reflect', '/catch-up', '/light-mode', '/sprint', '/reset'].includes(command)) {
        return {
            key: 'planner',
            reason: '规划/排程命令',
            match: (label) => /claude|opus|planner/.test(label)
        };
    }
    return {
        key: 'dialogue',
        reason: '默认普通对话',
        match: (label) => /gemini|challenger|dialogue/.test(label)
    };
}

function calendarAgentKeyForIntentKey(intentKey) {
    if (intentKey === 'calendar-edit') return 'engineer';
    if (intentKey === 'engineer') return 'engineer';
    if (intentKey === 'audit' || intentKey === 'flash') return 'auditor';
    if (intentKey === 'challenge' || intentKey === 'dialogue') return 'dialogue';
    return 'planner';
}

function calendarRouteMatcher(agentKey, requestType = '') {
    if (agentKey === 'planner') return (label) => /claude|opus|planner/.test(label);
    if (agentKey === 'engineer') return (label) => /gpt|engineer/.test(label);
    if (agentKey === 'auditor' && requestType === 'flash') return (label) => /deepseek-v4-flash|flash/.test(label);
    if (agentKey === 'auditor') return (label) => /deepseek-v4-pro|deepseek|auditor/.test(label);
    return (label) => /gemini|challenger|dialogue/.test(label);
}

function calendarNormalizeRoute(raw, fallback = calendarRequestRoute('')) {
    const requestTypes = new Set(['planner', 'calendar-edit', 'engineer', 'audit', 'flash', 'challenge', 'dialogue']);
    const agentKeys = new Set(['planner', 'engineer', 'auditor', 'dialogue']);
    const requestType = requestTypes.has(String(raw?.requestType || '').trim())
        ? String(raw.requestType).trim()
        : fallback.requestType;
    let agentKey = agentKeys.has(String(raw?.agentKey || '').trim())
        ? String(raw.agentKey).trim()
        : fallback.agentKey;
    if (requestType === 'calendar-edit' || requestType === 'engineer') agentKey = 'engineer';
    if (requestType === 'audit' || requestType === 'flash') agentKey = 'auditor';
    if (requestType === 'challenge' || requestType === 'dialogue') agentKey = 'dialogue';
    if (requestType === 'planner') agentKey = 'planner';
    const draftMode = requestType === 'calendar-edit' || agentKey === 'planner';
    const outputMode = draftMode
        ? 'calendar-draft'
        : (agentKey === 'auditor' ? 'review-advice' : (agentKey === 'engineer' ? 'engineering-advice' : 'dialogue-advice'));
    return {
        requestType,
        reason: String(raw?.reason || fallback.reason || 'AI Router 判断').slice(0, 160),
        agentKey,
        outputMode,
        draftMode,
        confidence: Math.max(0, Math.min(1, Number(raw?.confidence ?? fallback.confidence ?? 0.5) || 0.5)),
        match: calendarRouteMatcher(agentKey, requestType),
        routerSource: raw?.routerSource || fallback.routerSource || 'local'
    };
}

function calendarRequestRoute(note) {
    const intent = calendarFastModeIntent(note);
    const agentKey = calendarAgentKeyForIntentKey(intent.key);
    const draftMode = agentKey === 'planner' || intent.key === 'calendar-edit';
    const outputMode = draftMode
        ? 'calendar-draft'
        : (agentKey === 'auditor' ? 'review-advice' : (agentKey === 'engineer' ? 'engineering-advice' : 'dialogue-advice'));
    return {
        requestType: intent.key,
        reason: intent.reason,
        agentKey,
        outputMode,
        draftMode,
        confidence: 0.7,
        match: intent.match || calendarRouteMatcher(agentKey, intent.key),
        routerSource: 'local'
    };
}

function calendarFastModeConfig(note, store = calendarLoadApiStore(), routeOverride = null) {
    if (!calendarFastMode) {
        const active = store.profiles.find(item => item.id === store.activeId) || store.profiles[0] || calendarDefaultApiConfig();
        return { config: active, reason: '手动选择' };
    }
    const route = routeOverride || calendarRequestRoute(note);
    const userDialogueDefault = calendarDefaultDialogueProfile(store);
    if (route.requestType === 'dialogue') {
        return { config: userDialogueDefault, reason: `${route.reason}：${userDialogueDefault.name}`, route };
    }
    const dialogueDefault = calendarDialogueProfileFallback(store);
    const matched = calendarFindApiProfile(store, route.match)
        || calendarFindAnyApiProfile(store, route.match)
        || dialogueDefault
        || (store.profiles || []).find(calendarApiProfileIsReady)
        || store.profiles?.[0]
        || calendarDefaultApiConfig();
    return { config: matched, reason: route.reason, route };
}

function calendarAgentCouncilRequested(note) {
    return /(^|\s)\/council\b|会诊|全模型|全部模型|所有模型|多模型|所有\s*agent|全部\s*agent|多\s*agent|agent\s*council|model\s*council|multi[-\s]?agent/i.test(String(note || ''));
}

function calendarAgentProfileMatcher(agent) {
    const roleText = `${agent?.key || ''} ${agent?.label || ''} ${agent?.model || ''} ${agent?.configName || ''} ${agent?.modelId || ''}`.toLowerCase();
    if (/planner|主脑|claude|opus/.test(roleText)) return (label) => /claude|opus|planner/.test(label);
    if (/dialogue|挑战|gemini/.test(roleText)) return (label) => /gemini|challenger|dialogue/.test(label);
    if (/engineer|工程|gpt/.test(roleText)) return (label) => /gpt|engineer/.test(label);
    if (/auditor|审计|deepseek/.test(roleText)) return (label) => /deepseek-v4-pro|auditor/.test(label);
    return (label) => roleText && label.includes(roleText);
}

function calendarApiProfileForAgent(agent, store = calendarLoadApiStore()) {
    const profiles = store?.profiles || [];
    const modelId = String(agent?.modelId || '').trim().toLowerCase();
    const configName = String(agent?.configName || '').trim().toLowerCase();
    const exact = profiles.find(profile => {
        const model = String(profile.model || '').trim().toLowerCase();
        const name = String(profile.name || '').trim().toLowerCase();
        return (modelId && model === modelId) || (configName && name === configName);
    });
    if (exact) return exact;
    return calendarFindApiProfile(store, calendarAgentProfileMatcher(agent))
        || calendarFindApiProfile(store, (label) => /claude|opus|planner/.test(label))
        || profiles.find(calendarApiProfileIsReady)
        || profiles[0]
        || calendarDefaultApiConfig();
}

function calendarPublicApiRequestConfig(profile) {
    return {
        name: profile?.name,
        mode: profile?.mode,
        baseUrl: profile?.baseUrl,
        model: profile?.model,
        server: Boolean(profile?.server)
    };
}

function calendarClientConfigsForProfile(profile) {
    if (!profile?.apiKey) return [];
    return [{
        name: profile.name,
        mode: profile.mode,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: profile.apiKey
    }];
}

function calendarAgentPayload(agent) {
    if (!agent) return null;
    return {
        key: agent.key,
        label: agent.label,
        model: agent.model,
        configName: agent.configName,
        modelId: agent.modelId,
        job: agent.job
    };
}

function calendarAgentSkill(agentKey) {
    const key = String(agentKey || 'planner');
    const skills = {
        planner: {
            name: 'Goal Contract + Calendar Draft Skill',
            canModifyPlan: true,
            purpose: 'Turn goals into workload estimates, feasibility checks, and executable calendar blocks.',
            steps: [
                'Extract goal, deadline, baseline, success criteria, capacity, and constraints.',
                'Estimate minimum / realistic / strong workload before scheduling.',
                'Compare required work against available capacity and state infeasibility clearly.',
                'Create or update GoalContract objects and ScheduleBlock objects only when the route allows calendar-draft.',
                'Preserve manual blocks, sleep, meals, recovery, and fixed commitments.'
            ],
            calendarSchema: 'Use plan.goals for GoalContract objects and plan.blocks for ScheduleBlock objects with date/day/start/end/category/kind/repeat/title/goalId/source/note/exactAction/output/ifInterrupted/status.'
        },
        dialogue: {
            name: 'Dialogue + Challenge Skill',
            canModifyPlan: false,
            purpose: 'Understand the user, explain the system in human language, challenge weak assumptions, and ask for missing information.',
            steps: [
                'Classify whether the user wants explanation, help, profile/health interpretation, or a challenge.',
                'Answer using siteKnowledge and the visible plan without inventing hidden state.',
                'Point out optimistic assumptions, unclear baseline, missing deadline, or likely execution friction.',
                'Keep the plan unchanged unless the router explicitly allows a calendar-draft route.',
                'Translate complex planner/auditor output into concise user-facing next steps.'
            ],
            calendarSchema: 'Read calendar state for explanation; do not mutate goals or blocks in dialogue-advice mode.'
        },
        auditor: {
            name: 'Plan Audit Skill',
            canModifyPlan: false,
            purpose: 'Check calendar legality, workload realism, conflict, overload, recovery, task clarity, and goal alignment.',
            steps: [
                'Scan blocks for overlap, sleep/recovery violations, missing transitions, and fixed-constraint conflicts.',
                'Check daily/weekly deep-work load against profile capacity.',
                'Flag vague titles, missing output, missing review/correction, and missing buffer.',
                'Return severity, evidence, and patch recommendations.',
                'Do not create a calendar draft unless the router explicitly allows it.'
            ],
            calendarSchema: 'Read plan.goals/blocks/reflections and return review-advice messages; preserve the plan.'
        },
        engineer: {
            name: 'Calendar Engineering Skill',
            canModifyPlan: true,
            purpose: 'Execute concrete calendar data edits and design implementation changes for Time Architect calendar state, routing, API, schema, and UI.',
            steps: [
                'Use js/calendar-planner.js for frontend state, rendering, router, chat workflow, plan merge, and calendar block behavior.',
                'Use api/time-architect.js for API-only model calls, JSON contract, siteKnowledge handling, and backend prompt rules.',
                'Use README.md and CLAUDE.md for user/developer workflow documentation.',
                'For calendar data edits, directly produce valid GoalContract and ScheduleBlock changes when the route outputMode is calendar-draft. Supported operations: create_event, update_event, delete_event, move_event, resize_event, schedule_deadline_task, capture_spark.',
                'Default recurrence = none. Words such as next week Wednesday, this Friday, tomorrow, 下周三, and 明天 select one date; only explicit every/每/daily/weekly/monthly language may set repeat.frequency away from none.',
                'Use kind=fixed for appointments/exams/consulting with a known time, kind=deadline for work-backward deadline tasks, kind=spark for optional spare-time ideas, and kind=routine only for explicit recurrence.',
                'Preserve manual blocks, validate overlaps/capacity, and keep repository source-code edits separate from calendar data edits.',
                'In engineering-advice mode, provide implementation advice only and do not claim repository source code was edited. Actual repository edits happen through Codex/developer workflow.'
            ],
            calendarSchema: 'Calendar data execution covers calendarPlan.profile/goals/blocks/reflections/archives/agents/workflowPrompts. For calendar-draft, update plan.blocks/goals using date/day/start/end/category/kind/repeat. For engineering-advice, explain implementation changes only.',
            toolkit: calendarEditToolkitKnowledge()
        }
    };
    return skills[key] || skills.planner;
}

function calendarAgentSkillPrompt(agent) {
    const skill = calendarAgentSkill(agent?.key);
    return [
        `Built-in skill: ${skill.name}`,
        `Skill purpose: ${skill.purpose}`,
        `Can modify calendar plan in this skill by default: ${skill.canModifyPlan ? 'yes' : 'no'}. Router outputMode still has final authority.`,
        'Skill procedure:',
        ...skill.steps.map((step, index) => `${index + 1}. ${step}`),
        `Calendar/schema knowledge: ${skill.calendarSchema}`,
        skill.toolkit ? `Calendar edit toolkit: ${JSON.stringify(skill.toolkit)}` : ''
    ].join('\n');
}

function calendarAgentInstruction(agent, route = null, note = '') {
    const prompts = calendarNormalizeWorkflowPrompts(calendarPlan?.workflowPrompts);
    const rolePrompt = agent ? prompts.agents?.[agent.key] : '';
    const agentLine = agent
        ? `Selected agent: ${agent.label || agent.key}. Agent job: ${agent.job || 'produce the best schedule update for this request'}.`
        : 'No specialist agent was selected; act as the coordinator/planner and choose the lightest sufficient path.';
    const routeLine = route
        ? `Request router decision: type=${route.requestType}; reason=${route.reason}; selectedAgent=${route.agentKey}; outputMode=${route.outputMode}; calendarDraftAllowed=${route.draftMode ? 'yes' : 'no'}.`
        : '';
    const nonPlannerBoundary = agent && agent.key !== 'planner' && !route?.draftMode
        ? 'This non-planner agent should put its review, risks, or implementation advice in messages and preserve plan state unless a concrete proposal is necessary for the user request.'
        : '';
    const calendarDraftExecutorBoundary = agent?.key === 'engineer' && route?.draftMode
        ? 'This Engineer route is calendar-draft execution: modify calendar data in plan.blocks/goals as needed, while preserving manual blocks and never claiming repository source files were edited.'
        : '';
    const calendarEditContract = route?.draftMode
        ? `Calendar edit contract for this request: ${JSON.stringify(calendarCalendarEditContract(note, route))}`
        : '';
    const skillPrompt = agent ? calendarAgentSkillPrompt(agent) : '';
    return [
        'Time Architect default workflow prompt. Follow this role contract under the backend JSON output contract.',
        `Workflow prompt version: ${prompts.version || CALENDAR_WORKFLOW_PROMPT_VERSION}.`,
        prompts.orchestrator,
        agentLine,
        routeLine,
        skillPrompt,
        rolePrompt,
        nonPlannerBoundary,
        calendarDraftExecutorBoundary,
        calendarEditContract,
        prompts.common,
        prompts.deployment,
        'Return one complete JSON plan update. Preserve user/manual blocks, avoid contradictions, and keep messages short.'
    ].filter(Boolean).join('\n\n');
}

function calendarAgentCouncilSelection(note, store = calendarLoadApiStore()) {
    if (!calendarAgentCouncilRequested(note)) return null;
    const agents = calendarConfiguredAgents().map(agent => ({
        ...agent,
        apiConfig: calendarApiProfileForAgent(agent, store)
    }));
    return {
        agents,
        reason: '显式 Agent 会诊'
    };
}

function calendarMergeServerApiProfiles(store) {
    const cleanStore = calendarCleanApiStore(store);
    if (!calendarServerApiProfiles.length) return cleanStore;
    const profiles = [...cleanStore.profiles];
    let firstServerId = '';
    calendarServerApiProfiles.forEach((serverProfile, index) => {
        const profile = calendarCleanApiConfig({
            ...serverProfile,
            id: serverProfile.id || `server-${calendarSlug(serverProfile.model || serverProfile.name || index)}`,
            apiKey: '',
            server: true
        }, index);
        const existingIndex = profiles.findIndex(item =>
            calendarApiProfilesMatch(item, profile)
        );
        if (existingIndex >= 0) profiles[existingIndex] = {
            ...profiles[existingIndex],
            ...profile,
            id: profiles[existingIndex].id || profile.id
        };
        else profiles.push(profile);
        if (!firstServerId) firstServerId = existingIndex >= 0 ? profiles[existingIndex].id : profile.id;
    });
    const active = profiles.find(item => item.id === cleanStore.activeId);
    const preferredActive = active
        ? active.id
        : (firstServerId || profiles.find(calendarApiProfileIsReady)?.id || profiles[0].id);
    return {
        activeId: preferredActive,
        profiles: profiles.slice(0, 12)
    };
}

function calendarApplyServerApiProfiles(profiles = []) {
    calendarServerApiProfiles = (Array.isArray(profiles) ? profiles : [])
        .filter(item => item?.configured)
        .map((item, index) => calendarCleanApiConfig({
            ...item,
            id: `server-${calendarSlug(item.model || item.name || index)}`,
            apiKey: '',
            server: true
        }, index));
    if (calendarApiStoreCache) calendarApiStoreCache = calendarMergeServerApiProfiles(calendarApiStoreCache);
}

async function calendarRefreshServerApiProfiles(render = false) {
    try {
        const res = await fetch(CALENDAR_ARCHITECT_API, { cache: 'no-store' });
        const data = await res.json();
        calendarApplyServerApiProfiles(data.profiles || []);
        if (calendarServerApiProfiles.length) {
            calendarApiStatus = `Server API ready: ${calendarServerApiProfiles.map(item => item.model).join(' / ')}`;
        } else if (data.configured) {
            calendarApiStatus = `Server API ready: ${data.provider} · ${data.model} · ${data.mode}`;
        }
        if (render) calendarRenderSettingsOnly();
        else calendarRenderApiStatus();
        return data;
    } catch {
        calendarApiStatus = 'API 检查失败：API-only 模式不会生成本地回答。';
        calendarRenderApiStatus();
        return null;
    }
}

function calendarActiveApiLabel(config = calendarLoadApiConfig()) {
    return `${config.name} · ${config.model}`;
}

function calendarSession() {
    return typeof getCurrentSession === 'function' ? getCurrentSession() : null;
}

function calendarCurrentUsername() {
    const testSession = calendarTestSession();
    if (testSession) return testSession.username;
    return calendarAuthUser || calendarSession()?.username || calendarLoadAuth()?.username || '';
}

function calendarCanSync() {
    if (calendarIsTestSession()) return false;
    const user = String(calendarCurrentUsername()).toLowerCase();
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

function calendarCleanDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}

function calendarWeekdayForDate(dateStr, fallback = 0) {
    const date = calendarParseDate(dateStr);
    if (!date) return Math.max(0, Math.min(6, Number(fallback) || 0));
    return date.getDay();
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

function calendarRoundToInputStep(minutes) {
    return Math.round((Number(minutes) || 0) / CALENDAR_INPUT_STEP_MINUTES) * CALENDAR_INPUT_STEP_MINUTES;
}

function calendarClampMinute(minutes, fallback = 0) {
    const value = Number.isFinite(Number(minutes)) ? Number(minutes) : fallback;
    return Math.max(0, Math.min(CALENDAR_DAY_MINUTES, Math.round(value)));
}

function calendarCleanDurationMinutes(value, fallback = 60, max = 360) {
    const text = String(value ?? '').trim();
    const raw = text && Number.isFinite(Number(text)) ? Number(text) : fallback;
    return Math.max(CALENDAR_MIN_BLOCK_MINUTES, Math.min(max, Math.round(raw)));
}

function calendarCleanRepeat(raw) {
    if (typeof raw === 'string') raw = { frequency: raw };
    const source = raw && typeof raw === 'object' ? raw : {};
    const frequency = Object.prototype.hasOwnProperty.call(CALENDAR_REPEAT_OPTIONS, source.frequency)
        ? source.frequency
        : 'none';
    const interval = Math.max(1, Math.min(30, Number(source.interval) || 1));
    const until = /^\d{4}-\d{2}-\d{2}$/.test(String(source.until || '')) ? String(source.until) : '';
    const count = Math.max(0, Math.min(366, Number(source.count) || 0));
    return { frequency, interval, until, count };
}

function calendarRepeatLabel(repeat) {
    const clean = calendarCleanRepeat(repeat);
    const base = CALENDAR_REPEAT_OPTIONS[clean.frequency]?.label || CALENDAR_REPEAT_OPTIONS.none.label;
    if (clean.frequency === 'none') return base;
    const every = clean.interval > 1 ? `每 ${clean.interval} 个周期` : base;
    const stop = clean.until ? `，到 ${clean.until}` : (clean.count ? `，共 ${clean.count} 次` : '');
    return `${every}${stop}`;
}

function calendarTaskKindInfo(kind) {
    return CALENDAR_TASK_KINDS[kind] || CALENDAR_TASK_KINDS.general;
}

function calendarNormalizeTaskKind(kind, fallback = 'general') {
    const raw = String(kind || '').trim();
    if (CALENDAR_TASK_KINDS[raw]) return raw;
    return CALENDAR_TASK_KINDS[fallback] ? fallback : 'general';
}

function calendarTaskKindOptionsHtml(selected = 'general') {
    const current = calendarNormalizeTaskKind(selected, 'general');
    return Object.entries(CALENDAR_TASK_KINDS)
        .map(([key, item]) => `<option value="${key}"${key === current ? ' selected' : ''}>${calendarEsc(item.label)}</option>`)
        .join('');
}

function calendarRepeatOptionsHtml(selected = 'none') {
    const current = calendarCleanRepeat(selected).frequency;
    return Object.entries(CALENDAR_REPEAT_OPTIONS)
        .map(([key, item]) => `<option value="${key}"${key === current ? ' selected' : ''}>${calendarEsc(item.label)}</option>`)
        .join('');
}

function calendarDetectRepeatIntent(note) {
    const text = String(note || '').toLowerCase();
    const hasDaily = /(每天|每日|天天|\bdaily\b|\bevery\s+day\b)/i.test(text);
    const hasWeekly = /(每周|每星期|每礼拜|每个?周[一二三四五六日天]?|每个?星期[一二三四五六日天]?|\bweekly\b|\bevery\s+week\b|\bevery\s+(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\b)/i.test(text);
    const hasMonthly = /(每月|每个月|每个?月|\bmonthly\b|\bevery\s+month\b)/i.test(text);
    const hasGenericRepeat = /(重复|循环|固定每|recurring|recur|repeat)/i.test(text);
    const frequency = hasDaily ? 'daily' : hasWeekly ? 'weekly' : hasMonthly ? 'monthly' : 'none';
    return {
        frequency: frequency === 'none' && hasGenericRepeat ? 'weekly' : frequency,
        interval: 1,
        recurrenceExplicit: frequency !== 'none' || hasGenericRepeat,
        defaultedToNone: frequency === 'none' && !hasGenericRepeat
    };
}

function calendarDetectTaskKind(note) {
    const text = String(note || '').toLowerCase();
    const repeat = calendarDetectRepeatIntent(text);
    if (repeat.recurrenceExplicit) return 'routine';
    if (/(deadline|due|截止|ddl|交付|提交|到期|考试前|之前完成)/i.test(text)) return 'deadline';
    if (/(灵感|想法|有空|空闲|spare|someday|idea|maybe|optional|when possible)/i.test(text)) return 'spark';
    if (/(预约|咨询|看诊|问诊|会议|会面|考试|面试|课|book|appointment|consult|consulting|therapy|doctor|exam|meeting|session|call)/i.test(text)) return 'fixed';
    if (calendarLooksLikeCalendarEditInput(note)) return 'fixed';
    return 'general';
}

function calendarEditToolkitKnowledge() {
    return {
        operations: ['create_event', 'update_event', 'delete_event', 'move_event', 'resize_event', 'schedule_deadline_task', 'capture_spark'],
        taskKinds: Object.entries(CALENDAR_TASK_KINDS).map(([key, item]) => ({
            key,
            label: item.label,
            description: item.description
        })),
        repeatPolicy: {
            defaultFrequency: 'none',
            explicitOnly: true,
            dateSelectorsAreNotRecurrence: ['next week Wednesday', 'this Friday', 'tomorrow', '下周三', '本周五', '明天'],
            explicitRecurrenceExamples: ['every week', 'weekly', 'daily', 'monthly', '每周', '每天', '每月'],
            rule: 'Default recurrence = none. A date selector like next week Wednesday chooses one date; it is not weekly recurrence.'
        },
        blockRequiredFields: ['title', 'date', 'day', 'start', 'end', 'category', 'kind', 'repeat.frequency', 'source'],
        operationTemplate: {
            operation: 'create_event | update_event | delete_event | move_event | resize_event | schedule_deadline_task | capture_spark',
            target: { id: '', title: '', date: '', day: 0, start: 600, end: 660 },
            blockPatch: {
                title: '',
                date: 'YYYY-MM-DD',
                day: 0,
                start: 600,
                end: 660,
                kind: 'fixed | deadline | spark | routine | general',
                repeat: { frequency: 'none | daily | weekly | monthly', interval: 1 },
                category: 'deep',
                note: ''
            },
            validation: {
                recurrenceExplicit: false,
                overlapPolicy: 'warn | allow | move-only-if-user-asked'
            }
        }
    };
}

function calendarCalendarEditContract(note, route = calendarRequestRoute(note)) {
    const repeat = calendarDetectRepeatIntent(note);
    const taskKind = calendarDetectTaskKind(note);
    return {
        requestType: route?.requestType || 'dialogue',
        agentKey: route?.agentKey || 'dialogue',
        outputMode: route?.outputMode || 'dialogue-advice',
        taskKind,
        repeat: {
            frequency: repeat.frequency,
            interval: repeat.interval,
            recurrenceExplicit: repeat.recurrenceExplicit,
            defaultFrequency: 'none'
        },
        mustNotRepeatUnlessExplicit: true,
        currentDate: calendarFormatDate(new Date()),
        currentWeekStart: calendarPlan?.weekStart || calendarWeekStart(new Date()),
        examples: [
            'book next week Wednesday 10am mental health consulting => create one fixed event with repeat.frequency none',
            'every Wednesday 10am consulting => create routine event with repeat.frequency weekly',
            'finish report by Friday => deadline task; work backward before deadline',
            'idea: try pottery when there is spare time => spark; fit only when capacity allows'
        ],
        toolkit: calendarEditToolkitKnowledge()
    };
}

function calendarApplyCalendarEditContractToPlan(update, note, route = calendarRequestRoute(note), basePlan = calendarVisiblePlanContext()) {
    if (!update || typeof update !== 'object' || route?.requestType !== 'calendar-edit' || route?.outputMode !== 'calendar-draft') return update;
    const contract = calendarCalendarEditContract(note, route);
    if (contract.repeat.recurrenceExplicit || !Array.isArray(update.blocks)) return update;
    const existingIds = new Set((basePlan?.blocks || []).map(block => String(block.id || '')));
    const correctedBlocks = update.blocks.map(block => {
        const id = String(block?.id || '');
        if (id && existingIds.has(id)) return block;
        const repeat = calendarCleanRepeat(block?.repeat || block?.recurrence);
        if (repeat.frequency === 'none') return block;
        const safeKind = block?.kind === 'routine'
            ? (contract.taskKind === 'routine' ? 'fixed' : contract.taskKind)
            : block?.kind;
        return {
            ...block,
            kind: calendarNormalizeTaskKind(safeKind, contract.taskKind || 'fixed'),
            repeat: {
                ...repeat,
                frequency: 'none'
            },
            recurrenceGuard: 'date selector request had no explicit recurrence; forced one-time event'
        };
    });
    return {
        ...update,
        blocks: correctedBlocks
    };
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
        reflections: [],
        memories: [],
        archives: [],
        agents: CALENDAR_AGENT_ROLES.map(r => ({ ...r })),
        workflowPrompts: calendarDefaultWorkflowPrompts()
    };
}

function calendarCleanBlock(raw) {
    const cleanDate = calendarCleanDate(raw?.date || raw?.startDate);
    const day = cleanDate
        ? calendarWeekdayForDate(cleanDate, raw?.day)
        : Math.max(0, Math.min(6, Number(raw?.day) || 0));
    const start = Math.max(0, Math.min(CALENDAR_DAY_MINUTES - CALENDAR_MIN_BLOCK_MINUTES, calendarClampMinute(raw?.start, 0)));
    const rawEnd = Number(raw?.end) || start + 60;
    const end = Math.max(start + CALENDAR_MIN_BLOCK_MINUTES, Math.min(CALENDAR_DAY_MINUTES, calendarClampMinute(rawEnd, start + 60)));
    const category = CALENDAR_CATEGORIES[raw?.category] ? raw.category : 'deep';
    const kind = calendarNormalizeTaskKind(raw?.kind || raw?.taskKind || raw?.type, 'general');
    return {
        id: String(raw?.id || calendarId('block')),
        title: String(raw?.title || '未命名').trim().slice(0, 90),
        date: cleanDate,
        day,
        start,
        end,
        category,
        kind,
        repeat: calendarCleanRepeat(raw?.repeat || raw?.recurrence),
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

function calendarVisiblePlanContext() {
    const source = calendarCleanPlan(calendarPlan);
    return {
        version: source.version,
        weekStart: source.weekStart,
        profile: source.profile,
        habits: source.habits,
        goals: source.goals,
        blocks: source.blocks,
        agents: source.agents,
        workflowPromptVersion: source.workflowPrompts?.version || CALENDAR_WORKFLOW_PROMPT_VERSION,
        reflections: [],
        memories: [],
        archives: []
    };
}

function calendarMergePlanUpdate(update) {
    const current = calendarCleanPlan(calendarPlan);
    if (!update || typeof update !== 'object') return current;
    const incoming = calendarCleanPlan({
        ...current,
        ...update,
        profile: update.profile || current.profile,
        habits: update.habits || current.habits,
        goals: Array.isArray(update.goals) ? update.goals : current.goals,
        blocks: Array.isArray(update.blocks) ? update.blocks : current.blocks
    });
    return calendarCleanPlan({
        ...incoming,
        reflections: current.reflections,
        archives: current.archives,
        memories: Array.isArray(update.memories) && update.memories.length ? incoming.memories : current.memories,
        agents: current.agents,
        workflowPrompts: current.workflowPrompts
    });
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
    const memories = Array.isArray(source.memories) ? source.memories.slice(-200) : [];
    const archives = Array.isArray(source.archives) ? source.archives.slice(-500) : [];
    const agents = Array.isArray(source.agents)
        ? source.agents.map(calendarCleanAgent).slice(0, 12)
        : CALENDAR_AGENT_ROLES.map(r => ({ ...r }));
    const workflowPrompts = calendarNormalizeWorkflowPrompts(source.workflowPrompts);

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
        reflections,
        memories,
        archives,
        agents,
        workflowPrompts
    };
}

function calendarCleanAgent(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        key: String(source.key || calendarId('agent')).slice(0, 40),
        label: String(source.label || '新 Agent').trim().slice(0, 40),
        model: String(source.model || '').trim().slice(0, 60),
        configName: String(source.configName || source.label || 'New Agent').trim().slice(0, 60),
        modelId: String(source.modelId || '').trim().slice(0, 120),
        job: String(source.job || '').trim().slice(0, 200)
    };
}

function calendarGetAgents() {
    if (Array.isArray(calendarPlan?.agents)) return calendarPlan.agents.map(a => ({ ...a }));
    return CALENDAR_AGENT_ROLES.map(a => ({ ...a }));
}

function calendarConfiguredAgents(limit = 12) {
    return calendarGetAgents().slice(0, limit);
}

function calendarDisplayPlan() {
    if (calendarPreviewDraft && calendarActiveConversation?.proposedPlan) {
        return calendarCleanPlan(calendarActiveConversation.proposedPlan);
    }
    return calendarPlan;
}

function calendarDateDiffDays(startDate, endDate) {
    const start = calendarParseDate(startDate);
    const end = calendarParseDate(endDate);
    if (!start || !end) return 0;
    return Math.round((end - start) / 86400000);
}

function calendarBlockAnchorDate(block, plan = calendarPlan) {
    return calendarCleanDate(block?.date) || calendarDateForDay(plan?.weekStart || calendarWeekStart(new Date()), block?.day || 0);
}

function calendarRepeatAllowsDate(block, dateStr, plan = calendarPlan) {
    const repeat = calendarCleanRepeat(block?.repeat);
    const anchorDate = calendarBlockAnchorDate(block, plan);
    if (!anchorDate) return false;
    const diff = calendarDateDiffDays(anchorDate, dateStr);
    if (diff < 0) return false;
    if (repeat.until && dateStr > repeat.until) return false;
    if (repeat.frequency === 'none') return dateStr === anchorDate || (!block?.date && calendarDayIndexForDate(dateStr, plan?.weekStart || calendarWeekStart(new Date())) === block?.day);
    if (repeat.frequency === 'daily') {
        const occurrence = Math.floor(diff / repeat.interval) + 1;
        return diff % repeat.interval === 0 && (!repeat.count || occurrence <= repeat.count);
    }
    if (repeat.frequency === 'weekly') {
        const weeks = Math.floor(diff / 7);
        const occurrence = weeks + 1;
        return diff % 7 === 0 && weeks % repeat.interval === 0 && (!repeat.count || occurrence <= repeat.count);
    }
    if (repeat.frequency === 'monthly') {
        const anchor = calendarParseDate(anchorDate);
        const current = calendarParseDate(dateStr);
        if (!anchor || !current || current.getDate() !== anchor.getDate()) return false;
        const months = (current.getFullYear() - anchor.getFullYear()) * 12 + current.getMonth() - anchor.getMonth();
        const occurrence = months + 1;
        return months >= 0 && months % repeat.interval === 0 && (!repeat.count || occurrence <= repeat.count);
    }
    return false;
}

function calendarBlockOccurrenceForDay(block, dayIndex, plan = calendarPlan) {
    const dateStr = calendarDateForDay(plan?.weekStart || calendarWeekStart(new Date()), dayIndex);
    if (!calendarRepeatAllowsDate(block, dateStr, plan)) return null;
    return {
        ...block,
        day: dayIndex,
        occurrenceDate: dateStr,
        occurrenceAnchorDate: calendarBlockAnchorDate(block, plan),
        recurringOccurrence: calendarCleanRepeat(block.repeat).frequency !== 'none'
    };
}

function calendarBlocksForDay(plan, dayIndex) {
    const cleanPlan = plan || calendarPlan;
    return (cleanPlan?.blocks || [])
        .map(block => calendarBlockOccurrenceForDay(block, dayIndex, cleanPlan))
        .filter(Boolean)
        .sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
}

function calendarEscapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calendarAgentMentionCommand(agent) {
    const label = String(agent?.label || agent?.key || 'agent').trim() || 'agent';
    return `@${label} `;
}

function calendarCompareBlockShape(block) {
    return JSON.stringify({
        title: block.title,
        date: block.date,
        day: block.day,
        start: block.start,
        end: block.end,
        category: block.category,
        kind: block.kind,
        repeat: calendarCleanRepeat(block.repeat),
        status: block.status,
        note: block.note,
        exactAction: block.exactAction,
        output: block.output,
        ifInterrupted: block.ifInterrupted,
        ifFinishedEarly: block.ifFinishedEarly
    });
}

function calendarDraftPlanStats(draft = calendarActiveConversation?.proposedPlan) {
    if (!draft) return null;
    const cleanDraft = calendarCleanPlan(draft);
    const baseBlocks = new Map((calendarPlan?.blocks || []).map(block => [block.id, block]));
    const draftBlocks = new Map((cleanDraft.blocks || []).map(block => [block.id, block]));
    let added = 0;
    let changed = 0;
    draftBlocks.forEach((block, id) => {
        const base = baseBlocks.get(id);
        if (!base) added += 1;
        else if (calendarCompareBlockShape(base) !== calendarCompareBlockShape(block)) changed += 1;
    });
    let removed = 0;
    baseBlocks.forEach((_, id) => {
        if (!draftBlocks.has(id)) removed += 1;
    });
    const goalDelta = (cleanDraft.goals || []).length - (calendarPlan?.goals || []).length;
    return {
        added,
        changed,
        removed,
        goalDelta,
        total: (cleanDraft.blocks || []).length
    };
}

function calendarNewAgentConversation() {
    return {
        id: calendarId('dialogue'),
        title: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entries: [],
        proposedPlan: null,
        lastAgentKeys: []
    };
}

function calendarEnsureAgentConversation() {
    if (!calendarActiveConversation || !Array.isArray(calendarActiveConversation.entries)) {
        calendarActiveConversation = calendarNewAgentConversation();
    }
    return calendarActiveConversation;
}

function calendarConversationTitle(conversation = calendarEnsureAgentConversation()) {
    const firstUser = (conversation.entries || []).find(item => item.role === 'user' && item.text);
    return conversation.title || (firstUser ? String(firstUser.text).replace(/@\S+/g, '').trim().slice(0, 34) : '新对话');
}

function calendarConversationAddEntry(entry) {
    const conversation = calendarEnsureAgentConversation();
    const record = {
        id: calendarId('msg'),
        role: String(entry.role || 'system'),
        text: entry.streaming ? (entry.text || '') : String(entry.text || '').trim(),
        agentKey: String(entry.agentKey || ''),
        agentLabel: String(entry.agentLabel || ''),
        agentModel: String(entry.agentModel || ''),
        status: String(entry.status || ''),
        at: entry.at || new Date().toISOString(),
        toolCalls: Array.isArray(entry.toolCalls) ? entry.toolCalls : undefined,
        streaming: Boolean(entry.streaming)
    };
    conversation.entries.push(record);
    conversation.entries = conversation.entries.slice(-40);
    conversation.updatedAt = new Date().toISOString();
    if (!conversation.title && entry.role === 'user') {
        conversation.title = calendarConversationTitle(conversation);
    }
    return record;
}

function calendarWorkflowStageText(title, details = []) {
    const lines = Array.isArray(details) ? details.filter(Boolean) : [String(details || '')].filter(Boolean);
    return [`Workflow · ${title}`, ...lines.map(item => `- ${item}`)].join('\n');
}

function calendarAgentMentionAliases(agent) {
    const key = String(agent?.key || '').toLowerCase();
    const label = String(agent?.label || '').toLowerCase();
    const model = String(agent?.modelId || agent?.model || '').toLowerCase();
    const base = [key, label, model].filter(Boolean);
    if (key === 'planner') return [...base, '主脑', '规划', 'claude', 'opus'];
    if (key === 'dialogue') return [...base, '挑战', '反驳', 'gemini'];
    if (key === 'auditor') return [...base, '审计', '检查', 'deepseek', 'dsk'];
    if (key === 'engineer') return [...base, '工程', '代码', 'gpt'];
    return base;
}

function calendarAgentMentioned(note, agent) {
    const text = String(note || '').toLowerCase();
    return calendarAgentMentionAliases(agent).some(alias => alias && text.includes(`@${alias}`));
}

function calendarAllAgentsMentioned(note) {
    return /@all\b|@agents\b|@全体|@所有|@全部|@全模型|@会诊|(^|\s)\/council\b|会诊|全模型|所有\s*agent|全部\s*agent/i.test(String(note || ''));
}

function calendarAgentForIntent(note, store = calendarLoadApiStore(), routeOverride = null) {
    const agents = calendarConfiguredAgents();
    if (!agents.length) return null;
    const route = routeOverride || calendarRequestRoute(note);
    const targetKey = route.agentKey;
    const target = agents.find(agent => agent.key === targetKey)
        || agents.find(agent => agent.key === 'planner')
        || agents[0];
    return {
        ...target,
        apiConfig: calendarFastMode ? calendarFastModeConfig(note, store, route).config : calendarApiProfileForAgent(target, store)
    };
}

function calendarConversationTargetAgents(note, store = calendarLoadApiStore(), routeOverride = null) {
    const agents = calendarConfiguredAgents();
    if (!agents.length) return [];
    if (calendarAllAgentsMentioned(note)) return agents;
    const mentioned = agents.filter(agent => calendarAgentMentioned(note, agent));
    if (mentioned.length) return mentioned;
    const target = calendarAgentForIntent(note, store, routeOverride);
    return target ? [target] : [];
}

function calendarStripAgentMentions(note) {
    let withoutMentions = String(note || '')
        .replace(/@all\b|@agents\b|@全体|@所有|@全部|@全模型|@会诊/ig, '')
        .trim();
    const aliases = [...new Set(calendarConfiguredAgents()
        .flatMap(calendarAgentMentionAliases)
        .filter(Boolean))]
        .sort((a, b) => b.length - a.length);
    aliases.forEach(alias => {
        withoutMentions = withoutMentions.replace(new RegExp(`@${calendarEscapeRegExp(alias)}`, 'ig'), '').trim();
    });
    withoutMentions = withoutMentions
        .replace(/@[a-z0-9._-]+/ig, '')
        .replace(/@(主脑|规划|挑战|反驳|审计|检查|工程|代码|所有|全部|全体|会诊)/g, '')
        .trim();
    return withoutMentions || String(note || '').trim();
}

function calendarConversationTargetPreview(note = calendarDraftText, store = calendarLoadApiStore()) {
    const raw = String(note || '').trim();
    const targets = calendarConversationTargetAgents(raw, store);
    const all = calendarAllAgentsMentioned(raw);
    const mentioned = !all && targets.some(agent => calendarAgentMentioned(raw, agent));
    const route = calendarRequestRoute(raw);
    const mode = all
        ? `@all · ${targets.length} agents`
        : (mentioned ? '@ 指定' : (calendarFastMode ? `Router · ${route.reason}` : '手动模型'));
    const profiles = targets.map(agent => {
        const profile = agent.apiConfig || calendarApiProfileForAgent(agent, store);
        return profile?.name || profile?.model || agent.configName || agent.model || agent.label;
    }).filter(Boolean);
    return {
        targets,
        mode,
        labels: targets.map(agent => agent.label || agent.key).join(' / ') || '无可用 agent',
        profiles: [...new Set(profiles)].join(' / '),
        engineerBoundary: targets.some(agent => agent.key === 'engineer')
    };
}

function calendarChatTargetPreviewHtml(note = calendarDraftText) {
    const preview = calendarConversationTargetPreview(note);
    return `
        <div class="ta-chat__target" id="ta-chat-target-preview">
            <span>${calendarEsc(preview.mode)}</span>
            <strong>${calendarEsc(preview.labels)}</strong>
            ${preview.profiles ? `<em>${calendarEsc(preview.profiles)}</em>` : ''}
            ${preview.engineerBoundary ? '<small>工程 agent 不直接改 GitHub 源码；行程增删改会走日历草案。</small>' : ''}
        </div>
    `;
}

function calendarRenderChatTargetPreview() {
    const el = document.getElementById('ta-chat-target-preview');
    if (!el) return;
    const preview = calendarConversationTargetPreview(calendarDraftText);
    el.innerHTML = `
        <span>${calendarEsc(preview.mode)}</span>
        <strong>${calendarEsc(preview.labels)}</strong>
        ${preview.profiles ? `<em>${calendarEsc(preview.profiles)}</em>` : ''}
        ${preview.engineerBoundary ? '<small>工程 agent 不直接改 GitHub 源码；行程增删改会走日历草案。</small>' : ''}
    `;
}

function calendarConversationContextForModel() {
    const conversation = calendarEnsureAgentConversation();
    return {
        id: conversation.id,
        title: calendarConversationTitle(conversation),
        messages: (conversation.entries || []).slice(-10).map(entry => ({
            role: entry.role,
            agent: entry.agentLabel || entry.agentKey || '',
            text: entry.text,
            at: entry.at
        })),
        recentArchives: calendarRecentArchiveContext()
    };
}

function calendarRecentArchiveContext(limit = 5) {
    return [...(calendarPlan?.archives || [])]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit)
        .map(item => ({
            id: String(item.id || ''),
            type: String(item.type || ''),
            title: String(item.title || '').slice(0, 120),
            createdAt: String(item.createdAt || ''),
            models: Array.isArray(item.models) ? item.models.slice(0, 4) : [],
            excerpt: String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 500)
        }));
}

function calendarAgentReplyText(agent, result) {
    const messages = (result?.messages || [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .filter(item => !/^输出来源|^Fast mode|Agent 和模型分离|Agent 会诊|.+Agent 使用.+返回方案/.test(item));
    if (messages.length) return messages.slice(0, 3).join('\n');
    if (agent?.key === 'auditor') return '审计完成：我已经检查冲突、低估和过载风险，并产出一个可应用的草案。';
    if (agent?.key === 'dialogue') return '挑战完成：我已经从盲区和替代方案角度给出修正。';
    if (agent?.key === 'engineer') return '工程视角完成：我只会给出 UI/API/schema/workflow 的实现建议；真正改 GitHub 源码需要在开发环境执行。行程增删改属于日历草案，不属于工程源码修改。';
    return '主脑完成：我已经把目标、估时和日历约束合成一个计划草案。';
}

function calendarConversationArchiveContent(conversation) {
    const lines = (conversation.entries || []).map(entry => {
        const time = new Date(entry.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const speaker = entry.role === 'user'
            ? 'User'
            : (entry.agentLabel || (entry.role === 'system' ? 'System' : 'Agent'));
        return `[${time}] ${speaker}: ${entry.text}`;
    });
    return [
        `Title: ${calendarConversationTitle(conversation)}`,
        `Created: ${new Date(conversation.createdAt).toLocaleString('zh-CN')}`,
        '',
        ...lines
    ].join('\n');
}

async function calendarArchiveActiveConversation() {
    const conversation = calendarEnsureAgentConversation();
    if (!conversation.entries.length || calendarAgentTurnRunning) return;
    if (conversation.proposedPlan) {
        calendarPlan = calendarMergePlanUpdate(conversation.proposedPlan);
    }
    const models = [...new Set((conversation.entries || [])
        .map(entry => entry.agentModel || entry.agentLabel)
        .filter(Boolean))].slice(0, 8);
    calendarPlan.archives = Array.isArray(calendarPlan.archives) ? calendarPlan.archives : [];
    calendarPlan.archives.push({
        id: calendarId('archive'),
        type: 'discussion',
        title: calendarConversationTitle(conversation),
        content: calendarConversationArchiveContent(conversation),
        models,
        createdAt: new Date().toISOString(),
        source: 'agent-conversation'
    });
    calendarApiStatus = conversation.proposedPlan
        ? '对话已存档，最新草案已应用到日历。'
        : '对话已存档。';
    calendarPreviewDraft = false;
    calendarActiveConversation = calendarNewAgentConversation();
    calendarDraftText = '';
    await calendarSavePlan();
}

function calendarResetAgentConversation() {
    if (calendarAgentTurnRunning) return;
    calendarPreviewDraft = false;
    calendarActiveConversation = calendarNewAgentConversation();
    calendarDraftText = '';
    calendarApiStatus = '已开启新对话。';
    calendarRender();
}

function calendarToggleDraftPreview() {
    const conversation = calendarEnsureAgentConversation();
    if (!conversation.proposedPlan || calendarAgentTurnRunning) return;
    calendarPreviewDraft = !calendarPreviewDraft;
    if (calendarPreviewDraft) {
        calendarCurrentPage = 'calendar';
        calendarChatOpen = true;
    }
    calendarApiStatus = calendarPreviewDraft
        ? '正在预览未应用草案，应用并存档后才会保存。'
        : '已关闭草案预览，当前显示已保存日历。';
    calendarRender();
}

async function calendarApplyDraftAndArchive() {
    await calendarArchiveActiveConversation();
    calendarRender();
}

function calendarDiscardDraft() {
    const conversation = calendarEnsureAgentConversation();
    if (!conversation.proposedPlan || calendarAgentTurnRunning) return;
    conversation.proposedPlan = null;
    calendarPreviewDraft = false;
    calendarConversationAddEntry({
        role: 'system',
        text: '未应用草案已丢弃，日历保持原状。'
    });
    calendarApiStatus = '草案已丢弃。';
    calendarRender();
}

async function calendarLoadLocalPlan() {
    const testSession = calendarTestSession();
    if (testSession) {
        const key = calendarTestPlanStorageKey(testSession.id);
        try {
            const stored = JSON.parse(localStorage.getItem(key));
            if (stored) return calendarCleanPlan(stored);
        } catch {}
        const seeded = calendarBuildTestPlan(testSession.id);
        localStorage.setItem(key, JSON.stringify(seeded));
        return seeded;
    }

    if (calendarEncKey) {
        try {
            const enc = JSON.parse(localStorage.getItem(CALENDAR_ENC_PLAN_KEY));
            if (enc) return calendarCleanPlan(await calendarDecrypt(calendarEncKey, enc));
        } catch {}
        return calendarDefaultPlan();
    }
    try {
        return calendarCleanPlan(JSON.parse(localStorage.getItem(CALENDAR_PLAN_STORAGE_KEY)));
    } catch {
        return calendarDefaultPlan();
    }
}

async function calendarCloudValueFromPlan(plan) {
    if (!calendarEncKey) return { encrypted: false, plan };
    return {
        encrypted: true,
        algorithm: 'AES-GCM',
        envelope: await calendarEncrypt(calendarEncKey, plan)
    };
}

async function calendarPlanFromCloudValue(value) {
    if (!value) return null;
    if (value.encrypted) {
        if (!calendarEncKey) throw new Error('cloud plan requires local password key');
        const envelope = value.envelope || value.value;
        if (!envelope?.iv || !envelope?.ct) throw new Error('cloud plan envelope is invalid');
        return calendarCleanPlan(await calendarDecrypt(calendarEncKey, envelope));
    }
    if (value.plan && typeof value.plan === 'object') return calendarCleanPlan(value.plan);
    if (value.version || value.blocks || value.goals) return calendarCleanPlan(value);
    return null;
}

async function calendarLoadPlan() {
    const localPlan = await calendarLoadLocalPlan();
    calendarPlan = localPlan;
    calendarCloudSyncBlocked = false;
    calendarSyncStatus = calendarIsTestSession()
        ? '测试账号使用本机隔离数据。'
        : (calendarCanSync() ? '正在读取云端计划...' : '此账户仅使用本机加密保存。');

    if (!calendarCanSync()) return calendarPlan;

    try {
        const user = encodeURIComponent(calendarCurrentUsername());
        const res = await fetch(`${calendarSettingsApi()}?key=${encodeURIComponent(CALENDAR_PLAN_KEY)}&user=${user}`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data.value) {
                const cloudPlan = await calendarPlanFromCloudValue(data.value);
                if (!cloudPlan) throw new Error('cloud plan is empty');
                calendarPlan = cloudPlan;
                if (calendarEncKey) {
                    localStorage.setItem(CALENDAR_ENC_PLAN_KEY, JSON.stringify(await calendarEncrypt(calendarEncKey, calendarPlan)));
                    localStorage.removeItem(CALENDAR_PLAN_STORAGE_KEY);
                } else {
                    localStorage.setItem(CALENDAR_PLAN_STORAGE_KEY, JSON.stringify(calendarPlan));
                }
                calendarSyncStatus = '已从云端同步。';
                return calendarPlan;
            }
        }
        if (res.status === 404) calendarSyncStatus = '云端同步接口未部署，正在使用本机计划。';
        else calendarSyncStatus = '云端暂无计划，正在使用本机计划。';
    } catch (error) {
        if (/decrypt|password|envelope|cloud plan/i.test(String(error.message || error))) {
            calendarCloudSyncBlocked = true;
            calendarSyncStatus = '云端计划无法用当前密码解密，已停止云端覆盖。';
        } else {
            calendarSyncStatus = '云端暂不可用，正在使用本机计划。';
        }
    }

    return calendarPlan;
}

async function calendarSavePlan(render = true) {
    calendarPlan = calendarCleanPlan(calendarPlan);
    if (calendarIsTestSession()) {
        const key = calendarTestPlanStorageKey();
        if (key) localStorage.setItem(key, JSON.stringify(calendarPlan));
        calendarSyncStatus = '测试账号已保存到本机隔离数据。';
        if (render) calendarRender();
        else calendarRenderSyncStatus();
        return;
    }

    if (calendarEncKey) {
        try {
            const enc = await calendarEncrypt(calendarEncKey, calendarPlan);
            localStorage.setItem(CALENDAR_ENC_PLAN_KEY, JSON.stringify(enc));
        } catch {}
    } else {
        localStorage.setItem(CALENDAR_PLAN_STORAGE_KEY, JSON.stringify(calendarPlan));
    }
    calendarSyncStatus = calendarCanSync() ? '正在同步计划...' : '已保存到本机。';
    calendarRenderSyncStatus();

    if (calendarCanSync()) {
        if (calendarCloudSyncBlocked) {
            calendarSyncStatus = '本机已保存；云端计划密码不匹配，未覆盖云端。';
            if (render) calendarRender();
            else calendarRenderSyncStatus();
            return;
        }
        try {
            const res = await fetch(calendarSettingsApi(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: CALENDAR_PLAN_KEY,
                    value: await calendarCloudValueFromPlan(calendarPlan),
                    user: calendarCurrentUsername()
                })
            });
            if (res.ok) calendarSyncStatus = '已保存并同步。';
            else {
                const data = await res.json().catch(() => ({}));
                calendarSyncStatus = data.error
                    ? `本机已保存，云端同步失败：${data.error}`
                    : '本机已保存，云端同步被拒绝。';
            }
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

    const restored = await calendarTrySessionRestore();
    if (restored) {
        const loadingLabel = calendarIsTestSession() ? '正在载入测试账号...' : '正在解密数据...';
        root.innerHTML = `<div class="ta-shell"><div class="ta-loading">${loadingLabel}</div></div>`;
        await calendarLoadPlan();
        calendarRender();
        calendarRefreshActivity(false);
        calendarActivityInterval = setInterval(() => calendarRefreshActivity(false), 30000);
        calendarStartClock();
    } else {
        calendarRenderAuthScreen();
    }
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
    calendarPreviewDraft = false;
    calendarPlan.weekStart = delta === 0
        ? calendarWeekStart(new Date())
        : calendarDatePlus(calendarPlan.weekStart, delta * 7);
    calendarClearBlockSelection();
    calendarSavePlan();
    calendarRefreshActivity(false);
}

function calendarRender() {
    if (!calendarPlan) return;
    const root = document.getElementById('ta-root') || document.getElementById('world-content');
    if (!root) return;
    if (calendarCurrentPage === 'calendar') calendarLastRenderedPage = 'calendar';

    root.innerHTML = `
        <div class="ta-shell${calendarChatOpen ? '' : ' ta-shell--chat-collapsed'}${calendarFirstRender ? '' : ' ta-shell--no-intro'}">
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

    calendarFirstRender = false;
    calendarRenderActualLayers();
    calendarScrollToWorkingHours();
    calendarScrollChatToBottom();
    calendarBindDragEvents();
}

function calendarSetPage(page) {
    calendarCurrentPage = page;
    if (page === 'settings' || page === 'workflow' || page === 'archive' || page === 'profile') {
        calendarChatOpen = false;
    } else {
        calendarChatOpen = true;
    }
    calendarRender();
    if (page === 'settings') calendarRefreshServerApiProfiles(true);
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
    const profileName = calendarAuthUser || calendarPlan?.profile?.name || 'User';
    const profileRole = calendarIsTestSession() ? '测试账户 · 本机隔离' : '已登录';
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
                    <span class="ta-sidebar__profile-role">${calendarEsc(profileRole)}</span>
                </div>
                <button class="ta-sidebar__logout" onclick="event.stopPropagation();calendarLogout()" title="退出登录">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                </button>
            </div>
        </nav>
    `;
}

function calendarRibbonHtml() {
    const viewPlan = calendarDisplayPlan() || calendarPlan;
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${calendarPad(now.getMonth() + 1)}/${calendarPad(now.getDate())}`;
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const total = viewPlan.blocks.length;
    const done = viewPlan.blocks.filter(b => b.status === 'done').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const hasSelection = !!calendarSelectedBlockId && !calendarPreviewDraft;
    const profileName = calendarAuthUser || calendarPlan?.profile?.name || 'User';
    const isTest = calendarIsTestSession();

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
                ${calendarPreviewDraft ? '<span class="ta-ribbon__draft">草案预览中</span>' : ''}
            </div>
            <div class="ta-ribbon__right">
                <div class="ta-ribbon__mobile-account" aria-label="当前账户">
                    <span class="ta-ribbon__mobile-avatar">${calendarEsc(profileName.charAt(0).toUpperCase())}</span>
                    <span class="ta-ribbon__mobile-name">${calendarEsc(profileName)}</span>
                    ${isTest ? '<span class="ta-ribbon__test-badge">TEST</span>' : ''}
                    <button class="ta-ribbon__mobile-logout" onclick="calendarLogout()" title="退出登录" aria-label="退出登录">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    </button>
                </div>
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
    if (!calendarPlan) return;
    calendarCurrentPage = 'calendar';
    calendarPreviewDraft = false;
    calendarRender();
    const currentDay = calendarCurrentDayIndex(calendarPlan);
    const day = currentDay >= 0 && currentDay <= 6 ? currentDay : new Date().getDay();
    const start = Math.min(CALENDAR_DAY_MINUTES - 60, Math.max(0, calendarRoundToInputStep(calendarNowMinutes() + 30)));
    const end = Math.min(CALENDAR_DAY_MINUTES, start + 60);
    setTimeout(() => {
        const col = document.getElementById(`calendar-day-${day}`);
        if (col) calendarShowQuickAdd(col, day, start, end);
    }, 0);
}

function calendarEditSelectedBlock() {
    if (!calendarSelectedBlockId) return;
    calendarEditingBlockId = calendarSelectedBlockId;
    calendarEditingOccurrenceDate = calendarSelectedOccurrenceDate;
    calendarRender();
}

function calendarCalendarHeadHtml() {
    const viewPlan = calendarDisplayPlan() || calendarPlan;
    const todayIndex = calendarCurrentDayIndex(viewPlan);
    const dayLoads = new Array(7).fill(0);
    viewPlan.blocks.forEach(b => { dayLoads[b.day] += Math.max(0, b.end - b.start); });

    return `
        <div class="ta-calendar__head">
            <div class="ta-calendar__week-nav">
                <button class="ta-calendar__week-btn" onclick="calendarMoveWeek(-1)" title="上一周">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <span class="ta-calendar__week-label">${calendarEsc(calendarWeekRangeLabel(viewPlan.weekStart))}</span>
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
                    const dateStr = calendarDateForDay(viewPlan.weekStart, index);
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

function calendarChatAgentChipsHtml() {
    const agents = calendarConfiguredAgents();
    return [
        '<button class="ta-chat__chip" onclick="calendarInsertCommand(\'@all \')" title="调用当前配置里的所有 agent">@all</button>',
        ...agents.map((agent, index) => `
            <button class="ta-chat__chip" onclick="calendarInsertAgentMention(${index})" title="${calendarEsc(agent.job || agent.model || agent.key)}">
                @${calendarEsc(agent.label || agent.key)}
            </button>
        `)
    ].join('');
}

function calendarDraftSummaryText(stats) {
    if (!stats) return '有未应用草案';
    const parts = [
        stats.added ? `新增 ${stats.added}` : '',
        stats.changed ? `修改 ${stats.changed}` : '',
        stats.removed ? `删除 ${stats.removed}` : '',
        stats.goalDelta ? `目标 ${stats.goalDelta > 0 ? '+' : ''}${stats.goalDelta}` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : `共 ${stats.total} 个时间块`;
}

function calendarConversationDraftHtml(conversation) {
    if (!conversation?.proposedPlan) return '';
    const stats = calendarDraftPlanStats(conversation.proposedPlan);
    const previewLabel = calendarPreviewDraft ? '关闭预览' : '预览草案';
    return `
        <div class="ta-chat__draft">
            <div class="ta-chat__draft-main">
                <span>未应用草案</span>
                <strong>${calendarEsc(calendarDraftSummaryText(stats))}</strong>
                <small>预览不会保存，应用并存档后才写入日历。</small>
            </div>
            <div class="ta-chat__draft-actions">
                <button type="button" onclick="calendarToggleDraftPreview()" ${calendarAgentTurnRunning ? 'disabled' : ''}>${calendarEsc(previewLabel)}</button>
                <button type="button" class="ta-chat__draft-primary" onclick="calendarApplyDraftAndArchive()" ${calendarAgentTurnRunning ? 'disabled' : ''}>应用并存档</button>
                <button type="button" onclick="calendarDiscardDraft()" ${calendarAgentTurnRunning ? 'disabled' : ''}>丢弃</button>
            </div>
        </div>
    `;
}

function calendarAgentThinkingText() {
    const elapsed = calendarAgentTurnStartedAt
        ? Math.max(0, Math.round((Date.now() - calendarAgentTurnStartedAt) / 1000))
        : 0;
    const label = calendarAgentTurnLabel || 'Agent 正在回复';
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const elapsedText = elapsed ? `已等待 ${minutes ? `${minutes}分` : ''}${seconds}秒` : '正在启动';
    const opusHint = /主脑|opus|claude/i.test(label)
        ? '\nOpus 深度规划可能需要 1-3 分钟；现在会优先等待主脑，不会 45 秒就切走。'
        : '';
    return `${label}...\n${elapsedText}${opusHint}`;
}

function calendarStartAgentThinking(label) {
    calendarAgentTurnRunning = true;
    calendarAgentTurnStartedAt = Date.now();
    calendarAgentTurnLabel = label || 'Agent 正在回复';
    if (calendarAgentTurnTick) clearInterval(calendarAgentTurnTick);
    calendarAgentTurnTick = setInterval(() => {
        if (!calendarAgentTurnRunning) return;
        calendarRender();
    }, 5000);
}

function calendarStopAgentThinking() {
    calendarAgentTurnRunning = false;
    calendarAgentTurnStartedAt = null;
    calendarAgentTurnLabel = '';
    if (calendarAgentTurnTick) clearInterval(calendarAgentTurnTick);
    calendarAgentTurnTick = null;
}

function calendarChatPanelHtml() {
    const conversation = calendarEnsureAgentConversation();
    const apiStore = calendarLoadApiStore();
    const activeProfile = apiStore.profiles.find(item => item.id === apiStore.activeId)
        || apiStore.profiles[0]
        || calendarDefaultApiConfig();
    const headerStatus = calendarAgentTurnRunning
        ? 'Streaming...'
        : activeProfile.name;
    const canArchive = conversation.entries.length && !calendarAgentTurnRunning;
    const chatModelOptions = apiStore.profiles.map(p =>
        `<option value="${calendarEsc(p.id)}"${p.id === apiStore.activeId ? ' selected' : ''}>${calendarEsc(p.name)}</option>`
    ).join('');
    return `
        <aside class="ta-chat${calendarChatOpen ? '' : ' ta-chat--collapsed'}">
            <div class="ta-chat__header" onclick="calendarToggleChat()">
                <div class="ta-chat__avatar">A</div>
                <div class="ta-chat__header-info">
                    <div class="ta-chat__header-title">AI Assistant</div>
                    <div class="ta-chat__header-status">${calendarEsc(headerStatus)}</div>
                </div>
                <span class="ta-chat__header-toggle${calendarChatOpen ? '' : ' ta-chat__header-toggle--collapsed'}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </span>
            </div>
            <div class="ta-chat__model-bar" onclick="event.stopPropagation()">
                <select id="ta-chat-model-select" class="ta-chat__model-select" title="选择对话模型" onchange="calendarSwitchChatModel(this.value)">
                    ${chatModelOptions}
                </select>
            </div>
            <div class="ta-chat__body">
                <div class="ta-chat__session">
                    <div class="ta-chat__session-main">
                        <span>当前对话</span>
                        <strong>${calendarEsc(calendarConversationTitle(conversation))}</strong>
                    </div>
                    <div class="ta-chat__session-actions">
                        <button type="button" onclick="calendarArchiveActiveConversation()" ${canArchive ? '' : 'disabled'}>${conversation.proposedPlan ? '应用并存档' : '存档结束'}</button>
                        <button type="button" onclick="calendarResetAgentConversation()" ${calendarAgentTurnRunning ? 'disabled' : ''}>新对话</button>
                    </div>
                </div>
                ${calendarConversationDraftHtml(conversation)}
                <div class="ta-chat__messages" id="ta-chat-messages">
                    ${conversation.entries.length ? conversation.entries.map(entry => calendarChatEntryHtml(entry)).join('') : ''}
                </div>
                <div class="ta-chat__input-area">
                    <div class="ta-chat__input-wrap">
                        <textarea id="ta-chat-input" class="ta-chat__input" placeholder="Type your message..." rows="1"
                            ${calendarAgentTurnRunning ? 'disabled' : ''}
                            oninput="calendarDraftText=this.value; this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,80)+'px'"
                            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();calendarSendChatMessage()}">${calendarEsc(calendarDraftText)}</textarea>
                    </div>
                    ${calendarAgentTurnRunning ? `
                    <button class="ta-chat__stop" onclick="calendarStopStreaming()" title="停止生成">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                    </button>
                    ` : `
                    <button class="ta-chat__summarize" onclick="calendarSummarizeAndApply()" title="总结并应用" ${conversation.entries.length < 2 ? 'disabled' : ''}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    </button>
                    <button class="ta-chat__send" onclick="calendarSendChatMessage()" title="发送">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                    </button>
                    `}
                </div>
            </div>
        </aside>
    `;
}

function calendarChatEntryHtml(entry) {
    const time = new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (entry.role === 'user') {
        return `
            <div class="ta-chat__bubble ta-chat__bubble--user">
                ${calendarEsc(entry.text)}
                <span class="ta-chat__bubble-time">${time}</span>
            </div>
        `;
    }
    const agentHead = entry.agentLabel
        ? `<div class="ta-chat__agent-head"><span>${calendarEsc(entry.agentLabel)}</span><em>${calendarEsc(entry.agentModel || 'agent')}</em></div>`
        : '';
    const statusClass = entry.status === 'error'
        ? ' ta-chat__bubble--error'
        : (entry.status === 'workflow' ? ' ta-chat__bubble--workflow' : '');
    const className = (entry.role === 'system'
        ? 'ta-chat__bubble ta-chat__bubble--ai ta-chat__bubble--system'
        : 'ta-chat__bubble ta-chat__bubble--ai ta-chat__bubble--agent') + statusClass;
    const streamId = entry.streaming ? ' id="ta-streaming-bubble"' : '';
    const toolCardsHtml = Array.isArray(entry.toolCalls) && entry.toolCalls.length
        ? `<div class="ta-chat__tool-cards">${entry.toolCalls.map(calendarToolCallCardHtml).join('')}</div>`
        : (entry.streaming ? '<div class="ta-chat__tool-cards"></div>' : '');
    const cursor = entry.streaming ? '<span class="ta-chat__cursor">|</span>' : '';
    return `
        <div class="${className}"${streamId}>
            ${agentHead}
            <div class="ta-chat__bubble-text">${calendarEsc(entry.text || '').replace(/\n/g, '<br>')}${cursor}</div>
            ${toolCardsHtml}
            <span class="ta-chat__bubble-time">${time}</span>
        </div>
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

// --- Fast Path natural-language parser (no LLM) ---

function calendarTryFastPath(note) {
    if (!note || typeof note !== 'string') return { hit: false, reason: 'empty input' };
    let text = note.trim();
    if (text.length < 2) return { hit: false, reason: 'too short' };

    const now = new Date();
    const todayStr = calendarFormatDate(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // --- Chinese number mapping ---
    const cnNum = { '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12 };
    const parseCnNum = s => cnNum[s] !== undefined ? cnNum[s] : parseInt(s, 10);

    // --- Date parsing ---
    let dateStr = null;
    let dateLabel = '';
    const datePatterns = [
        [/^今天/, () => todayStr, '今天'],
        [/^明天/, () => calendarDatePlus(todayStr, 1), '明天'],
        [/^后天/, () => calendarDatePlus(todayStr, 2), '后天'],
        [/^大后天/, () => calendarDatePlus(todayStr, 3), '大后天'],
        [/^today\b/i, () => todayStr, 'today'],
        [/^tomorrow\b/i, () => calendarDatePlus(todayStr, 1), 'tomorrow'],
    ];
    for (const [rx, fn, label] of datePatterns) {
        if (rx.test(text)) { dateStr = fn(); dateLabel = label; text = text.replace(rx, '').trim(); break; }
    }

    // 下下周X / 下周X / 周X (Chinese weekday)
    if (!dateStr) {
        const wkMatch = text.match(/^(下下周|下周|周)(一|二|三|四|五|六|日|天)/);
        if (wkMatch) {
            const wdMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0 };
            const targetWd = wdMap[wkMatch[2]];
            const todayWd = now.getDay();
            let diff;
            if (wkMatch[1] === '下下周') { diff = (targetWd - todayWd + 7) % 7 + 14; }
            else if (wkMatch[1] === '下周') { diff = (targetWd - todayWd + 7) % 7 + 7; }
            else { diff = (targetWd - todayWd + 7) % 7; if (diff === 0) diff = 7; }
            dateStr = calendarDatePlus(todayStr, diff);
            dateLabel = wkMatch[0];
            text = text.slice(wkMatch[0].length).trim();
        }
    }

    // English weekday: (next )monday..sunday
    if (!dateStr) {
        const enWdMatch = text.match(/^(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i);
        if (enWdMatch) {
            const enWdMap = { sun:0,sunday:0,mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6 };
            const targetWd = enWdMap[enWdMatch[2].toLowerCase()];
            const todayWd = now.getDay();
            const isNext = !!enWdMatch[1];
            let diff = (targetWd - todayWd + 7) % 7;
            if (diff === 0) diff = 7;
            if (isNext) diff += 7;
            dateStr = calendarDatePlus(todayStr, diff);
            dateLabel = enWdMatch[0].trim();
            text = text.slice(enWdMatch[0].length).trim();
        }
    }

    // Explicit dates: 5月24号, 5月24日, 5.24, May 24, 2026-05-24, 2026/05/24
    if (!dateStr) {
        const explicitPatterns = [
            [/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, (m) => `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`],
            [/^(\d{1,2})月(\d{1,2})[号日]?/, (m) => `${now.getFullYear()}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`],
            [/^(\d{1,2})\.(\d{1,2})(?!\d)/, (m) => `${now.getFullYear()}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`],
            [/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i, (m) => {
                const enMon = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
                const mo = enMon[m[1].toLowerCase()];
                return `${now.getFullYear()}-${String(mo).padStart(2,'0')}-${m[2].padStart(2,'0')}`;
            }],
        ];
        for (const [rx, fn] of explicitPatterns) {
            const m = text.match(rx);
            if (m) { dateStr = fn(m); dateLabel = m[0]; text = text.slice(m[0].length).trim(); break; }
        }
    }

    // --- Time range parsing ---
    let startMin = null, endMin = null;

    // Helper: parse HH:MM or Hpm/Ham into minutes
    const parseClockEn = (h, m, ampm) => {
        let hr = parseInt(h, 10);
        const mi = m ? parseInt(m, 10) : 0;
        if (ampm) {
            const p = ampm.toLowerCase();
            if (p === 'pm' && hr < 12) hr += 12;
            if (p === 'am' && hr === 12) hr = 0;
        }
        return hr * 60 + mi;
    };

    // 24h range: 14:00-16:00 or 14:00到16:00
    const range24 = text.match(/(\d{1,2}):(\d{2})\s*[-–到]\s*(\d{1,2}):(\d{2})/);
    if (range24) {
        startMin = parseInt(range24[1],10)*60 + parseInt(range24[2],10);
        endMin = parseInt(range24[3],10)*60 + parseInt(range24[4],10);
        text = text.replace(range24[0], ' ').trim();
    }

    // English range: 2-4pm, 2pm-4pm
    if (startMin === null) {
        const rangeEn = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
        if (rangeEn) {
            const endAmpm = rangeEn[6];
            const startAmpm = rangeEn[3] || endAmpm; // inherit pm from end
            startMin = parseClockEn(rangeEn[1], rangeEn[2], startAmpm);
            endMin = parseClockEn(rangeEn[4], rangeEn[5], endAmpm);
            text = text.replace(rangeEn[0], ' ').trim();
        }
    }

    // Chinese time range: X点到Y点 (with optional period prefixes)
    if (startMin === null) {
        const cnPeriod = { '凌晨':0,'早上':0,'上午':0,'中午':12,'下午':12,'晚上':12 };
        const cnRangeRx = /(?:(凌晨|早上|上午|中午|下午|晚上)\s*)?([\d一二两三四五六七八九十]+)点(?:(\d{1,2}|半)分?)?\s*[-–到]\s*(?:(凌晨|早上|上午|中午|下午|晚上)\s*)?([\d一二两三四五六七八九十]+)点(?:(\d{1,2}|半)分?)?/;
        const cnR = text.match(cnRangeRx);
        if (cnR) {
            let h1 = parseCnNum(cnR[2]), m1 = cnR[3] === '半' ? 30 : (cnR[3] ? parseInt(cnR[3],10) : 0);
            let h2 = parseCnNum(cnR[5]), m2 = cnR[6] === '半' ? 30 : (cnR[6] ? parseInt(cnR[6],10) : 0);
            if (cnR[1] && cnPeriod[cnR[1]] === 12 && h1 < 12) h1 += 12;
            if (cnR[4] && cnPeriod[cnR[4]] === 12 && h2 < 12) h2 += 12;
            if (!cnR[1] && !cnR[4] && h1 <= 6 && h2 <= 12) { h1 += 12; h2 += 12; } // bare 两点到四点 => afternoon
            if (!cnR[4] && cnR[1] && cnPeriod[cnR[1]] === 12 && h2 < 12) h2 += 12; // inherit period
            startMin = h1 * 60 + m1;
            endMin = h2 * 60 + m2;
            text = text.replace(cnR[0], ' ').trim();
        }
    }

    // Single Chinese time: 下午两点半, 上午9点, 晚上8点
    if (startMin === null) {
        const cnPeriod = { '凌晨':0,'早上':0,'上午':0,'中午':12,'下午':12,'晚上':12 };
        const cnTimeRx = /(?:(凌晨|早上|上午|中午|下午|晚上)\s*)?([\d一二两三四五六七八九十]+)点(?:(\d{1,2}|半)分?)?/;
        const cnT = text.match(cnTimeRx);
        if (cnT) {
            let hr = parseCnNum(cnT[2]), mi = cnT[3] === '半' ? 30 : (cnT[3] ? parseInt(cnT[3],10) : 0);
            if (cnT[1] && cnPeriod[cnT[1]] === 12 && hr < 12) hr += 12;
            else if (!cnT[1] && hr >= 1 && hr <= 6) hr += 12; // bare 两点 => 14:00
            startMin = hr * 60 + mi;
            text = text.replace(cnT[0], ' ').trim();
        }
    }

    // Single English time: 2pm, 2:30pm, 14:00
    if (startMin === null) {
        const enTime = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || text.match(/\b(\d{1,2}):(\d{2})\b/);
        if (enTime) {
            startMin = parseClockEn(enTime[1], enTime[2], enTime[3]);
            text = text.replace(enTime[0], ' ').trim();
        }
    }

    if (startMin === null) return { hit: false, reason: 'no time info' };

    // --- Duration parsing (only if no end time yet) ---
    let durationMin = null;
    if (endMin === null) {
        const durPatterns = [
            [/(\d+(?:\.\d+)?)\s*小时/, m => Math.round(parseFloat(m[1]) * 60)],
            [/半小时/, () => 30],
            [/(\d+)\s*分钟/, m => parseInt(m[1], 10)],
            [/(\d+(?:\.\d+)?)\s*h\s*(\d+)\s*m/i, m => Math.round(parseFloat(m[1]) * 60) + parseInt(m[2], 10)],
            [/(\d+(?:\.\d+)?)\s*h\b/i, m => Math.round(parseFloat(m[1]) * 60)],
            [/(\d+)\s*min\b/i, m => parseInt(m[1], 10)],
        ];
        for (const [rx, fn] of durPatterns) {
            const dm = text.match(rx);
            if (dm) { durationMin = fn(dm); text = text.replace(dm[0], ' ').trim(); break; }
        }
    }

    if (endMin === null) endMin = startMin + (durationMin || 60);

    // --- Date default: today, or tomorrow if past start ---
    if (!dateStr) {
        dateStr = (nowMinutes >= startMin) ? calendarDatePlus(todayStr, 1) : todayStr;
        dateLabel = (nowMinutes >= startMin) ? '明天(自动)' : '今天(自动)';
    }

    // --- Category detection ---
    const catRules = [
        [/学习|作业|复习|考试|阅读|study|homework|review|exam|read/i, 'study'],
        [/健身|运动|跑步|游泳|workout|exercise|run|swim/i, 'workout'],
        [/开会|会议|面试|meeting|interview/i, 'admin'],
        [/休息|午睡|放松|rest|nap|relax/i, 'rest'],
    ];
    let category = 'deep';
    for (const [rx, cat] of catRules) {
        if (rx.test(text)) { category = cat; break; }
    }

    // --- Title extraction (everything remaining) ---
    let title = text.replace(/\s+/g, ' ').trim();
    if (!title) return { hit: false, reason: 'no title' };

    // --- Compute day index from date ---
    const parsed = calendarParseDate(dateStr);
    const dayIndex = parsed ? parsed.getDay() : now.getDay();

    // --- Confidence ---
    let confidence = 0.7;
    if (dateLabel && !dateLabel.includes('自动')) confidence += 0.1;
    if (durationMin !== null || (endMin !== startMin + 60)) confidence += 0.1;
    if (title.length >= 2) confidence += 0.05;
    confidence = Math.min(confidence, 0.95);

    const event = {
        id: calendarId('block'),
        title,
        date: dateStr,
        day: dayIndex,
        start: startMin,
        end: endMin,
        category,
        kind: 'general',
        repeat: { frequency: 'none', interval: 1 },
        note: '',
        status: 'planned',
        source: 'fast-path'
    };

    const explanation = calendarFastPathExplanation(event, dateLabel);

    return { hit: true, confidence: Math.round(confidence * 100) / 100, event, explanation };
}

function calendarFastPathExplanation(event, dateLabel) {
    const fmtTime = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const catNames = { deep:'专注', study:'学习', workout:'运动', admin:'事务', rest:'休息' };
    const catLabel = catNames[event.category] || event.category;
    const dl = dateLabel || event.date;
    return `已解析：${dl} ${fmtTime(event.start)}-${fmtTime(event.end)} ${event.title}（${catLabel}）`;
}

// --- Streaming chat infrastructure ---

function calendarBuildCompactContext() {
    const plan = calendarPlan || {};
    const profile = plan.profile || {};
    const habits = plan.habits || {};
    const parts = [];

    const p = [];
    if (profile.name) p.push(profile.name);
    if (profile.timezone) p.push(profile.timezone);
    if (habits.wake != null) p.push(`wake ${calendarMinutesToTimeStr(habits.wake)}`);
    if (habits.sleep != null) p.push(`sleep ${calendarMinutesToTimeStr(habits.sleep)}`);
    if (profile.weeklyCapacityHours) p.push(`${profile.weeklyCapacityHours}h/week`);
    if (p.length) parts.push(`[Profile] ${p.join(' | ')}`);

    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    parts.push(`[Today] ${dateStr} ${dayNames[now.getDay()]}, week of ${plan.weekStart || 'unknown'}`);

    const blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
    if (blocks.length) {
        const compact = blocks.slice(0, 30).map(b => {
            const time = `${calendarMinutesToTimeStr(b.start || 0)}-${calendarMinutesToTimeStr(b.end || 0)}`;
            const dateLabel = b.date || `day${b.day}`;
            const repeat = b.repeat?.frequency && b.repeat.frequency !== 'none' ? ` | repeat:${b.repeat.frequency}` : '';
            return `${b.id} | ${b.title} | ${dateLabel} ${time} | ${b.category || 'general'}/${b.kind || 'general'}${repeat}`;
        }).join('\n');
        parts.push(`[Blocks]\n${compact}`);
    } else {
        parts.push('[Blocks]\n(empty)');
    }

    const goals = Array.isArray(plan.goals) ? plan.goals.filter(g => g.status === 'active') : [];
    if (goals.length) {
        const compact = goals.slice(0, 10).map(g => {
            const deadline = g.deadline ? ` | deadline ${g.deadline}` : '';
            const weekly = g.weeklyTarget ? ` | ${g.weeklyTarget}` : '';
            return `${g.id} | ${g.title}${deadline}${weekly}`;
        }).join('\n');
        parts.push(`[Goals]\n${compact}`);
    }

    return parts.join('\n\n');
}

function calendarMinutesToTimeStr(m) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function calendarRecentMessages(limit) {
    const conversation = calendarActiveConversation || {};
    const entries = Array.isArray(conversation.entries) ? conversation.entries : [];
    const messages = [];
    const recent = entries.slice(-(limit || 10));
    for (const entry of recent) {
        if (entry.role === 'user') {
            messages.push({ role: 'user', content: entry.text || '' });
        } else if (entry.role === 'agent' && entry.text) {
            messages.push({ role: 'assistant', content: entry.text });
        }
    }
    return messages;
}

function calendarParseSSEBuffer(raw) {
    const events = [];
    const chunks = raw.split('\n\n');
    for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        let eventType = 'message';
        let data = '';
        for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
            else if (line.startsWith('data:')) data += line.slice(5);
        }
        if (data) {
            try {
                events.push({ event: eventType, data: JSON.parse(data) });
            } catch {}
        }
    }
    return events;
}

function calendarApplyToolCallsToPlan(toolCalls, basePlan) {
    const draft = JSON.parse(JSON.stringify(basePlan || calendarPlan));
    if (!Array.isArray(draft.blocks)) draft.blocks = [];
    if (!Array.isArray(draft.goals)) draft.goals = [];
    if (!draft.profile) draft.profile = {};

    for (const tc of toolCalls) {
        if (!tc.valid) continue;
        const args = tc.args || {};
        switch (tc.name) {
            case 'create_event': {
                const block = {
                    id: calendarId('block'),
                    title: args.title || 'Untitled',
                    date: args.date || '',
                    day: args.day ?? new Date().getDay(),
                    start: args.start ?? 0,
                    end: args.end ?? 60,
                    category: args.category || 'deep',
                    kind: args.kind || 'general',
                    repeat: args.repeat || { frequency: 'none', interval: 1 },
                    goalId: args.goalId || '',
                    note: args.note || '',
                    exactAction: args.exactAction || '',
                    output: args.output || '',
                    ifInterrupted: args.ifInterrupted || '',
                    ifFinishedEarly: args.ifFinishedEarly || '',
                    status: 'planned',
                    source: 'agent:stream'
                };
                draft.blocks.push(block);
                break;
            }
            case 'update_event': {
                const block = draft.blocks.find(b => b.id === args.targetId);
                if (block) {
                    const { targetId, ...updates } = args;
                    Object.assign(block, updates);
                }
                break;
            }
            case 'delete_event': {
                draft.blocks = draft.blocks.filter(b => b.id !== args.targetId);
                break;
            }
            case 'move_event': {
                const block = draft.blocks.find(b => b.id === args.targetId);
                if (block) {
                    if (args.date !== undefined) block.date = args.date;
                    if (args.day !== undefined) block.day = args.day;
                    if (args.start !== undefined) block.start = args.start;
                    if (args.end !== undefined) block.end = args.end;
                }
                break;
            }
            case 'resize_event': {
                const block = draft.blocks.find(b => b.id === args.targetId);
                if (block) {
                    if (args.start !== undefined) block.start = args.start;
                    if (args.end !== undefined) block.end = args.end;
                }
                break;
            }
            case 'create_goal': {
                draft.goals.push({
                    id: calendarId('goal'),
                    title: args.title || 'Untitled Goal',
                    type: args.type || '',
                    desiredOutcome: args.desiredOutcome || '',
                    deadline: args.deadline || '',
                    successCriteria: args.successCriteria || '',
                    currentBaseline: args.currentBaseline || '',
                    gap: args.gap || '',
                    requiredDeliverables: args.requiredDeliverables || [],
                    requiredSkills: args.requiredSkills || [],
                    estimatedWorkload: args.estimatedWorkload || {},
                    risks: args.risks || [],
                    dependencies: args.dependencies || [],
                    priority: args.priority || 'medium',
                    consequenceIfDelayed: args.consequenceIfDelayed || '',
                    weeklyTarget: args.weeklyTarget || '',
                    dailyMinimum: args.dailyMinimum || '',
                    status: 'active',
                    createdAt: new Date().toISOString()
                });
                break;
            }
            case 'update_profile': {
                Object.assign(draft.profile, args);
                break;
            }
        }
    }
    return draft;
}

function calendarToolCallCardHtml(tc) {
    const ops = {
        create_event: { icon: '+', label: 'Created', cls: 'create' },
        update_event: { icon: '~', label: 'Updated', cls: 'update' },
        delete_event: { icon: '-', label: 'Deleted', cls: 'delete' },
        move_event: { icon: '~', label: 'Moved', cls: 'move' },
        resize_event: { icon: '~', label: 'Resized', cls: 'resize' },
        create_goal: { icon: '+', label: 'Goal', cls: 'create' },
        update_profile: { icon: '~', label: 'Profile', cls: 'update' },
        propose_memory: { icon: '+', label: 'Memory', cls: 'create' }
    };
    const op = ops[tc.name] || { icon: '?', label: tc.name, cls: 'update' };
    if (!tc.valid) {
        return `<div class="ta-chat__tool-card ta-chat__tool-card--invalid">${calendarEsc(op.icon)} ${calendarEsc(op.label)}: ${calendarEsc(tc.error || 'invalid')}</div>`;
    }
    const args = tc.args || {};
    let detail = '';
    if (tc.name === 'create_event' || tc.name === 'update_event' || tc.name === 'move_event') {
        const parts = [];
        if (args.title) parts.push(args.title);
        if (args.date) parts.push(args.date);
        if (args.start != null && args.end != null) parts.push(`${calendarMinutesToTimeStr(args.start)}-${calendarMinutesToTimeStr(args.end)}`);
        if (args.category) parts.push(args.category);
        detail = parts.join(' | ');
    } else if (tc.name === 'delete_event') {
        detail = args.targetId || '';
        if (args.reason) detail += ` (${args.reason})`;
    } else if (tc.name === 'resize_event') {
        const parts = [];
        if (args.targetId) parts.push(args.targetId);
        if (args.end != null) parts.push(`end ${calendarMinutesToTimeStr(args.end)}`);
        detail = parts.join(' | ');
    } else if (tc.name === 'create_goal') {
        detail = args.title || '';
    } else if (tc.name === 'update_profile') {
        detail = Object.keys(args).join(', ');
    } else if (tc.name === 'propose_memory') {
        detail = args.content || args.key || '';
    }
    return `<div class="ta-chat__tool-card ta-chat__tool-card--${calendarEsc(op.cls)}">${calendarEsc(op.icon)} ${calendarEsc(op.label)}: ${calendarEsc(detail)}</div>`;
}

function calendarResolveStreamConfig(note) {
    const store = calendarLoadApiStore();
    const agents = calendarConfiguredAgents();
    const prompts = calendarNormalizeWorkflowPrompts(calendarPlan?.workflowPrompts);
    const globalPrompt = prompts.globalPrompt || '';

    const mentionedAgent = agents.find(agent => calendarAgentMentioned(note, agent));
    if (mentionedAgent) {
        const profile = calendarApiProfileForAgent(mentionedAgent, store);
        const agentPrompt = prompts.agents[mentionedAgent.key] || '';
        const roleHint = [globalPrompt, agentPrompt].filter(Boolean).join('\n\n');
        return {
            profile: profile || store.profiles.find(calendarApiProfileIsReady) || calendarDefaultApiConfig(),
            roleHint,
            agentLabel: mentionedAgent.label || mentionedAgent.key,
            agentModel: profile?.model || mentionedAgent.modelId || ''
        };
    }

    const activeProfile = store.profiles.find(p => p.id === store.activeId) || store.profiles[0] || calendarDefaultApiConfig();
    return { profile: activeProfile, roleHint: globalPrompt, agentLabel: '', agentModel: activeProfile.model || '' };
}

async function calendarStreamChatRequest(note, profile, roleHint) {
    const plan = calendarPlan || {};
    const conversation = calendarRecentMessages(10);
    const context = calendarBuildCompactContext();

    const clientConfigs = calendarClientConfigsForProfile(profile);
    const requestBody = {
        stream: true,
        message: note,
        plan: { ...plan, blocks: (plan.blocks || []).slice(0, 30), archives: undefined, reflections: undefined, memories: undefined },
        conversation,
        roleHint: roleHint || '',
        user: calendarCurrentUsername() || 'public'
    };
    if (clientConfigs.length) {
        requestBody.clientConfigs = clientConfigs;
    } else {
        requestBody.clientConfig = calendarPublicApiRequestConfig(profile);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALENDAR_ARCHITECT_CLIENT_TIMEOUT_MS);

    try {
        const response = await fetch(CALENDAR_ARCHITECT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        if (!response.ok) {
            clearTimeout(timer);
            const text = await response.text().catch(() => '');
            throw new Error(`API ${response.status}: ${text.slice(0, 300)}`);
        }

        clearTimeout(timer);
        return { reader: response.body.getReader(), controller };
    } catch (error) {
        clearTimeout(timer);
        throw error;
    }
}

async function calendarSendChatMessage() {
    if (calendarAgentTurnRunning) return;
    const input = document.getElementById('ta-chat-input');
    const note = (input?.value || calendarDraftText || '').trim();
    if (!note || !calendarPlan) return;
    calendarDraftText = '';
    if (input) input.value = '';

    if (/^\/?(save|done|finish|archive|end|存档|结束|完成)$/i.test(note)) {
        await calendarArchiveActiveConversation();
        return;
    }
    if (/^\/?(new|reset-chat|新对话|重新开始)$/i.test(note)) {
        calendarResetAgentConversation();
        return;
    }

    calendarConversationAddEntry({ role: 'user', text: note });
    calendarRender();
    await calendarRunAgentConversationTurn(note);
    calendarRender();
}

function calendarDraftHasMeaningfulChanges(draft) {
    const stats = calendarDraftPlanStats(draft);
    return !!(stats && (stats.added || stats.changed || stats.removed || stats.goalDelta));
}

function calendarStopStreaming() {
    if (calendarActiveStreamController) {
        try { calendarActiveStreamController.abort(); } catch {}
        calendarActiveStreamController = null;
    }
}

function calendarBuildSummaryPrompt() {
    const conversation = calendarActiveConversation || {};
    const entries = Array.isArray(conversation.entries) ? conversation.entries : [];
    const lines = entries.filter(e => e.role === 'user' || e.role === 'agent')
        .map(e => `${e.role === 'user' ? '用户' : 'AI'}: ${(e.text || '').slice(0, 500)}`)
        .join('\n');
    return `根据我们刚才的对话内容，请总结并执行需要进行的所有修改：

1. 日历事件：需要 增加/修改/删除/移动 的事件（使用 create_event / update_event / delete_event / move_event 工具）
2. 个人资料：需要更新的 profile 字段（使用 update_profile 工具）

请先用一两句话说明你要做什么，然后直接用工具调用执行。如果对话中没有需要修改的内容，请说明"当前对话无需修改日历或资料"。

以下是对话记录：
${lines}`;
}

async function calendarSummarizeAndApply() {
    if (calendarAgentTurnRunning) return;
    const conversation = calendarEnsureAgentConversation();
    if (conversation.entries.length < 2) return;

    const summaryPrompt = calendarBuildSummaryPrompt();
    calendarConversationAddEntry({ role: 'user', text: '📋 总结对话并应用修改' });
    calendarRender();
    await calendarRunAgentConversationTurn(summaryPrompt);
    calendarRender();
}

async function calendarRunAgentConversationTurn(note) {
    const conversation = calendarEnsureAgentConversation();
    const cleanNote = calendarStripAgentMentions(note);

    if (calendarAllAgentsMentioned(note)) {
        calendarConversationAddEntry({ role: 'system', text: 'Council mode (@all) coming soon. Use @ to target a single agent, or send without @ for the default model.' });
        return;
    }

    const hasMention = calendarConfiguredAgents().some(a => calendarAgentMentioned(note, a));

    // --- Fast Path: simple calendar input, no @ mention ---
    if (!hasMention) {
        const fast = calendarTryFastPath(cleanNote);
        if (fast.hit && fast.confidence >= 0.8) {
            const toolCall = { name: 'create_event', args: fast.event, valid: true };
            const draft = calendarApplyToolCallsToPlan([toolCall], calendarPlan);
            if (calendarDraftHasMeaningfulChanges(draft)) {
                calendarConversationAddEntry({
                    role: 'agent',
                    agentLabel: 'Fast',
                    agentModel: 'local',
                    text: fast.explanation,
                    toolCalls: [toolCall]
                });
                conversation.proposedPlan = draft;
                calendarPreviewDraft = true;
                calendarCurrentPage = 'calendar';
                calendarChatOpen = true;
                calendarConversationAddEntry({
                    role: 'system',
                    text: '已生成草案预览。满意后点”应用并存档”，不满意可继续对话调整或点”丢弃”。'
                });
                calendarRender();
                return;
            }
        }
    }

    // --- Streaming LLM path ---
    const { profile, roleHint, agentLabel, agentModel } = calendarResolveStreamConfig(note);
    const displayLabel = agentLabel || profile.name || profile.model || 'AI';
    calendarStartAgentThinking(`${displayLabel} 正在回复`);
    calendarApiStatus = `Streaming: ${displayLabel}...`;
    calendarRender();

    const streamEntry = calendarConversationAddEntry({
        role: 'agent',
        agentLabel: agentLabel || '',
        agentModel: agentModel || profile.model || '',
        text: '',
        toolCalls: [],
        streaming: true
    });

    try {
        const { reader, controller } = await calendarStreamChatRequest(cleanNote, profile, roleHint);
        calendarActiveStreamController = controller;
        calendarRender();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        const collectedToolCalls = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const parts = sseBuffer.split('\n\n');
            sseBuffer = parts.pop() || '';

            for (const part of parts) {
                const events = calendarParseSSEBuffer(part + '\n\n');
                for (const evt of events) {
                    if (evt.event === 'delta') {
                        if (evt.data.type === 'text') {
                            streamEntry.text += evt.data.content || '';
                            calendarUpdateStreamingBubble(streamEntry);
                        } else if (evt.data.type === 'tool_call') {
                            collectedToolCalls.push(evt.data);
                            streamEntry.toolCalls = collectedToolCalls.slice();
                            calendarUpdateStreamingBubble(streamEntry);
                        }
                    } else if (evt.event === 'start') {
                        streamEntry.agentModel = evt.data.model || streamEntry.agentModel;
                    } else if (evt.event === 'error') {
                        streamEntry.text += `\n\nError: ${evt.data.message || 'unknown'}`;
                        calendarUpdateStreamingBubble(streamEntry);
                    }
                }
            }
        }

        streamEntry.streaming = false;

        const calendarToolCalls = collectedToolCalls.filter(tc =>
            tc.valid && tc.name !== 'respond_text' && tc.name !== 'propose_memory'
        );

        if (calendarToolCalls.length) {
            const draft = calendarApplyToolCallsToPlan(calendarToolCalls, calendarPlan);
            if (calendarDraftHasMeaningfulChanges(draft)) {
                conversation.proposedPlan = draft;
                calendarPreviewDraft = true;
                calendarCurrentPage = 'calendar';
                calendarChatOpen = true;
                calendarConversationAddEntry({
                    role: 'system',
                    text: '已生成草案预览。满意后点”应用并存档”，不满意可继续对话调整或点”丢弃”。'
                });
            }
        }

        calendarApiStatus = `${displayLabel} 完成`;
    } catch (error) {
        streamEntry.streaming = false;
        const isAbort = error?.name === 'AbortError';
        if (isAbort && !streamEntry.text) {
            streamEntry.text = '（已停止）';
        }
        if (!isAbort) {
            calendarConversationAddEntry({
                role: 'system',
                status: 'error',
                text: `对话失败：${calendarCompactErrorText(error, 400)}`
            });
        }
        calendarApiStatus = isAbort ? '已停止' : '对话失败';
    } finally {
        calendarActiveStreamController = null;
        calendarStopAgentThinking();
    }
}

function calendarUpdateStreamingBubble(entry) {
    const el = document.getElementById('ta-streaming-bubble');
    if (!el) return;
    const textEl = el.querySelector('.ta-chat__bubble-text');
    if (textEl) textEl.innerHTML = calendarEsc(entry.text || '').replace(/\n/g, '<br>');
    const cardsEl = el.querySelector('.ta-chat__tool-cards');
    if (cardsEl && entry.toolCalls?.length) {
        cardsEl.innerHTML = entry.toolCalls.map(calendarToolCallCardHtml).join('');
    }
    const container = document.getElementById('ta-chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

function calendarPageContentHtml() {
    const isNewPage = calendarLastRenderedPage !== calendarCurrentPage;
    calendarLastRenderedPage = calendarCurrentPage;
    const cls = isNewPage ? 'ta-page ta-page--enter' : 'ta-page';
    switch (calendarCurrentPage) {
        case 'settings': return `<div class="${cls}"><h1 class="ta-page__title">API 设置</h1><div id="ta-settings-root">${calendarMemoryInnerHtml()}</div></div>`;
        case 'workflow': return `<div class="${cls}"><h1 class="ta-page__title">工作流设置</h1>${calendarWorkflowPageHtml()}</div>`;
        case 'archive': return `<div class="${cls}"><h1 class="ta-page__title">存档日志</h1>${calendarArchivePageHtml()}</div>`;
        case 'profile': return `<div class="${cls}"><h1 class="ta-page__title">用户记忆</h1>${calendarProfileHtml()}</div>`;
        default: return `<div class="${cls}"><h1 class="ta-page__title">Overview</h1>${calendarGoalsHtml()}</div>`;
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
            ${calendarGetAgents().map(role => `
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
    const viewPlan = calendarDisplayPlan() || calendarPlan;
    const showActual = calendarCalendarMode === 'actual' || calendarCalendarMode === 'compare';
    const showPlan = calendarCalendarMode === 'plan' || calendarCalendarMode === 'compare';
    const blocks = showPlan ? calendarBlocksForDay(viewPlan, dayIndex) : [];
    const today = dayIndex === calendarCurrentDayIndex(viewPlan);
    const nowTop = today ? (calendarNowMinutes() / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT : null;
    return `
        <div class="ta-calendar__day-col${today ? ' ta-calendar__day-col--today' : ''}" id="calendar-day-${dayIndex}">
            <div class="ta-actual-layer" id="calendar-actual-layer-${dayIndex}"></div>
            ${today && nowTop !== null ? `<div class="ta-calendar__now-line" style="top:${nowTop}px"></div>` : ''}
            ${blocks.map(calendarBlockHtml).join('')}
            ${calendarSelectedBlockEditorHtml(dayIndex, blocks)}
        </div>
    `;
}

function calendarBlockHtml(block) {
    const info = calendarCategoryInfo(block.category);
    const top = (block.start / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
    const duration = block.end - block.start;
    const height = Math.max(22, (duration / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT - 2);
    const selected = !calendarPreviewDraft
        && block.id === calendarSelectedBlockId
        && (!calendarSelectedOccurrenceDate || calendarSelectedOccurrenceDate === (block.occurrenceDate || ''));
    const statusIcon = block.status === 'done' ? '✓' : block.status === 'missed' ? '✗' : '';
    const compactClass = duration <= 30 ? ' compact' : '';
    const timeText = duration <= 30
        ? `${calendarMinutesToTime(block.start)}-${calendarMinutesToTime(block.end)}`
        : calendarMinutesToTime(block.start);
    return `
        <button class="ta-block${selected ? ' selected' : ''}${compactClass}"
            ${calendarPreviewDraft ? 'aria-disabled="true"' : `onclick="calendarSelectBlock('${calendarEsc(block.id)}','${calendarEsc(block.occurrenceDate || '')}')"`}
            title="${calendarEsc(calendarBlockTitle(block))}"
            style="top:${top}px;height:${height}px;--cat-color:${info.color}">
            ${statusIcon ? `<span class="ta-block__status">${statusIcon}</span>` : ''}
            <span class="ta-block__title">${calendarEsc(calendarReadableBlockTitle(block))}</span>
            <span class="ta-block__time">${calendarEsc(timeText)}</span>
            ${calendarBlockTooltipHtml(block)}
        </button>
    `;
}

function calendarBlockTitle(block) {
    const info = calendarCategoryInfo(block.category);
    const kind = calendarTaskKindInfo(block.kind);
    const repeatLabel = calendarRepeatLabel(block.repeat);
    const goal = calendarDisplayPlan()?.goals?.find(item => item.id === block.goalId);
    const parts = [
        `${calendarReadableBlockTitle(block)} · ${block.occurrenceDate || block.date || ''} ${calendarMinutesToTime(block.start)}-${calendarMinutesToTime(block.end)}`.trim(),
        `类型：${info.label}`,
        `任务：${kind.label}`,
        `重复：${repeatLabel}`,
        goal ? `目标：${goal.title}` : '',
        block.note ? `备注：${block.note}` : ''
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
    const kind = calendarTaskKindInfo(block.kind);
    const repeatLabel = calendarRepeatLabel(block.repeat);
    const goal = calendarDisplayPlan()?.goals?.find(item => item.id === block.goalId);
    const details = [
        `<span>${calendarEsc(kind.label)} · ${calendarEsc(repeatLabel)}</span>`,
        block.note ? `<span>${calendarEsc(block.note)}</span>` : ''
    ].filter(Boolean).join('');
    return `
        <span class="ta-block__tooltip">
            <strong>${calendarEsc(calendarReadableBlockTitle(block))}</strong>
            <em>${calendarEsc(block.occurrenceDate || block.date || calendarDateForDay(calendarDisplayPlan()?.weekStart || calendarPlan.weekStart, block.day))} · ${calendarEsc(calendarMinutesToTime(block.start))}-${calendarEsc(calendarMinutesToTime(block.end))} · ${calendarEsc(info.label)}</em>
            ${goal ? `<span>目标：${calendarEsc(goal.title)}</span>` : ''}
            ${details}
        </span>
    `;
}

function calendarCategoryOptionsHtml(selected = 'deep') {
    const current = CALENDAR_CATEGORIES[selected] ? selected : 'deep';
    return Object.entries(CALENDAR_CATEGORIES)
        .map(([key, cat]) => `<option value="${key}"${key === current ? ' selected' : ''}>${calendarEsc(cat.label)}</option>`)
        .join('');
}

function calendarDayOptionsHtml(selected = 0) {
    const current = Math.max(0, Math.min(6, Number(selected) || 0));
    return CALENDAR_DAYS
        .map((day, index) => `<option value="${index}"${index === current ? ' selected' : ''}>${calendarEsc(day.label)}</option>`)
        .join('');
}

function calendarBlockFormHtml(prefix, block = {}, actionsHtml = '') {
    const plan = calendarDisplayPlan() || calendarPlan || calendarDefaultPlan();
    const duration = Math.max(CALENDAR_MIN_BLOCK_MINUTES, (Number(block.end) || Number(block.start || 0) + 60) - Number(block.start || 0));
    const blockDate = calendarCleanDate(block.occurrenceDate || block.date) || calendarDateForDay(plan.weekStart, block.day || 0);
    return `
        <div class="ta-block-form">
            <input id="${prefix}-title" class="ta-block-form__title" value="${calendarEsc(block.title || '')}" placeholder="标题">
            <div class="ta-block-form__grid">
                <label>日期<input id="${prefix}-date" type="date" value="${calendarEsc(blockDate)}"></label>
                <input id="${prefix}-day" type="hidden" value="${Math.max(0, Math.min(6, Number(block.day) || 0))}">
                <label>开始<input id="${prefix}-start" type="time" step="300" value="${calendarEsc(calendarMinutesToTime(block.start || 9 * 60))}"></label>
                <label>分钟<input id="${prefix}-duration" type="number" min="5" max="720" step="5" value="${duration}"></label>
                <label>分类<select id="${prefix}-category">${calendarCategoryOptionsHtml(block.category)}</select></label>
                <label>任务类型<select id="${prefix}-kind">${calendarTaskKindOptionsHtml(block.kind || 'fixed')}</select></label>
                <label>重复<select id="${prefix}-repeat">${calendarRepeatOptionsHtml(block.repeat || 'none')}</select></label>
            </div>
            <textarea id="${prefix}-note" class="ta-block-form__note" rows="2" placeholder="描述 / Hover 备注">${calendarEsc(block.note || '')}</textarea>
            <div class="ta-block-form__actions">${actionsHtml}</div>
        </div>
    `;
}

function calendarReadBlockForm(prefix, fallback = {}) {
    const plan = calendarDisplayPlan() || calendarPlan || calendarDefaultPlan();
    const selectedDay = Math.max(0, Math.min(6, Number(document.getElementById(`${prefix}-day`)?.value || fallback.day || 0)));
    const date = calendarCleanDate(document.getElementById(`${prefix}-date`)?.value || fallback.occurrenceDate || fallback.date)
        || calendarDateForDay(plan.weekStart, selectedDay);
    const day = date ? calendarWeekdayForDate(date, selectedDay) : selectedDay;
    const start = calendarTimeToMinutes(document.getElementById(`${prefix}-start`)?.value, fallback.start || 9 * 60);
    const duration = calendarCleanDurationMinutes(document.getElementById(`${prefix}-duration`)?.value, Math.max(CALENDAR_MIN_BLOCK_MINUTES, (fallback.end || start + 60) - (fallback.start || start)), 720);
    const category = document.getElementById(`${prefix}-category`)?.value || fallback.category || 'deep';
    const kind = calendarNormalizeTaskKind(document.getElementById(`${prefix}-kind`)?.value || fallback.kind, 'fixed');
    const repeat = calendarCleanRepeat(document.getElementById(`${prefix}-repeat`)?.value || fallback.repeat || 'none');
    return calendarCleanBlock({
        ...fallback,
        title: document.getElementById(`${prefix}-title`)?.value.trim() || fallback.title || '未命名',
        date,
        day,
        start,
        end: Math.min(CALENDAR_DAY_MINUTES, start + duration),
        category,
        kind: repeat.frequency === 'none' ? kind : (kind === 'general' ? 'routine' : kind),
        repeat,
        source: fallback.source || 'manual',
        note: document.getElementById(`${prefix}-note`)?.value.trim() || ''
    });
}

function calendarSelectedBlockEditorHtml(dayIndex, blocks = []) {
    if (calendarPreviewDraft || !calendarEditingBlockId) return '';
    const occurrence = blocks.find(block =>
        block.id === calendarEditingBlockId
        && (!calendarEditingOccurrenceDate || block.occurrenceDate === calendarEditingOccurrenceDate)
    );
    if (!occurrence) return '';
    const top = Math.max(0, Math.min(((occurrence.start / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT) - 6, ((CALENDAR_DAY_MINUTES / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT) - 310));
    return `
        <div class="ta-block-editor" style="top:${top}px" onclick="event.stopPropagation()">
            ${calendarBlockFormHtml('ta-edit-block', occurrence, `
                <button type="button" class="ta-block-form__primary" onclick="calendarSaveBlockEditor()">保存</button>
                <button type="button" onclick="calendarSetSelectedStatus('done')">完成</button>
                <button type="button" onclick="calendarSetSelectedStatus('missed')">未完成</button>
                <button type="button" class="ta-block-form__danger" onclick="calendarDeleteSelectedBlock()">删除</button>
                <button type="button" onclick="calendarCloseBlockEditor()">关闭</button>
            `)}
        </div>
    `;
}

function calendarArchitectIntroHtml() {
    const coreCommands = ['/goal', '/estimate', '/build-day', '/build-week', '/reflect', '/catch-up', '/audit', '/why', '/health', '/report', '/commands', '/memory'];
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
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 80)}px`;
        calendarRenderChatTargetPreview();
    }
}

function calendarInsertAgentMention(index) {
    const agent = calendarConfiguredAgents()[index];
    if (!agent) return;
    calendarInsertCommand(calendarAgentMentionCommand(agent));
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
                <input id="calendar-manual-date" type="date" value="${calendarEsc(calendarDateForDay(calendarPlan.weekStart, calendarCurrentDayIndex(calendarPlan) >= 0 ? calendarCurrentDayIndex(calendarPlan) : new Date().getDay()))}">
                <select id="calendar-manual-day">${dayOptions}</select>
                <input id="calendar-manual-start" type="time" step="300" value="20:00">
                <input id="calendar-manual-duration" type="number" min="5" max="360" step="5" value="60" title="分钟">
                <select id="calendar-manual-category">${categoryOptions}</select>
                <select id="calendar-manual-kind">${calendarTaskKindOptionsHtml('fixed')}</select>
                <select id="calendar-manual-repeat">${calendarRepeatOptionsHtml('none')}</select>
                <input id="calendar-manual-note" placeholder="Hover / 备注（可选）">
                <button onclick="calendarAddManualBlock()">添加</button>
            </div>
        </div>
    `;
}

function calendarProfileToText(profile) {
    const p = profile || {};
    const energy = p.energyPattern || {};
    const lines = [];
    if (p.name) lines.push(`名字: ${p.name}`);
    if (p.timezone) lines.push(`时区: ${p.timezone}`);
    if (p.currentLifeStage) lines.push(`当前阶段: ${p.currentLifeStage}`);
    if (Array.isArray(p.roles) && p.roles.length) lines.push(`角色: ${p.roles.join(', ')}`);
    if (p.weeklyCapacityHours) lines.push(`每周可用小时: ${p.weeklyCapacityHours}`);
    if (p.planningStyle) lines.push(`计划风格: ${p.planningStyle}`);
    if (p.sleepWindow) lines.push(`睡眠窗口: ${p.sleepWindow}`);
    if (p.mealRoutines) lines.push(`饮食习惯: ${p.mealRoutines}`);
    if (p.fixedCommitments) lines.push(`固定安排: ${p.fixedCommitments}`);
    if (p.commuteConstraints) lines.push(`通勤约束: ${p.commuteConstraints}`);
    if (energy.highFocusTime) lines.push(`高专注时段: ${energy.highFocusTime}`);
    if (energy.lowEnergyTime) lines.push(`低能量时段: ${energy.lowEnergyTime}`);
    if (energy.bestCreativeTime) lines.push(`最佳创意时段: ${energy.bestCreativeTime}`);
    if (energy.bestAdminTime) lines.push(`最佳行政时段: ${energy.bestAdminTime}`);
    if (p.healthRecoveryConstraints) lines.push(`健康约束: ${p.healthRecoveryConstraints}`);
    if (p.motivationPattern) lines.push(`动力模式: ${p.motivationPattern}`);
    if (Array.isArray(p.commonFailureModes) && p.commonFailureModes.length) lines.push(`常见失败模式: ${p.commonFailureModes.join(', ')}`);
    return lines.join('\n');
}

function calendarProfileFromText(text) {
    const profile = {};
    const energy = {};
    const fieldMap = {
        '名字': 'name', 'name': 'name',
        '时区': 'timezone', 'timezone': 'timezone',
        '当前阶段': 'currentLifeStage', 'life stage': 'currentLifeStage',
        '角色': 'roles', 'roles': 'roles',
        '每周可用小时': 'weeklyCapacityHours', 'weekly hours': 'weeklyCapacityHours',
        '计划风格': 'planningStyle', 'planning style': 'planningStyle',
        '睡眠窗口': 'sleepWindow', 'sleep': 'sleepWindow',
        '饮食习惯': 'mealRoutines', 'meals': 'mealRoutines',
        '固定安排': 'fixedCommitments', 'fixed commitments': 'fixedCommitments',
        '通勤约束': 'commuteConstraints', 'commute': 'commuteConstraints',
        '高专注时段': '_highFocus', 'high focus': '_highFocus',
        '低能量时段': '_lowEnergy', 'low energy': '_lowEnergy',
        '最佳创意时段': '_bestCreative', 'creative time': '_bestCreative',
        '最佳行政时段': '_bestAdmin', 'admin time': '_bestAdmin',
        '健康约束': 'healthRecoveryConstraints', 'health': 'healthRecoveryConstraints',
        '动力模式': 'motivationPattern', 'motivation': 'motivationPattern',
        '常见失败模式': 'commonFailureModes', 'failure modes': 'commonFailureModes',
    };
    for (const line of text.split('\n')) {
        const match = line.match(/^([^:：]+)[：:]\s*(.+)/);
        if (!match) continue;
        const key = match[1].trim().toLowerCase();
        const val = match[2].trim();
        const mapped = fieldMap[key];
        if (!mapped) continue;
        if (mapped === 'roles' || mapped === 'commonFailureModes') {
            profile[mapped] = val.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
        } else if (mapped === 'weeklyCapacityHours') {
            profile[mapped] = Number(val) || 40;
        } else if (mapped.startsWith('_')) {
            const energyKey = { '_highFocus': 'highFocusTime', '_lowEnergy': 'lowEnergyTime', '_bestCreative': 'bestCreativeTime', '_bestAdmin': 'bestAdminTime' }[mapped];
            energy[energyKey] = val;
        } else {
            profile[mapped] = val;
        }
    }
    if (Object.keys(energy).length) profile.energyPattern = energy;
    return profile;
}

function calendarProfileHtml() {
    const profile = calendarPlan.profile || calendarDefaultProfile();
    const profileText = calendarProfileToText(profile);
    const memories = calendarPlan.memories || [];
    return `
        <div class="ta-page__card">
            <h3>Profile</h3>
            <p class="ta-page__hint">自由编辑你的个人信息，每行一个字段（如 "名字: Henry"）。也可以直接用自然语言描述自己，保存时会自动解析。</p>
            <textarea id="calendar-profile-text" class="ta-profile-text" rows="14">${calendarEsc(profileText)}</textarea>
            <button class="ta-btn-primary" onclick="calendarSaveProfileFromText()">保存 Profile</button>
        </div>
        <div class="ta-page__card">
            <div class="ta-memory-header">
                <h3>长期记忆</h3>
                <button class="ta-btn-sm" onclick="calendarAddMemory()">+ 添加</button>
            </div>
            <p class="ta-page__hint">AI 对话中会自动积累记忆，你也可以手动管理。</p>
            <div class="ta-memory-list">
                ${memories.length ? memories.map(mem => calendarMemoryItemHtml(mem)).join('') : '<div class="ta-empty">暂无记忆条目。</div>'}
            </div>
        </div>
    `;
}

function calendarMemoryItemHtml(mem) {
    const sourceColors = { claude: 'blue', gemini: 'purple', user: 'gray' };
    const sourceLabels = { claude: 'Claude', gemini: 'Gemini', user: '用户' };
    const color = sourceColors[mem.source] || 'gray';
    const label = sourceLabels[mem.source] || mem.source;
    const time = new Date(mem.createdAt).toLocaleDateString('zh-CN');
    const isEditing = calendarEditingMemoryId === mem.id;
    return `
        <div class="ta-memory-item">
            <div class="ta-memory-item__top">
                <span class="ta-memory-source ta-memory-source--${color}">${calendarEsc(label)}</span>
                ${mem.reviewedBy ? `<span class="ta-memory-review ta-memory-review--${mem.reviewStatus === 'approved' ? 'ok' : 'pending'}">${calendarEsc(sourceLabels[mem.reviewedBy] || mem.reviewedBy)} ${mem.reviewStatus === 'approved' ? '已审核' : '待审核'}</span>` : ''}
                <span class="ta-memory-time">${time}</span>
            </div>
            ${isEditing ? `
                <textarea id="ta-memory-edit-${mem.id}" class="ta-memory-edit">${calendarEsc(mem.content)}</textarea>
                <div class="ta-btn-row">
                    <button onclick="calendarSaveMemoryEdit('${calendarEsc(mem.id)}')">保存</button>
                    <button onclick="calendarCancelMemoryEdit()">取消</button>
                </div>
            ` : `
                <p class="ta-memory-content">${calendarEsc(mem.content)}</p>
                <div class="ta-memory-actions">
                    <button onclick="calendarEditMemory('${calendarEsc(mem.id)}')">编辑</button>
                    <button onclick="calendarDeleteMemory('${calendarEsc(mem.id)}')">删除</button>
                </div>
            `}
        </div>
    `;
}

function calendarAddMemory() {
    if (!calendarPlan) return;
    if (!calendarPlan.memories) calendarPlan.memories = [];
    const mem = {
        id: calendarId('mem'),
        content: '',
        source: 'user',
        reviewedBy: null,
        reviewStatus: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    calendarPlan.memories.unshift(mem);
    calendarEditingMemoryId = mem.id;
    calendarSavePlan();
}

function calendarEditMemory(id) {
    calendarEditingMemoryId = id;
    calendarRender();
}

function calendarCancelMemoryEdit() {
    const mem = (calendarPlan.memories || []).find(m => m.id === calendarEditingMemoryId);
    if (mem && !mem.content) {
        calendarPlan.memories = calendarPlan.memories.filter(m => m.id !== mem.id);
    }
    calendarEditingMemoryId = null;
    calendarRender();
}

function calendarSaveMemoryEdit(id) {
    const textarea = document.getElementById(`ta-memory-edit-${id}`);
    const content = (textarea?.value || '').trim();
    if (!content) {
        calendarDeleteMemory(id);
        return;
    }
    const mem = (calendarPlan.memories || []).find(m => m.id === id);
    if (mem) {
        mem.content = content;
        mem.updatedAt = new Date().toISOString();
    }
    calendarEditingMemoryId = null;
    calendarSavePlan();
}

function calendarDeleteMemory(id) {
    if (!calendarPlan) return;
    calendarPlan.memories = (calendarPlan.memories || []).filter(m => m.id !== id);
    calendarEditingMemoryId = null;
    calendarSavePlan();
}

function calendarSaveProfileFromForm() {
    calendarSaveProfileFromText();
}

function calendarSaveProfileFromText() {
    if (!calendarPlan) return;
    const text = document.getElementById('calendar-profile-text')?.value || '';
    const current = calendarPlan.profile || calendarDefaultProfile();
    const parsed = calendarProfileFromText(text);
    calendarPlan.profile = calendarCleanProfile({ ...current, ...parsed, energyPattern: { ...(current.energyPattern || {}), ...(parsed.energyPattern || {}) } });
    calendarPlan.reflections.push(calendarCleanReflection({
        text: 'profile update',
        messages: ['已更新 profile。'],
        at: new Date().toISOString()
    }));
    calendarSavePlan();
    calendarApiStatus = 'Profile 已保存';
    calendarRender();
}

function calendarDefaultWorkflowPrompts() {
    return {
        version: CALENDAR_WORKFLOW_PROMPT_VERSION,
        globalPrompt: CALENDAR_DEFAULT_GLOBAL_PROMPT,
        agents: {}
    };
}

function calendarNormalizeWorkflowPrompts(raw) {
    const defaults = calendarDefaultWorkflowPrompts();
    if (!raw || typeof raw !== 'object') return defaults;
    if (raw.orchestrator || raw.common || raw.deployment) return defaults;
    const oldVersion = Number(raw.version || 0);
    const globalPrompt = oldVersion < 4 && !String(raw.globalPrompt || '').trim()
        ? CALENDAR_DEFAULT_GLOBAL_PROMPT
        : String(raw.globalPrompt || '');
    const agents = raw.agents && typeof raw.agents === 'object' ? raw.agents : {};
    return {
        version: CALENDAR_WORKFLOW_PROMPT_VERSION,
        globalPrompt,
        agents: Object.fromEntries(Object.entries(agents).map(([key, value]) => [key, String(value || '')]))
    };
}

function calendarWorkflowInnerHtml() {
    calendarPlan.workflowPrompts = calendarNormalizeWorkflowPrompts(calendarPlan.workflowPrompts);
    const prompts = calendarPlan.workflowPrompts;
    const agents = calendarGetAgents();
    const apiStore = calendarLoadApiStore();
    const modelOptions = apiStore.profiles.map(p =>
        `<option value="${calendarEsc(p.id)}">${calendarEsc(p.name)} (${calendarEsc(p.model)})</option>`
    ).join('');
    return `
        <div class="ta-workflow-top">
            <button class="ta-btn-primary" onclick="calendarAddAgent()">+ 添加 Agent</button>
        </div>
        <div class="ta-page__card">
            <h3>全局 Prompt</h3>
            <p class="ta-page__hint">所有对话都会附带这段 prompt，不可删除。留空则使用内置默认。</p>
            <textarea id="ta-workflow-global" class="ta-workflow-textarea" rows="8" placeholder="在此输入全局系统提示词...">${calendarEsc(prompts.globalPrompt || '')}</textarea>
            <button class="ta-btn-primary" style="margin-top:8px" onclick="calendarSaveWorkflowAll()">保存</button>
        </div>
        <div class="ta-workflow-agents">
            ${agents.map((role, idx) => {
                const prompt = (prompts.agents && prompts.agents[role.key]) || '';
                const matchApi = apiStore.profiles.find(p => p.model === role.modelId || p.name === role.configName || p.id === role.apiProfileId);
                const apiId = matchApi ? matchApi.id : '';
                return `
                <div class="ta-page__card ta-workflow-card" data-agent-idx="${idx}">
                    <div class="ta-workflow-card__head">
                        <input class="ta-workflow-card__label" value="${calendarEsc(role.label)}" data-field="label" placeholder="Agent 名称">
                        <select class="ta-workflow-card__model-select" data-field="apiProfileId" onchange="calendarLinkAgentApi(${idx},this.value)">
                            <option value="">选择模型</option>${modelOptions.replace(`value="${calendarEsc(apiId)}"`, `value="${calendarEsc(apiId)}" selected`)}
                        </select>
                        <button class="ta-btn-sm ta-btn-danger" onclick="calendarDeleteAgent(${idx})" title="删除">✕</button>
                    </div>
                    <textarea id="ta-workflow-agent-${role.key}" class="ta-workflow-textarea" rows="8" placeholder="这个 Agent 的专属 prompt...">${calendarEsc(prompt)}</textarea>
                    <button class="ta-btn-sm" style="margin-top:6px" onclick="calendarSaveWorkflowAll()">保存</button>
                </div>
                `;
            }).join('')}
        </div>
    `;
}
function calendarWorkflowPageHtml() {
    return `<div id="ta-workflow-root">${calendarWorkflowInnerHtml()}</div>`;
}
function calendarRenderWorkflowOnly() {
    const el = document.getElementById('ta-workflow-root');
    if (el) { el.innerHTML = calendarWorkflowInnerHtml(); return; }
    calendarRender();
}

function calendarSaveWorkflowAll() {
    if (!calendarPlan) return;
    const globalPrompt = document.getElementById('ta-workflow-global')?.value || '';
    const agentPrompts = {};
    const cards = document.querySelectorAll('.ta-workflow-card[data-agent-idx]');
    const updatedAgents = [];
    cards.forEach(card => {
        const idx = Number(card.dataset.agentIdx);
        const base = calendarPlan.agents[idx];
        if (!base) return;
        const agent = { ...base };
        card.querySelectorAll('[data-field]').forEach(input => {
            const field = input.dataset.field;
            if (field === 'label') agent.label = input.value.trim();
            if (field === 'apiProfileId' && input.value) {
                agent.apiProfileId = input.value;
                const store = calendarLoadApiStore();
                const profile = store.profiles.find(p => p.id === input.value);
                if (profile) {
                    agent.configName = profile.name;
                    agent.modelId = profile.model;
                    agent.model = profile.name;
                }
            }
        });
        updatedAgents.push(calendarCleanAgent(agent));
        const ta = card.querySelector('.ta-workflow-textarea');
        if (ta) agentPrompts[agent.key] = ta.value || '';
    });
    calendarPlan.agents = updatedAgents;
    calendarPlan.workflowPrompts = {
        version: CALENDAR_WORKFLOW_PROMPT_VERSION,
        globalPrompt,
        agents: agentPrompts
    };
    calendarSavePlan(false);
    calendarApiStatus = '工作流已保存';
    calendarRenderWorkflowOnly();
}

function calendarAddAgent() {
    if (!calendarPlan) return;
    if (!calendarPlan.agents) calendarPlan.agents = [];
    calendarPlan.agents.push(calendarCleanAgent({
        key: calendarId('agent'),
        label: '新 Agent',
        model: '',
        configName: '',
        modelId: '',
        job: ''
    }));
    calendarSavePlan(false);
    calendarRenderWorkflowOnly();
}

function calendarDeleteAgent(idx) {
    if (!calendarPlan?.agents) return;
    if (!confirm(`删除 Agent「${calendarPlan.agents[idx]?.label || ''}」？`)) return;
    calendarPlan.agents.splice(idx, 1);
    calendarSavePlan(false);
    calendarRenderWorkflowOnly();
}

function calendarLinkAgentApi(idx, apiId) {
    if (!calendarPlan?.agents?.[idx]) return;
    const agent = calendarPlan.agents[idx];
    agent.apiProfileId = apiId || '';
    if (apiId) {
        const store = calendarLoadApiStore();
        const profile = store.profiles.find(p => p.id === apiId);
        if (profile) {
            agent.configName = profile.name;
            agent.modelId = profile.model;
            agent.model = profile.name;
        }
    }
}

function calendarSaveWorkflowPrompts() {
    calendarSaveWorkflowAll();
}

function calendarResetWorkflowPrompt(agentKey) {
    const defaults = calendarDefaultWorkflowPrompts();
    const el = document.getElementById(`ta-workflow-agent-${agentKey}`);
    if (el && defaults.agents[agentKey]) {
        el.value = defaults.agents[agentKey];
    }
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

function calendarApiProfileHasServerMatch(profile) {
    return Boolean(profile?.server || calendarServerApiProfiles.some(serverProfile => calendarApiProfilesMatch(profile, serverProfile)));
}

function calendarApiProfileStatusLabel(profile) {
    if (profile?.apiKey) return 'key';
    if (calendarApiProfileHasServerMatch(profile)) return 'server key';
    return 'no key';
}

function calendarMemoryInnerHtml() {
    const apiStore = calendarLoadApiStore();
    const cards = apiStore.profiles.map((item, idx) => {
        const isActive = item.id === apiStore.activeId;
        const status = calendarApiProfileStatusLabel(item);
        const statusClass = status === 'no key' ? 'ta-api-card__badge--none' : (item.apiKey ? 'ta-api-card__badge--local' : 'ta-api-card__badge--server');
        const statusText = status === 'no key' ? '无 key' : (item.apiKey ? '本地 key' : 'Server key');
        if (!isActive) {
            return `<button class="ta-api-card" onclick="calendarSwitchApiProfile(this.dataset.pid)" data-pid="${item.id}">
                <div class="ta-api-card__header">
                    <div class="ta-api-card__title">${calendarEsc(item.name)}</div>
                    <span class="ta-api-card__badge ${statusClass}">${statusText}</span>
                </div>
                <div class="ta-api-card__meta">${calendarEsc(item.model || '(未设置)')} · ${calendarEsc(item.baseUrl.replace(/^https?:\/\//, ''))}</div>
            </button>`;
        }
        const keyPh = calendarApiProfileHasServerMatch(item) ? 'Server 已配置，留空即可' : (item.apiKey ? '已保存，留空保留' : 'sk-...');
        return `<div class="ta-api-card ta-api-card--active">
            <div class="ta-api-card__header">
                <div class="ta-api-card__title">${calendarEsc(item.name || '(未命名)')}</div>
                <span class="ta-api-card__badge ${statusClass}">${statusText}</span>
            </div>
            <div class="ta-api-card__form">
                <label>名称<input id="calendar-api-name" value="${calendarEsc(item.name)}" placeholder="例: GPT-5.5"></label>
                <label>Base URL<input id="calendar-api-base" value="${calendarEsc(item.baseUrl)}" placeholder="https://api.ikuncode.cc/v1"></label>
                <label>模型 ID<input id="calendar-api-model" value="${calendarEsc(item.model)}" placeholder="claude-opus-4-6"></label>
                <label>API Key<input id="calendar-api-key" type="password" placeholder="${calendarEsc(keyPh)}"></label>
                <div class="ta-api-card__actions">
                    <button onclick="calendarSaveApiConfigFromForm()">保存</button>
                    <button onclick="calendarClearLocalApiKey()">清 key</button>
                    <button onclick="calendarDeleteApiProfile()">删除</button>
                    <button onclick="calendarCheckArchitectApi()">检查连接</button>
                </div>
            </div>
        </div>`;
    }).join('');
    return `
        <div class="ta-page__card" id="calendar-memory-panel">
            <div id="calendar-api-status" class="ta-api-status">${calendarEsc(calendarApiStatus || '')}</div>
            <div class="ta-api-card-list">${cards}</div>
            <div class="ta-btn-row" style="margin-top:12px">
                <button onclick="calendarCreateApiProfile()">+ 添加配置</button>
            </div>
        </div>
    `;
}
function calendarRenderSettingsOnly() {
    const el = document.getElementById('ta-settings-root');
    if (el) { el.innerHTML = calendarMemoryInnerHtml(); return; }
    calendarRender();
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

function calendarWebsiteKnowledgeBase(plan = calendarPlan) {
    const cleanPlan = plan ? calendarCleanPlan(plan) : calendarDefaultPlan();
    const apiStore = calendarLoadApiStore();
    const activeProfile = apiStore.profiles.find(item => item.id === apiStore.activeId) || apiStore.profiles[0] || calendarDefaultApiConfig();
    const defaultDialogueProfile = calendarDefaultDialogueProfile(apiStore);
    return {
        product: {
            name: 'Time Architect',
            purpose: 'goal-first 24/7 time architecture system, not a todo list',
            publicUrl: 'https://time-architect-phi.vercel.app',
            policy: 'API-only user-visible answers; do not present local-rule output as an answer.'
        },
        pages: [
            { id: 'overview', label: 'Overview', purpose: 'Goal contracts, calendar, health/workload panels, current plan review.' },
            { id: 'settings', label: 'API 设置', purpose: 'BYOK/server API profiles, model base URL, model id, key storage, API checks.' },
            { id: 'workflow', label: '工作流视图', purpose: 'Agent role definitions and editable workflow prompts.' },
            { id: 'archive', label: '存档日志', purpose: 'Saved discussions, reports, and planning history.' },
            { id: 'profile', label: '用户信息', purpose: 'User profile, fixed commitments, health constraints, planning memory.' }
        ],
        controls: {
            topBar: ['Save', '+ Add', 'Delete selected block', 'Edit selected block', 'week navigation'],
            chat: ['ordinary dialogue default model selector', 'Fast mode toggle', '@all', '@主脑', '@挑战', '@审计', '@工程', 'draft preview', '应用并存档', '丢弃', '新对话'],
            calendarBlocks: 'Blocks can be date-specific one-time events or explicit repeat events. Hover shows title, date, time, category, task kind, repeat policy, goal, and user-authored note.',
            manualEditing: ['drag a time range to create an Outlook-style event', 'select a block to edit title/date/time/kind/repeat/note', 'toolbar delete/edit for selected block']
        },
        commandReference: calendarCommandGuide().split('\n'),
        defaultAgents: calendarGetAgents().map(agent => ({
            key: agent.key,
            label: agent.label,
            model: agent.model,
            modelId: agent.modelId,
            job: agent.job,
            skill: calendarAgentSkill(agent.key)
        })),
        routing: {
            defaultDialogueModel: `${defaultDialogueProfile.name} / ${defaultDialogueProfile.model}`,
            defaultDialogueAgent: '挑战',
            defaultDialogueSetting: 'User can set the ordinary dialogue default API profile; planner/auditor/engineer routing remains intent-based.',
            architecture: 'user message -> request router -> selected agent -> API call -> draft only when route allows calendar changes',
            outputModes: ['calendar-draft', 'dialogue-advice', 'review-advice', 'engineering-advice'],
            plannerCommands: ['/goal', '/estimate', '/build-day', '/build-week', '/24-7', '/adjust', '/reflect', '/catch-up', '/light-mode', '/sprint', '/reset'],
            councilTriggers: ['/council', '@all', '会诊', '全模型', '所有 agent'],
            commandAliases: { '/command': '/commands' }
        },
        calendarEditToolkit: calendarEditToolkitKnowledge(),
        dataModel: {
            planKeys: ['profile', 'goals', 'blocks', 'archives', 'reflections', 'agents', 'workflowPrompts', 'weekStart'],
            goalContract: ['title', 'desiredOutcome', 'deadline', 'successCriteria', 'currentBaseline', 'gap', 'estimatedWorkload', 'risks', 'weeklyTarget', 'dailyMinimum'],
            block: ['date', 'day', 'start', 'end', 'category', 'kind', 'repeat', 'title', 'goalId', 'source', 'note', 'exactAction', 'output', 'ifInterrupted', 'status']
        },
        currentState: {
            page: calendarCurrentPage,
            week: calendarWeekRangeLabel(cleanPlan.weekStart),
            activeGoals: (cleanPlan.goals || []).filter(goal => goal.status === 'active').slice(0, 6).map(goal => goal.title),
            blockCount: (cleanPlan.blocks || []).length,
            archiveCount: (cleanPlan.archives || []).length,
            recentArchives: calendarRecentArchiveContext(5),
            selectedBlockId: calendarSelectedBlockId || '',
            selectedOccurrenceDate: calendarSelectedOccurrenceDate || '',
            chatOpen: calendarChatOpen,
            fastMode: calendarFastMode,
            activeApiProfile: {
                name: activeProfile.name,
                model: activeProfile.model,
                server: Boolean(activeProfile.server),
                hasKey: Boolean(activeProfile.apiKey)
            },
            locale: navigator?.language || 'zh-CN'
        }
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
    const local = calendarLoadApiConfig();
    if (local.apiKey) {
        calendarApiStatus = `本地 key 可用：${local.name} · ${local.model}`;
        calendarRenderApiStatus();
        return;
    }
    calendarApiStatus = '正在检查 server 连接...';
    calendarRenderApiStatus();
    const data = await calendarRefreshServerApiProfiles(false);
    if (!data) return;
    if (!calendarServerApiProfiles.length && !data.configured) {
        calendarApiStatus = '未检测到 server key，需要填入本地 API key 才能使用。';
        calendarRenderApiStatus();
        return;
    }
    calendarApiStatus = `Server 连接正常：${calendarServerApiProfiles.map(item => item.model).join(', ')}`;
    calendarRenderSettingsOnly();
}

function calendarRenderApiStatus() {
    const el = document.getElementById('calendar-api-status');
    if (el) el.textContent = calendarApiStatus || '';
}

function calendarParseApiSecretInput(value) {
    const text = String(value || '').trim();
    if (!text.startsWith('{')) return { apiKey: text };
    try {
        const parsed = JSON.parse(text);
        const isNewApiConnection = parsed._type === 'newapi_channel_conn';
        return {
            name: String(parsed.name || parsed.label || '').trim(),
            apiKey: String(parsed.key || parsed.apiKey || '').trim(),
            baseUrl: parsed.url ? calendarNormalizeApiBaseUrl(parsed.url, { assumeV1: isNewApiConnection }) : '',
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
    calendarRenderSettingsOnly();
}

function calendarSwitchChatModel(id) {
    const store = calendarLoadApiStore();
    const next = store.profiles.find(item => item.id === id);
    if (!next) return;
    calendarSaveApiStore({ ...store, activeId: next.id });
    calendarApiStatus = `已切换模型：${next.name}`;
    calendarRender();
}

function calendarSwitchDefaultDialogueProfile(id) {
    const next = calendarSaveDefaultDialogueProfileId(id);
    calendarApiStatus = `普通对话默认模型已设为：${next.name}。Fast mode 的闲聊、说明、帮助会优先调用它。`;
    calendarRender();
}

function calendarCreateApiProfile() {
    const store = calendarLoadApiStore();
    if (store.profiles.length >= 8) {
        calendarApiStatus = '最多 8 个配置，请删除不用的再添加。';
        calendarRenderApiStatus();
        return;
    }
    const next = calendarDefaultApiConfig({
        name: `新配置 ${store.profiles.length + 1}`,
        model: '',
        baseUrl: 'https://api.ikuncode.cc/v1'
    });
    calendarSaveApiStore({
        ...store,
        activeId: next.id,
        profiles: [...store.profiles, next]
    });
    calendarApiStatus = '已添加，填写信息后点保存。';
    calendarRenderSettingsOnly();
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
    calendarRenderSettingsOnly();
}

function calendarSaveApiConfigFromForm() {
    const existing = calendarLoadApiConfig();
    const secret = calendarParseApiSecretInput(document.getElementById('calendar-api-key')?.value);
    const config = calendarSaveApiConfig({
        name: secret.name || document.getElementById('calendar-api-name')?.value || existing.name,
        mode: 'chat',
        baseUrl: secret.baseUrl || document.getElementById('calendar-api-base')?.value || existing.baseUrl,
        model: secret.model || document.getElementById('calendar-api-model')?.value || existing.model,
        apiKey: secret.apiKey || existing.apiKey
    });
    calendarApiStatus = config.apiKey
        ? `已保存：${config.name} · ${config.model} (本地 key)`
        : `已保存：${config.name} · ${config.model}`;
    calendarRenderSettingsOnly();
}

function calendarClearLocalApiKey() {
    const config = calendarLoadApiConfig();
    config.apiKey = '';
    calendarSaveApiConfig(config);
    calendarApiStatus = `已清除 ${config.name} 的本地 key`;
    calendarRenderSettingsOnly();
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

const CALENDAR_ARCHIVE_TYPES = {
    'all': '全部',
    'daily-report': '日报',
    'weekly-report': '周报',
    'monthly-report': '月报',
    'arrangement': '安排',
    'adjustment': '调整',
    'discussion': '内部讨论'
};

function calendarArchivePageHtml() {
    const archives = calendarPlan.archives || [];
    const filtered = calendarArchiveFilter === 'all' ? archives : archives.filter(a => a.type === calendarArchiveFilter);
    const sorted = [...filtered].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return `
        <div class="ta-archive-tabs">
            ${Object.entries(CALENDAR_ARCHIVE_TYPES).map(([key, label]) => `
                <button class="ta-archive-tab${calendarArchiveFilter === key ? ' ta-archive-tab--active' : ''}" onclick="calendarFilterArchives('${key}')">${label}</button>
            `).join('')}
        </div>
        <div class="ta-archive-list">
            ${sorted.length ? sorted.map(arc => calendarArchiveItemHtml(arc)).join('') : `<div class="ta-empty">暂无${calendarArchiveFilter === 'all' ? '' : CALENDAR_ARCHIVE_TYPES[calendarArchiveFilter]}记录。AI 对话中生成的报告和讨论会自动归档到这里。</div>`}
        </div>
    `;
}

function calendarArchiveItemHtml(arc) {
    const typeLabel = CALENDAR_ARCHIVE_TYPES[arc.type] || arc.type;
    const typeColors = { 'daily-report': 'green', 'weekly-report': 'blue', 'monthly-report': 'purple', 'arrangement': 'yellow', 'adjustment': 'red', 'discussion': 'gray' };
    const color = typeColors[arc.type] || 'gray';
    const time = new Date(arc.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const isExpanded = calendarExpandedArchiveId === arc.id;
    const models = (arc.models || []).join(', ');
    return `
        <div class="ta-archive-item${isExpanded ? ' ta-archive-item--expanded' : ''}" onclick="calendarExpandArchive('${calendarEsc(arc.id)}')">
            <div class="ta-archive-item__head">
                <span class="ta-archive-type ta-archive-type--${color}">${calendarEsc(typeLabel)}</span>
                <span class="ta-archive-item__title">${calendarEsc(arc.title)}</span>
                <span class="ta-archive-item__meta">${models ? calendarEsc(models) + ' · ' : ''}${time}</span>
            </div>
            ${isExpanded ? `<div class="ta-archive-item__body"><pre>${calendarEsc(arc.content)}</pre></div>` : ''}
        </div>
    `;
}

function calendarFilterArchives(type) {
    calendarArchiveFilter = type;
    calendarRender();
}

function calendarExpandArchive(id) {
    calendarExpandedArchiveId = calendarExpandedArchiveId === id ? null : id;
    calendarRender();
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

    calendarApiStatus = calendarCanUseArchitectApi()
        ? '正在调用 /api/time-architect...'
        : 'API-only 模式需要在线 API。';
    calendarRenderApiStatus();

    let result = calendarCanUseArchitectApi() ? await calendarCallArchitectApi(note) : null;
    if (!result) {
        calendarPlan.reflections.push(calendarCleanReflection({
            text: note,
            messages: ['API 暂不可用：API-only 模式不会生成本地回答或本地草案。请检查 API 设置后重试。'],
            at: new Date().toISOString()
        }));
        calendarSavePlan();
        return;
    }

    const memoryMessages = (result.memoryCandidates || []).map(item => {
        return `Memory/Profile candidate: ${item.fact || ''} Why it matters: ${item.why || ''} Suggested field: ${item.field || ''}`;
    });
    calendarPlan = calendarMergePlanUpdate(result.plan || calendarPlan);
    calendarPlan.reflections.push(calendarCleanReflection({
        text: note,
        messages: [...(result.messages || []), ...memoryMessages],
        at: new Date().toISOString()
    }));
    calendarDraftText = '';
    calendarClearBlockSelection();
    calendarSavePlan();
}

async function calendarFetchArchitectApi(options = {}) {
    if (typeof AbortController === 'undefined') {
        return fetch(CALENDAR_ARCHITECT_API, options);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new Error(`client timeout after ${Math.round(CALENDAR_ARCHITECT_CLIENT_TIMEOUT_MS / 1000)}s`));
    }, CALENDAR_ARCHITECT_CLIENT_TIMEOUT_MS);
    try {
        return await fetch(CALENDAR_ARCHITECT_API, {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (controller.signal.aborted) {
            const timeoutError = new Error(`client timeout after ${Math.round(CALENDAR_ARCHITECT_CLIENT_TIMEOUT_MS / 1000)}s`);
            timeoutError.name = 'AbortError';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function calendarRedactErrorText(value) {
    return String(value || '')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
        .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[redacted]')
        .replace(/github_pat_[A-Za-z0-9_]{12,}/g, 'github_pat_[redacted]')
        .replace(/(api[_-]?key["':=\s]+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]')
        .replace(/(token["':=\s]+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]');
}

function calendarCompactErrorText(error, max = 240) {
    const raw = error?.message || error?.detail || error?.statusText || error || 'unknown error';
    return calendarRedactErrorText(raw).replace(/\s+/g, ' ').trim().slice(0, max);
}

function calendarApiFailureMessage(res, data, rawBody, localApiConfig, agent) {
    const parts = [
        `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`,
        `agent=${agent?.label || agent?.key || 'default'}`,
        `model=${data?.api?.model || localApiConfig?.model || localApiConfig?.name || 'unknown'}`
    ];
    if (data?.error) parts.push(`error=${data.error}`);
    if (data?.status) parts.push(`providerStatus=${data.status}`);
    if (data?.detail) parts.push(`detail=${data.detail}`);
    if (!data?.error && !data?.detail && rawBody) parts.push(`body=${rawBody.slice(0, 600)}`);
    return calendarCompactErrorText(parts.join(' | '), 900);
}

function calendarShouldUseAiRouter(note) {
    if (!calendarFastMode) return false;
    if (calendarAllAgentsMentioned(note)) return false;
    return !calendarConfiguredAgents().some(agent => calendarAgentMentioned(note, agent));
}

async function calendarResolveAiRoute(note, store, fallbackRoute) {
    if (!calendarShouldUseAiRouter(note)) return fallbackRoute;
    const routerProfile = calendarDefaultDialogueProfile(store)
        || calendarDialogueProfileFallback(store)
        || store.profiles.find(calendarApiProfileIsReady)
        || store.profiles[0]
        || calendarDefaultApiConfig();
    try {
        const res = await calendarFetchArchitectApi({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                routerOnly: true,
                message: note,
                plan: calendarVisiblePlanContext(),
                user: calendarCurrentUsername() || 'public',
                clientConfig: calendarPublicApiRequestConfig(routerProfile),
                clientConfigs: calendarClientConfigsForProfile(routerProfile),
                conversation: calendarConversationContextForModel(),
                fallbackRoute,
                siteKnowledge: {
                    routing: calendarWebsiteKnowledgeBase().routing,
                    calendarEditToolkit: calendarEditToolkitKnowledge(),
                    currentRequest: calendarCalendarEditContract(note, fallbackRoute)
                }
            })
        });
        const rawBody = await res.text().catch(() => '');
        let data = {};
        try {
            data = rawBody ? JSON.parse(rawBody) : {};
        } catch {
            data = { detail: rawBody.slice(0, 800) };
        }
        if (!res.ok || !data.ok || !data.route) {
            const message = calendarApiFailureMessage(res, data, rawBody, routerProfile, { label: 'AI Router', key: 'router' });
            return {
                ...fallbackRoute,
                reason: `${fallbackRoute.reason}（AI Router 失败，规则兜底：${message}）`,
                routerSource: 'local-fallback',
                routerError: message
            };
        }
        return calendarNormalizeRoute({
            ...data.route,
            routerSource: 'ai',
            routerModel: data.api?.model || routerProfile.model,
            routerMessage: (data.messages || []).join(' ')
        }, fallbackRoute);
    } catch (error) {
        return {
            ...fallbackRoute,
            reason: `${fallbackRoute.reason}（AI Router 失败，规则兜底：${calendarCompactErrorText(error, 220)}）`,
            routerSource: 'local-fallback',
            routerError: calendarCompactErrorText(error, 300)
        };
    }
}

async function calendarCallArchitectApiWithConfig(note, localApiConfig, options = {}) {
    try {
        const agent = options.agent ? calendarCleanAgent(options.agent) : null;
        const clientConfigs = calendarClientConfigsForProfile(localApiConfig);
        const route = options.route || calendarRequestRoute(note);
        const siteKnowledge = calendarWebsiteKnowledgeBase();
        siteKnowledge.currentRequest = calendarCalendarEditContract(note, route);
        if (options.statusText) {
            calendarApiStatus = options.statusText;
            calendarRenderApiStatus();
        }
        const res = await calendarFetchArchitectApi({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: note,
                plan: options.contextPlan || calendarVisiblePlanContext(),
                user: calendarCurrentUsername() || 'public',
                clientConfig: calendarPublicApiRequestConfig(localApiConfig),
                clientConfigs,
                agent: calendarAgentPayload(agent),
                agentInstruction: calendarAgentInstruction(agent, route, note),
                conversation: options.conversationContext || null,
                siteKnowledge
            })
        });
        const rawBody = await res.text().catch(() => '');
        let data = {};
        try {
            data = rawBody ? JSON.parse(rawBody) : {};
        } catch (error) {
            data = { detail: rawBody.slice(0, 1200) };
        }
        if (!res.ok || !data.ok) {
            const errorText = `API 不可用：${calendarApiFailureMessage(res, data, rawBody, localApiConfig, agent)}`;
            if (options.throwOnFailure) throw new Error(errorText);
            calendarApiStatus = `${errorText}；API-only 模式未生成本地回答。`;
            calendarRenderApiStatus();
            return null;
        }
        const sourceLabel = `${data.api?.source === 'client' ? 'local BYOK' : 'server key'} · ${data.api?.provider || 'custom'} · ${data.api?.model || ''}`;
        if (!options.silentStatus) {
            calendarApiStatus = `输出来源：${sourceLabel}`;
            calendarRenderApiStatus();
        }
        const guardedPlan = calendarApplyCalendarEditContractToPlan(data.plan, note, route, options.contextPlan || calendarVisiblePlanContext());
        const agentMessage = agent
            ? [`${agent.label || agent.key} Agent：${agent.job || '完成一次独立排程建议'}。`]
            : [];
        return {
            plan: guardedPlan,
            messages: [...agentMessage, `输出来源：${sourceLabel}`, ...(data.messages || [])],
            api: data.api,
            memoryCandidates: data.memoryCandidates || []
        };
    } catch (error) {
        if (options.throwOnFailure) throw error;
        calendarApiStatus = error?.name === 'AbortError'
            ? `API 请求超时：${calendarCompactErrorText(error, 220)}；API-only 模式未生成本地回答。`
            : `API 请求失败：${calendarCompactErrorText(error, 300)}；API-only 模式未生成本地回答。`;
        calendarRenderApiStatus();
        return null;
    }
}

async function calendarCallAgentCouncil(note, selection) {
    const agents = selection?.agents || [];
    if (!agents.length) return null;
    calendarApiStatus = `Agent 会诊：正在调用 ${agents.length} 个 agent...`;
    calendarRenderApiStatus();

    const settled = await Promise.allSettled(agents.map(agent => {
        const profile = agent.apiConfig || calendarApiProfileForAgent(agent);
        return calendarCallArchitectApiWithConfig(note, profile, {
            agent,
            silentStatus: true,
            throwOnFailure: true
        }).then(result => ({ agent, profile, result }));
    }));

    const successes = settled
        .filter(item => item.status === 'fulfilled' && item.value?.result?.plan)
        .map(item => item.value);
    const failures = settled
        .map((item, index) => ({ item, index }))
        .filter(entry => entry.item.status === 'rejected')
        .map(entry => `${agents[entry.index]?.label || `Agent ${entry.index + 1}`} 失败：${String(entry.item.reason?.message || entry.item.reason).slice(0, 120)}`);

    if (!successes.length) {
        calendarApiStatus = `Agent 会诊失败：${failures[0] || '没有可用模型'}；API-only 模式未生成本地回答。`;
        calendarRenderApiStatus();
        return null;
    }

    const intent = calendarFastModeIntent(note);
    const preferredKey = intent.key === 'challenge'
        ? 'dialogue'
        : (intent.key === 'audit' || intent.key === 'flash' ? 'auditor' : intent.key);
    const preferred = successes.find(item => item.agent.key === preferredKey)
        || successes.find(item => item.agent.key === 'planner')
        || successes[0];
    const adoptedLabel = preferred.agent.label || preferred.agent.key || preferred.profile.name;
    calendarApiStatus = `Agent 会诊完成：${successes.length}/${agents.length} 成功，采用 ${adoptedLabel}`;
    calendarRenderApiStatus();

    const runSummary = successes.map(item => {
        const agentLabel = item.agent.label || item.agent.key;
        const modelLabel = item.result?.api?.model || item.profile.model || item.profile.name;
        return `${agentLabel} Agent 使用 ${modelLabel} 返回方案`;
    });
    return {
        plan: preferred.result.plan,
        messages: [
            `Agent 会诊：${successes.length}/${agents.length} 成功；最终采用 ${adoptedLabel} Agent。`,
            `Agent 和模型分离：本次跑的是 ${agents.length} 个 agent，每个 agent 绑定一个 API profile。`,
            ...runSummary,
            ...failures,
            ...(preferred.result.messages || [])
        ].slice(0, 8),
        memoryCandidates: successes.flatMap(item => item.result.memoryCandidates || []).slice(0, 6)
    };
}

async function calendarCallArchitectApi(note) {
    const apiStore = calendarLoadApiStore();
    const councilSelection = calendarAgentCouncilSelection(note, apiStore);
    if (councilSelection) {
        const result = await calendarCallAgentCouncil(note, councilSelection);
        if (result) return result;
    }

    const fastSelection = calendarFastModeConfig(note, apiStore);
    const localApiConfig = fastSelection.config;
    const statusText = calendarFastMode
        ? `Fast mode：${fastSelection.reason} → ${localApiConfig.name}`
        : '';
    const agent = calendarAgentForIntent(note, apiStore);
    const result = await calendarCallArchitectApiWithConfig(note, localApiConfig, { statusText, agent });
    if (!result) return null;
    const fastMessage = calendarFastMode
        ? [`Fast mode：${fastSelection.reason}，已选择 ${localApiConfig.name}。`]
        : [];
    return {
        ...result,
        messages: [...fastMessage, ...(result.messages || [])]
    };
}

function calendarBuildCoachUpdate(note) {
    const plan = calendarCleanPlan(calendarPlan);
    const messages = [];
    let handled = false;

    const command = calendarExtractCommand(note);
    const intent = calendarClassifyUserIntent(note, command);
    if (command) {
        handled = calendarApplyCommand(plan, command, note, messages);
    }

    if (!handled) {
        handled = calendarApplyUserIntent(plan, intent, note, messages);
    }

    const readOnly = calendarIntentIsReadOnly(intent, command);

    if (!readOnly && intent.kind !== 'profile-input' && command !== '/profile') {
        calendarApplyProfileSignals(plan, note, messages);
    }

    const weight = calendarParseWeightGoal(note);
    if (!readOnly && weight) {
        handled = true;
        calendarApplyWeightPlan(plan, weight, messages);
    }

    if (!readOnly && /ielts|雅思/i.test(note)) {
        handled = true;
        calendarApplyIeltsPlan(plan, note, messages);
    }

    if (!readOnly && calendarLooksLikeMiss(note)) {
        handled = true;
        calendarApplyRecovery(plan, messages);
    }

    if (!readOnly && calendarLooksLikeAhead(note)) {
        handled = true;
        calendarApplyReward(plan, messages);
    }

    const adjustedPlan = !readOnly && calendarLooksLikeAdjustment(note) ? calendarApplyAdjustmentPlan(plan, note, messages) : false;
    handled = adjustedPlan || handled;

    if (!readOnly && !adjustedPlan && calendarLooksLikePresentationPlan(note)) {
        handled = true;
        calendarApplyPresentationPlan(plan, note, messages);
    }

    if (!readOnly && (!handled || (/deadline|due|ddl|截至|截止|到期/i.test(note) && !/ielts|雅思|kg|kilogram|公斤|千克|减重|减肥|瘦/i.test(note)))) {
        calendarApplyGenericPlan(plan, note, messages);
    }

    if (!readOnly) {
        calendarEnsureDailyReflection(plan, messages);
        calendarRepairOverlaps(plan, messages);
    }

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
    if (!match) return '';
    const command = match[0].toLowerCase();
    if (command === '/command') return '/commands';
    return command;
}

function calendarCommandPayload(note) {
    return String(note || '').trim().replace(/^\/[a-z0-9-]+\s*/i, '').trim();
}

function calendarIntentIsReadOnly(intent, command = '') {
    if (['/commands', '/help', '/health', '/why', '/report'].includes(command)) return true;
    if (command === '/profile' && !calendarCommandPayload(intent?.raw || '')) return true;
    return ['casual', 'profile-query', 'health-query', 'why', 'command-help', 'report', 'challenge'].includes(intent?.kind);
}

function calendarClassifyUserIntent(note, command = '') {
    const raw = String(note || '');
    const text = raw.toLowerCase();
    const payload = calendarCommandPayload(raw);
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
    if (calendarLooksLikeDeleteRequest(raw)) return { kind: 'delete', raw };
    if (calendarLooksLikeMultiGoalInput(raw)) return { kind: 'multi-goal', raw };
    if (calendarLooksLikeLongProfileInput(raw)) return { kind: 'profile-input', raw };
    if (!command && /^(hi|hello|hey|你好|在吗|谢谢|thx|thanks|哈哈|ok|好的|收到)[\s。！!,.，]*$/i.test(text.trim())) {
        return { kind: 'casual', raw };
    }
    return { kind: 'planning', raw };
}

function calendarApplyUserIntent(plan, intent, note, messages) {
    switch (intent?.kind) {
        case 'command-help':
            messages.push(calendarCommandGuide());
            return true;
        case 'casual':
            messages.push(calendarCasualReply(plan));
            return true;
        case 'profile-query':
            messages.push(calendarUserProfileView(plan));
            return true;
        case 'health-query':
            messages.push(calendarUserHealthView(plan, note));
            if (calendarLooksLikeTired(note)) calendarApplyLightMode(plan, messages);
            return true;
        case 'why':
            messages.push(calendarArrangementWhy(plan));
            return true;
        case 'report':
            calendarApplyReport(plan, note, messages);
            return true;
        case 'challenge':
            messages.push(calendarChallengeCurrentPlan(plan));
            return true;
        case 'delete':
            return calendarApplyDeleteRequest(plan, note, messages);
        case 'profile-input':
            calendarApplyProfileSignals(plan, note, messages, { forceSave: /保存|记住|save|remember|写入|加入|更新 profile/i.test(note) });
            if (!messages.length) messages.push('Profile intake: 我识别到这是长期信息输入，但还缺明确字段；请补充睡眠、固定安排、每周可用小时、精力高低峰或常见失败模式。');
            return true;
        case 'multi-goal':
            calendarApplyMultiGoalPlan(plan, note, messages);
            return true;
        default:
            return false;
    }
}

function calendarLooksLikeTired(text) {
    return /(累|疲惫|没精神|精力低|撑不住|burnout|tired|exhausted|low energy)/i.test(String(text || ''));
}

function calendarLooksLikeDeleteRequest(text) {
    return /(删除|删掉|取消|移除|不要这个|drop|delete|remove|cancel).{0,80}(时间块|安排|任务|block|event|计划)?/i.test(String(text || ''));
}

function calendarLooksLikeLongProfileInput(text) {
    const raw = String(text || '');
    if (raw.length < 60) return false;
    const hits = [
        /(我是|我现在|目前|身份|工作|学生|考试|项目|兼职)/,
        /(每周|固定|周一|周二|周三|周四|周五|周末|上课|会议|通勤)/,
        /(睡眠|睡觉|起床|作息|晚饭|吃饭|运动|恢复|健康)/,
        /(上午|下午|晚上|精力|专注|效率|拖延|低估|失败模式)/
    ].filter(regex => regex.test(raw)).length;
    return hits >= 2;
}

function calendarLooksLikeMultiGoalInput(text) {
    const raw = String(text || '');
    const numbered = raw.match(/(^|\n)\s*(?:\d+[.)、]|[-*•])\s*\S+/g) || [];
    if (numbered.length >= 2) return true;
    const connectors = /(同时|还要|另外|除此之外|and also|as well as)/i.test(raw);
    const goalWords = (raw.match(/(目标|完成|准备|学习|训练|项目|考试|交付|减重|雅思|IELTS|demo|presentation|report|paper)/ig) || []).length;
    return connectors && goalWords >= 3;
}

function calendarApplyGoalCommand(plan, note, messages) {
    const payload = calendarCommandPayload(note);
    if (!payload) {
        messages.push('Goal Contract: 请在 /goal 后写清目标、deadline、当前水平、每周可用时间和成功标准。例：/goal 6月15日前 IELTS Task 2 稳定 7 分；每周 8h；现在结构和例子不稳。');
        return;
    }
    if (calendarLooksLikeMultiGoalInput(payload)) {
        calendarApplyMultiGoalPlan(plan, payload, messages);
        return;
    }
    calendarApplyGenericPlan(plan, payload, messages);
    messages.unshift('Goal Contract: 已按目标 → 工作量 → 可行性 → 时间块建立初版；缺失 baseline/deadline 的地方会标低置信度。');
}

function calendarApplyDeleteRequest(plan, note, messages) {
    const before = plan.blocks.length;
    let deleted = [];
    if (calendarSelectedBlockId) {
        const selected = plan.blocks.find(block => block.id === calendarSelectedBlockId);
        if (selected) {
            deleted = [selected];
            plan.blocks = plan.blocks.filter(block => block.id !== selected.id);
            calendarClearBlockSelection();
        }
    } else {
        const keyword = calendarDeleteKeyword(note);
        if (keyword) {
            const scored = plan.blocks
                .map(block => ({ block, score: calendarTextMatchScore(`${block.title || ''} ${block.note || ''}`, keyword) }))
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);
            if (scored.length) {
                const topScore = scored[0].score;
                deleted = scored.filter(item => item.score === topScore).map(item => item.block).slice(0, 1);
                const ids = new Set(deleted.map(block => block.id));
                plan.blocks = plan.blocks.filter(block => !ids.has(block.id));
            }
        }
    }
    if (deleted.length) {
        messages.push(`删除完成：已移除「${deleted.map(block => calendarReadableBlockTitle(block)).join('、')}」。`);
        return plan.blocks.length < before;
    }
    messages.push('删除请求没有匹配到具体时间块。请先点选一个块再说“删除”，或写清标题，例如“删除周三 PPT 草稿”。');
    return true;
}

function calendarDeleteKeyword(text) {
    return String(text || '')
        .replace(/^\/[a-z0-9-]+\s*/i, '')
        .replace(/(请|帮我|把|将|这个|那个|今天|明天|本周|周[一二三四五六日天]|星期[一二三四五六日天])/g, ' ')
        .replace(/(删除|删掉|取消|移除|不要|drop|delete|remove|cancel|时间块|安排|任务|block|event|计划)/ig, ' ')
        .replace(/[，。；;,.!?？]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
}

function calendarTextMatchScore(source, query) {
    const haystack = String(source || '').toLowerCase();
    const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return 0;
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? token.length : 0), 0);
}

function calendarApplyMultiGoalPlan(plan, note, messages) {
    const items = calendarExtractGoalItems(note).slice(0, 5);
    if (!items.length) {
        messages.push('多目标输入没有拆出清晰目标。请用 1/2/3 或每行一个目标写：目标、deadline、成功标准、每周可用时间。');
        return;
    }
    let totalBlocks = 0;
    const created = [];
    items.forEach((item, index) => {
        const duration = calendarExtractDurationMinutes(item, 90);
        const title = calendarSummarizeTitle(item) || `目标 ${index + 1}`;
        const deadlineDay = calendarDetectWeekday(item);
        const goal = calendarEnsureGoal(plan, 'project', title, {
            desiredOutcome: title,
            deadline: deadlineDay !== null ? calendarDateForDay(plan.weekStart, deadlineDay) : '',
            successCriteria: calendarGoalSuccessFromText(item),
            currentBaseline: 'unknown：需要后续补充当前进度后校准',
            gap: '多目标并行，先按现实容量分配最小推进块',
            requiredDeliverables: [title],
            estimatedWorkload: {
                minimumHours: Math.max(1, Math.round(duration / 60)),
                realisticHours: Math.max(2, Math.round(duration / 45)),
                strongHours: Math.max(3, Math.round(duration / 30)),
                confidence: 'low until each goal has baseline and deadline'
            },
            risks: ['parallel goals competing for capacity', 'unclear priority', 'review time may be missing'],
            reviewCheckpoints: ['weekly priority review'],
            priority: `P${Math.min(index + 1, 3)}`,
            weeklyTarget: `${Math.max(1, Math.round(duration / 60))}h 初始推进`,
            dailyMinimum: '一个 25-45 分钟最小动作'
        });
        const source = `coach:multi:${calendarSlug(title)}`;
        calendarRemoveSource(plan, source);
        const category = /学习|雅思|IELTS|考试|阅读|写作/i.test(item) ? 'study' : 'deep';
        let scheduled = calendarScheduleBeforeDay(plan, source, goal.id, title, category, duration, deadlineDay === null ? 5 : deadlineDay);
        if (!scheduled) {
            const mini = Math.min(45, Math.max(25, Math.round(duration / 3)));
            const slot = calendarFindNextFreeSlot(plan, mini, [9 * 60, 20 * 60, 14 * 60, 10 * 60 + 30]);
            if (slot) {
                plan.blocks.push(calendarCleanBlock({
                    title,
                    category,
                    day: slot.day,
                    start: slot.start,
                    end: slot.start + mini,
                    source,
                    goalId: goal.id,
                    note: '多目标初版只排最小推进块，避免虚假塞满。'
                }));
                scheduled = 1;
            }
        }
        totalBlocks += scheduled;
        created.push(title);
    });
    messages.push(`多目标安排：拆出 ${created.length} 个目标（${created.join('、')}），先排 ${totalBlocks} 个最小推进块。`);
    messages.push('用户视角判断：这不是最终承诺，而是第一版容量分配；下一步要按优先级砍范围或补 deadline/baseline。');
}

function calendarExtractGoalItems(text) {
    const raw = String(text || '').replace(/^\/goal\s*/i, '').trim();
    const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const bulletLines = lines
        .map(line => line.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '').trim())
        .filter(line => line.length >= 4)
        .filter(line => !/几个目标[:：]?$|如下[:：]?$|包括[:：]?$/i.test(line));
    if (bulletLines.length >= 2) return bulletLines;
    return raw.split(/(?:；|;|。|\.\s+|同时|另外|还要|除此之外)/)
        .map(item => item.trim())
        .filter(item => /(目标|完成|准备|学习|训练|项目|考试|交付|雅思|IELTS|demo|presentation|report|paper)/i.test(item));
}

function calendarGoalSuccessFromText(text) {
    const source = String(text || '').trim();
    const match = source.match(/(?:成功标准|标准|产出|output|deliverable|完成标准)[:：]\s*([^；。\n]+)/i);
    return match ? match[1].trim().slice(0, 180) : '完成一个可检查的小产出，并记录实际耗时和偏差。';
}

function calendarCommandGuide() {
    return [
        '命令用途速查：',
        '/goal 目标 + deadline + 当前水平 + 每周可用时间 -> 产出 Goal Contract、工作量估算、可行性和时间块。',
        '/estimate 任务/目标 -> 先估 minimum / realistic / strong hours，不急着排日历。',
        '/build-day -> 产出今天下一步做什么，适合早上开工前看。',
        '/build-week 或 /24-7 -> 把 active goals 映射到本周 24/7 表。',
        '/reflect 完成/没完成/原因/精力 -> 产出偏差分析、明天保护块、估时校准线索。',
        '/catch-up 原计划/实际/卡点/剩余时间 -> 产出补救路径，不惩罚、不熬夜硬补。',
        '/audit -> 查冲突、过载、模糊任务、漏复盘、漏恢复。',
        '/why -> 解释当前安排为什么这样排，包含目标、容量、精力和风险。',
        '/health -> 总结睡眠、恢复、深度任务堆叠和今天是否适合 sprint。',
        '/profile -> 查看我如何理解你的长期画像；加内容时写 /profile 记住：...',
        '/memory -> 提出或管理长期记忆候选，避免把一次性情绪误存。',
        '/light-mode -> 累的时候保留低强度不断线块。',
        '/sprint -> 明确接受短期冲刺风险时使用。',
        '/council 或 @all -> 让当前配置的 agent 全部会诊。',
        '/report -> 生成日报/周报/月报并写入存档。',
        '/reset -> 清理自动安排，保留手动块。'
    ].join('\n');
}

function calendarCasualReply(plan) {
    const next = calendarTodayBlocks(plan)[0];
    if (next) return `我在。当前最有用的信息是：下一块是 ${calendarMinutesToTime(next.start)} 的「${calendarReadableBlockTitle(next)}」。闲聊不会改你的计划；要调整就直接说“把 X 改到周三”或用 /goal。`;
    return '我在。现在闲聊不会改计划；你可以直接告诉我目标、状态、卡点，或者用 /commands 看所有指令怎么用。';
}

function calendarUserProfileView(plan) {
    const profile = calendarCleanProfile(plan.profile);
    const energy = profile.energyPattern || {};
    const facts = [
        profile.currentLifeStage ? `当前阶段：${profile.currentLifeStage}` : '',
        profile.roles?.length ? `角色：${profile.roles.join('、')}` : '',
        profile.fixedCommitments ? `固定约束：${profile.fixedCommitments}` : '',
        profile.weeklyCapacityHours ? `每周可用容量：约 ${profile.weeklyCapacityHours}h` : '',
        profile.sleepWindow ? `睡眠窗口：${profile.sleepWindow}` : '',
        energy.highFocusTime ? `高专注时段：${energy.highFocusTime}` : '',
        energy.lowEnergyTime ? `低能量时段：${energy.lowEnergyTime}` : '',
        profile.commonFailureModes?.length ? `常见失败模式：${profile.commonFailureModes.join('、')}` : ''
    ].filter(Boolean);
    return [
        '我目前这样看你的 Profile：',
        ...(facts.length ? facts.map(item => `- ${item}`) : ['- 还没有足够长期信息；目前只能按默认容量和作息安排。']),
        '规划影响：我会优先保护高专注窗口、把复盘/整理放到低能量时段，并对你容易低估的任务自动加 buffer。',
        '不确定项：如果这些判断不准，直接说“/profile 记住/更新：...”就能改。'
    ].join('\n');
}

function calendarUserHealthView(plan, note = '') {
    const original = calendarPlan;
    calendarPlan = plan;
    const health = calendarHealthPlan();
    const ledger = calendarWorkloadLedger();
    calendarPlan = original;
    const todayDeep = calendarTodayBlocks(plan).filter(block => ['deep', 'study'].includes(block.category));
    return [
        'Health 判断：',
        `- 风险：${health.riskLabel}。${health.rule}`,
        `- 睡眠：${health.sleepWindow}；${health.sleepDetail}`,
        `- 恢复：${health.recovery}`,
        `- 本周负荷：${ledger.plannedHours}h / ${ledger.weeklyCapacityHours}h，buffer ${ledger.bufferHours}h。`,
        `- 今天高认知块：${todayDeep.length ? todayDeep.map(block => calendarReadableBlockTitle(block)).join('、') : '暂无'}`,
        calendarLooksLikeTired(note) ? '用户状态补充：你说累了，所以更适合 light-mode，不适合继续加深度任务。' : '下一步：用真实精力反馈校准，不要把晚上当无限补偿区。'
    ].filter(Boolean).join('\n');
}

function calendarArrangementWhy(plan) {
    const goals = plan.goals.filter(goal => goal.status === 'active').slice(0, 3);
    const ledger = (() => {
        const original = calendarPlan;
        calendarPlan = plan;
        const value = calendarWorkloadLedger();
        calendarPlan = original;
        return value;
    })();
    const today = calendarTodayBlocks(plan).slice(0, 5);
    const checks = calendarAnalyzePlanFor(plan).slice(0, 3).map(item => item.text);
    return [
        '为什么这样安排：',
        goals.length ? `- 目标来源：当前 active goals 是 ${goals.map(goal => goal.title).join('、')}。` : '- 目标来源：还没有明确 active goal，所以计划只能按现有时间块和默认规则解释。',
        `- 容量判断：本周已排 ${ledger.plannedHours}h / 可用 ${ledger.weeklyCapacityHours}h；${ledger.reason}`,
        today.length ? `- 今天顺序：${today.map(block => `${calendarMinutesToTime(block.start)} ${calendarReadableBlockTitle(block)}`).join('；')}。` : '- 今天还没有时间块。',
        checks.length ? `- 风险依据：${checks.join(' / ')}` : '- 风险依据：当前没有明显冲突。',
        '用户视角：如果你不认同这个原因，最有效的挑战方式是指出“目标优先级错了 / 时间估少了 / 这个时段我做不了”。'
    ].join('\n');
}

function calendarChallengeCurrentPlan(plan) {
    const checks = calendarAnalyzePlanFor(plan).slice(0, 5);
    const goalCount = plan.goals.filter(goal => goal.status === 'active').length;
    return [
        'Challenge 视角：我不会默认当前计划就是对的。',
        goalCount ? `- 当前有 ${goalCount} 个 active goal，需要确认优先级，而不是全部平均塞进日历。` : '- 最大盲区：没有 active goal，日历可能只是任务堆叠。',
        ...(checks.length ? checks.map(item => `- ${item.text}`) : ['- 暂未发现硬冲突，但仍需要用真实执行数据校准。']),
        '- 建议：先挑一个你最怀疑的假设，我会重算工作量、时段或取舍。'
    ].join('\n');
}

function calendarApplyReport(plan, note, messages) {
    const type = calendarReportType(note);
    const content = calendarBuildReportContent(plan, type);
    calendarAddArchive(plan, type, calendarReportTitle(type), content, ['api-scenario-check']);
    messages.push(`${calendarReportTitle(type)} 已生成并写入存档。`);
    messages.push(content);
}

function calendarReportType(note) {
    const text = String(note || '');
    if (/月报|monthly|month/i.test(text)) return 'monthly-report';
    if (/周报|weekly|week|本周/i.test(text)) return 'weekly-report';
    return 'daily-report';
}

function calendarReportTitle(type) {
    if (type === 'monthly-report') return '月报';
    if (type === 'weekly-report') return '周报';
    return '日报';
}

function calendarBuildReportContent(plan, type) {
    const original = calendarPlan;
    calendarPlan = plan;
    const metrics = calendarPlanMetrics();
    const ledger = calendarWorkloadLedger();
    const health = calendarHealthPlan();
    const checks = calendarAnalyzePlan().slice(0, 4).map(item => item.text);
    const today = calendarTodayBlocks(plan).slice(0, 6);
    calendarPlan = original;
    return [
        `${calendarReportTitle(type)} Summary`,
        `1. 当前安排：本周 ${metrics.totalText}，高认知 ${metrics.focusText}，active goals ${metrics.activeGoals}。`,
        `2. 工作量：${ledger.plannedHours}h / ${ledger.weeklyCapacityHours}h，buffer ${ledger.bufferHours}h，风险 ${ledger.overloadRisk}。`,
        `3. Health：${health.riskLabel}风险；${health.rule}`,
        `4. 今天：${today.length ? today.map(block => `${calendarMinutesToTime(block.start)} ${calendarReadableBlockTitle(block)}`).join('；') : '暂无时间块'}`,
        `5. 风险：${checks.length ? checks.join(' / ') : '暂无明显风险'}`,
        '6. 下一步：先处理最高风险目标，再用 /reflect 记录实际耗时，避免只看计划不校准。'
    ].join('\n');
}

function calendarAddArchive(plan, type, title, content, models = []) {
    plan.archives = Array.isArray(plan.archives) ? plan.archives : [];
    plan.archives.push({
        id: calendarId('archive'),
        type,
        title,
        content,
        models,
        createdAt: new Date().toISOString(),
        source: 'local-report'
    });
}

function calendarApplyCommand(plan, command, note, messages) {
    if (command === '/commands' || command === '/help') {
        messages.push(calendarCommandGuide());
        return true;
    }
    if (command === '/goal') {
        calendarApplyGoalCommand(plan, note, messages);
        return true;
    }
    if (command === '/reset') {
        plan.blocks = plan.blocks.filter(block => block.source === 'manual');
        messages.push('已执行 /reset：保留手动块，清理自动排程，回到最小可行计划。');
        return true;
    }
    if (command === '/audit') {
        calendarAnalyzePlanFor(plan).forEach(item => messages.push(`Audit: ${item.text}`));
        return true;
    }
    if (command === '/council') {
        messages.push('Agent council: 需要在线 API 才会并行调用当前配置里的所有 agent；API-only 模式下不会生成本地替代回答。');
        return true;
    }
    if (command === '/profile') {
        const payload = calendarCommandPayload(note);
        if (payload) {
            calendarApplyProfileSignals(plan, payload, messages, { forceSave: /保存|记住|save|remember|更新|写入|加入/i.test(payload) });
            if (!messages.length) messages.push('Profile mode: 我会提取长期稳定信息，例如每周容量、精力曲线、固定约束和失败模式。');
        } else {
            messages.push(calendarUserProfileView(plan));
        }
        return true;
    }
    if (command === '/health') {
        messages.push(calendarUserHealthView(plan, note));
        if (calendarLooksLikeTired(note)) calendarApplyLightMode(plan, messages);
        return true;
    }
    if (command === '/why') {
        messages.push(calendarArrangementWhy(plan));
        return true;
    }
    if (command === '/report') {
        calendarApplyReport(plan, note, messages);
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

function calendarApplyProfileSignals(plan, note, messages, options = {}) {
    const lower = String(note || '').toLowerCase();
    const profile = calendarCleanProfile(plan.profile);
    const capacity = calendarParseWeeklyCapacity(note);
    if (capacity) {
        profile.weeklyCapacityHours = capacity;
        messages.push(`Profile updated: 当前每周可用容量设为 ${capacity} 小时；所有 feasibility 都会基于这个数重算。`);
    }
    const sleep = calendarParseSleepWindow(note);
    if (sleep) {
        profile.sleepWindow = sleep;
        messages.push(`Profile updated: 睡眠窗口设为 ${sleep}；后续计划不会默认牺牲这段恢复。`);
    }
    const highFocus = calendarParseEnergyWindow(note, 'high');
    if (highFocus) {
        profile.energyPattern.highFocusTime = highFocus;
        messages.push(`Profile updated: 高专注时段设为 ${highFocus}；深度任务会优先往这里靠。`);
    }
    const lowEnergy = calendarParseEnergyWindow(note, 'low');
    if (lowEnergy) {
        profile.energyPattern.lowEnergyTime = lowEnergy;
        messages.push(`Profile updated: 低能量时段设为 ${lowEnergy}；后续优先放复盘/整理/轻任务。`);
    }
    const commitments = calendarParseFixedCommitments(note);
    if (commitments) {
        profile.fixedCommitments = commitments;
        messages.push('Profile updated: 已记录固定约束；排程会先避开这些不可移动时段。');
    }
    const stage = calendarParseLifeStage(note);
    if (stage) {
        profile.currentLifeStage = stage;
        messages.push(`Profile updated: 当前阶段设为「${stage}」。`);
    }
    const health = calendarParseHealthConstraint(note);
    if (health) {
        profile.healthRecoveryConstraints = health;
        messages.push('Profile updated: 已记录健康/恢复约束；高风险计划会先检查它。');
    }
    if (/晚上.*(学不进去|效率低|不适合|崩)|evening.*(cannot|can't|low|bad|tired)/i.test(lower)) {
        if (options.forceSave || /记住|保存|save|remember|加入 profile/i.test(note)) {
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

function calendarParseSleepWindow(text) {
    const source = String(text || '');
    const sleepSegment = source.match(/(?:睡眠|睡觉|作息|sleep|bed).{0,40}?(\d{1,2}:\d{2})\s*[-~—到至]\s*(\d{1,2}:\d{2})/i)
        || source.match(/(\d{1,2}:\d{2})\s*[-~—]\s*(\d{1,2}:\d{2}).{0,20}(?:睡眠|睡觉|起床|sleep|wake)/i);
    if (!sleepSegment) return '';
    return `${sleepSegment[1]}-${sleepSegment[2]}`;
}

function calendarParseEnergyWindow(text, type) {
    const source = String(text || '');
    const keyword = type === 'high'
        ? '(?:高专注|专注|效率高|清醒|deep work|focus)'
        : '(?:低能量|效率低|学不进去|疲惫|low energy|tired)';
    const match = source.match(new RegExp(`(${keyword}).{0,28}?((?:上午|下午|晚上|早上|中午|\\d{1,2}:\\d{2}\\s*[-~—到至]\\s*\\d{1,2}:\\d{2})[^，。；;\\n]*)`, 'i'))
        || source.match(new RegExp(`((?:上午|下午|晚上|早上|中午|\\d{1,2}:\\d{2}\\s*[-~—到至]\\s*\\d{1,2}:\\d{2})[^，。；;\\n]{0,20}).{0,16}${keyword}`, 'i'));
    return match ? String(match[2] || match[1]).replace(/到|至/g, '-').trim().slice(0, 80) : '';
}

function calendarParseFixedCommitments(text) {
    const source = String(text || '');
    const matches = source.match(/(?:固定|每周|每天|周[一二三四五六日天]|星期[一二三四五六日天]).{0,80}(?:上课|工作|会议|通勤|家庭|兼职|吃饭|晚饭|课程|commitment|meeting|class|work)[^。；;\n]*/gi);
    if (!matches?.length) return '';
    return matches.map(item => item.trim()).join('；').slice(0, 260);
}

function calendarParseLifeStage(text) {
    const source = String(text || '');
    const match = source.match(/(?:我现在是|我目前是|当前阶段是|目前阶段是|身份是|life stage is)\s*([^。；;\n]{2,80})/i);
    return match ? match[1].trim() : '';
}

function calendarParseHealthConstraint(text) {
    const source = String(text || '');
    const match = source.match(/(?:健康|身体|恢复|睡眠债|焦虑|胃|腰|肩|伤|病|health|recovery).{0,90}/i);
    return match ? match[0].trim().slice(0, 180) : '';
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

function calendarLooksLikeAdjustment(text) {
    return /调整|修改|改成|时长|改到|挪到|移到|推迟|提前|有事|没空|冲突|reschedule|resize|duration|move|conflict/i.test(text);
}

function calendarLooksLikePresentationPlan(text) {
    return /(演示|汇报|路演|demo|presentation|talk)/i.test(text)
        && /(准备|材料|大纲|ppt|slide|deck|排练|rehears)/i.test(text);
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

function calendarApplyPresentationPlan(plan, note, messages) {
    const title = calendarPresentationTitle(note);
    const deadlineDay = calendarDetectWeekday(note);
    const deadline = deadlineDay === null ? Math.min(5, calendarCurrentDayIndex(plan) + 2) : deadlineDay;
    const talkMinutes = calendarExtractTalkMinutes(note);
    const goal = calendarEnsureGoal(plan, 'project', title, {
        desiredOutcome: `${talkMinutes ? `${talkMinutes} 分钟` : ''}${title.replace(/准备$/, '')}顺利完成，材料清楚，排练到位。`.trim(),
        deadline: calendarDateForDay(plan.weekStart, deadline),
        successCriteria: '大纲清楚、PPT 可讲、至少两轮排练、最后留出缓冲。',
        currentBaseline: '材料尚未完成',
        gap: '需要把大纲、PPT、讲稿和排练拆成可执行块',
        requiredDeliverables: ['演示大纲', 'PPT 初稿', 'PPT 收口与讲稿', '两轮排练', '最后缓冲清单'],
        estimatedWorkload: {
            minimumHours: 3,
            realisticHours: 5,
            strongHours: 7,
            confidence: 'medium'
        },
        risks: ['把演示时长误当准备时长', 'PPT 做完但没排练', '周四晚上被填满导致没有缓冲'],
        reviewCheckpoints: ['PPT 初稿后', '第一轮排练后', '最终排练后'],
        weeklyTarget: '大纲、PPT、排练和缓冲闭环',
        dailyMinimum: '完成一个可交付小块'
    });
    const source = `coach:presentation:${calendarSlug(title)}`;
    calendarRemoveSource(plan, source);

    const currentDay = Math.max(0, calendarCurrentDayIndex(plan));
    const outlineDay = Math.min(Math.max(currentDay, deadline - 2), deadline);
    const polishDay = Math.max(outlineDay, deadline - 1);
    const bufferDay = Math.max(outlineDay, deadline - 1);
    const finalDay = deadline;
    let added = 0;

    added += calendarAddPlannedBlock(plan, source, goal.id, '演示大纲与听众问题', 'deep', outlineDay, [20 * 60, 19 * 60, 9 * 60], 60, '先定听众、主线、3 个关键信息。');
    added += calendarAddPlannedBlock(plan, source, goal.id, 'PPT 初稿', 'deep', outlineDay, [21 * 60 + 15, 20 * 60, 14 * 60], 90, '只追求可讲通，不做视觉精修。');
    added += calendarAddPlannedBlock(plan, source, goal.id, 'PPT 收口与讲稿', 'deep', polishDay, [20 * 60, 19 * 60, 10 * 60], 75, '收敛内容，写清开场、转场和结尾。');
    added += calendarAddPlannedBlock(plan, source, goal.id, '第一轮排练', 'reflection', polishDay, [21 * 60 + 30, 20 * 60 + 45, 15 * 60], 30, '按真实 20 分钟演示节奏跑一遍，记录卡顿点。');
    added += calendarAddPlannedBlock(plan, source, goal.id, '演示缓冲: 修最后卡点', 'recovery', bufferDay, [22 * 60, 21 * 60 + 30, 16 * 60], 30, '只修阻碍交付的问题，保留周四晚间余量。');
    added += calendarAddPlannedBlock(plan, source, goal.id, '最终排练与交付检查', 'reflection', finalDay, [10 * 60, 9 * 60, 11 * 60, 14 * 60], 45, '检查计时、设备、备份和 Q&A。');

    messages.push(`已把「${title}」拆成 ${added} 个准备块：大纲、PPT、两轮排练和最后缓冲。`);
    if (talkMinutes) messages.push(`我把 ${talkMinutes} 分钟识别为演示时长，不把它误当成准备工作量。`);
    messages.push('周四晚间只放短缓冲块，避免把最后一晚塞满。');
}

function calendarPresentationTitle(text) {
    const raw = String(text || '');
    if (/产品演示|product demo/i.test(raw)) return '产品演示准备';
    if (/演示|demo|presentation/i.test(raw)) return '演示准备';
    if (/汇报|talk/i.test(raw)) return '汇报准备';
    return '演示准备';
}

function calendarExtractTalkMinutes(text) {
    const lower = String(text || '').toLowerCase();
    const match = lower.match(/(\d+)\s*(?:m|min|mins|minute|minutes|分钟|分鐘).{0,12}(?:演示|汇报|presentation|demo|talk)/i)
        || lower.match(/(?:演示|汇报|presentation|demo|talk).{0,12}(\d+)\s*(?:m|min|mins|minute|minutes|分钟|分鐘)/i);
    return match ? Number(match[1]) : null;
}

function calendarAddPlannedBlock(plan, source, goalId, title, category, day, preferredStarts, duration, note = '') {
    const normalizedDay = Math.max(0, Math.min(6, Number(day) || 0));
    const slot = calendarFindFreeSlot(plan, normalizedDay, duration, preferredStarts);
    if (slot === null) return 0;
    const detailSeed = { title, category, day: normalizedDay, start: slot, end: slot + duration };
    plan.blocks.push(calendarCleanBlock({
        title,
        category,
        day: normalizedDay,
        start: slot,
        end: slot + duration,
        source,
        goalId,
        note,
        exactAction: calendarBlockExactAction(detailSeed),
        output: calendarBlockOutput(detailSeed),
        ifInterrupted: calendarBlockFallback(detailSeed)
    }));
    return 1;
}

function calendarApplyAdjustmentPlan(plan, note, messages) {
    const explicitDuration = calendarExtractExplicitDurationMinutes(note);
    if (explicitDuration !== null && /修改|改成|时长|resize|duration|minutes?|分钟|分鐘|min/i.test(note)) {
        const targetBlock = calendarFindBlockForAdjustment(plan, note);
        if (targetBlock) {
            targetBlock.end = Math.max(
                targetBlock.start + CALENDAR_MIN_BLOCK_MINUTES,
                Math.min(CALENDAR_DAY_MINUTES, targetBlock.start + explicitDuration)
            );
            messages.push(`Adjustment: 已把「${calendarReadableBlockTitle(targetBlock)}」改成 ${targetBlock.end - targetBlock.start} 分钟。`);
            return true;
        }
    }

    const mentions = calendarWeekdayMentions(note);
    const blockedDay = mentions[0]?.day ?? calendarCurrentDayIndex(plan);
    if (blockedDay < 0) return false;
    const window = calendarUnavailableWindow(note, mentions[0]?.index || 0);
    const keywords = calendarAdjustmentKeywords(note);
    const affected = plan.blocks
        .filter(block => block.day === blockedDay && block.start < window.end && block.end > window.start)
        .filter(block => !/reward/.test(block.category))
        .filter(block => !keywords.length || keywords.some(keyword => {
            const haystack = `${block.title || ''} ${block.source || ''}`.toLowerCase();
            return haystack.includes(keyword);
        }))
        .sort((a, b) => a.start - b.start);
    if (!affected.length) {
        messages.push('Adjustment: 我没有找到那个时段里需要移动的时间块，当前计划保持不变。');
        return true;
    }

    const targetMention = mentions.find(item => item.day !== blockedDay);
    const requestedTarget = targetMention?.day;
    const preferredStarts = calendarPreferredStartsForAdjustment(note, targetMention?.index);
    let moved = 0;
    affected.forEach(block => {
        const duration = block.end - block.start;
        const previousStart = block.start;
        const target = calendarFindAdjustmentSlot(plan, block.id, duration, requestedTarget, blockedDay, preferredStarts);
        if (!target) return;
        block.day = target.day;
        block.start = target.start;
        block.end = target.start + duration;
        block.note = `${block.note ? `${block.note}\n` : ''}因调整请求从 ${CALENDAR_DAYS[blockedDay]?.label || '原日期'} ${calendarMinutesToTime(previousStart)} 附近重排。`;
        moved++;
    });

    if (moved) {
        const targetText = requestedTarget === undefined ? '后续可用空档' : CALENDAR_DAYS[requestedTarget]?.label;
        messages.push(`Adjustment: 已把 ${moved} 个冲突块从 ${CALENDAR_DAYS[blockedDay]?.label} ${window.label} 挪到${targetText}附近。`);
    } else {
        messages.push('Adjustment: 找到了冲突块，但后续没有足够空档；建议删减范围或指定更宽的可用时间。');
    }
    return true;
}

function calendarFindBlockForAdjustment(plan, note) {
    const selected = calendarSelectedBlockId
        ? plan.blocks.find(block => block.id === calendarSelectedBlockId)
        : null;
    if (selected) return selected;
    const lower = String(note || '').toLowerCase();
    return [...plan.blocks]
        .sort((a, b) => (b.title || '').length - (a.title || '').length)
        .find(block => {
            const title = String(block.title || '').trim().toLowerCase();
            return title && lower.includes(title);
        }) || null;
}

function calendarAdjustmentKeywords(text) {
    const lower = String(text || '').toLowerCase();
    const keywords = [];
    if (/演示|汇报|demo|presentation|talk|产品/.test(lower)) keywords.push('演示', 'presentation', 'demo', 'product');
    if (/ppt|slide|deck/.test(lower)) keywords.push('ppt', 'slide', 'deck');
    if (/大纲|outline/.test(lower)) keywords.push('大纲', 'outline');
    if (/排练|rehears/.test(lower)) keywords.push('排练', 'rehears');
    return [...new Set(keywords)];
}

function calendarWeekdayMentions(text) {
    const lower = String(text || '').toLowerCase();
    const patterns = [
        ['sunday', 0], ['sun', 0], ['周日', 0], ['星期日', 0], ['礼拜日', 0], ['週日', 0],
        ['monday', 1], ['mon', 1], ['周一', 1], ['星期一', 1], ['礼拜一', 1], ['週一', 1],
        ['tuesday', 2], ['tue', 2], ['周二', 2], ['星期二', 2], ['礼拜二', 2], ['週二', 2],
        ['wednesday', 3], ['wed', 3], ['周三', 3], ['星期三', 3], ['礼拜三', 3], ['週三', 3],
        ['thursday', 4], ['thu', 4], ['周四', 4], ['星期四', 4], ['礼拜四', 4], ['週四', 4],
        ['friday', 5], ['fri', 5], ['周五', 5], ['星期五', 5], ['礼拜五', 5], ['週五', 5],
        ['saturday', 6], ['sat', 6], ['周六', 6], ['星期六', 6], ['礼拜六', 6], ['週六', 6]
    ];
    return patterns
        .map(([needle, day]) => ({ day, index: lower.indexOf(needle) }))
        .filter(item => item.index >= 0)
        .sort((a, b) => a.index - b.index)
        .filter((item, index, list) => list.findIndex(other => other.day === item.day) === index);
}

function calendarTimeMarkers(text, anchorIndex = 0) {
    const source = String(text || '');
    const segment = source.slice(Math.max(0, anchorIndex), Math.max(0, anchorIndex) + 28);
    const markers = [
        { regex: /上午|morning/i, value: 'morning' },
        { regex: /下午|afternoon/i, value: 'afternoon' },
        { regex: /晚上|晚间|evening|night/i, value: 'evening' }
    ];
    const local = markers
        .map(marker => ({ ...marker, index: segment.search(marker.regex) }))
        .filter(marker => marker.index >= 0)
        .sort((a, b) => a.index - b.index);
    if (local.length) return local[0].value;
    const global = markers
        .map(marker => ({ ...marker, index: source.search(marker.regex) }))
        .filter(marker => marker.index >= 0)
        .sort((a, b) => a.index - b.index);
    return global[0]?.value || '';
}

function calendarUnavailableWindow(text, anchorIndex = 0) {
    const marker = calendarTimeMarkers(text, anchorIndex);
    if (marker === 'morning') return { start: 8 * 60, end: 12 * 60, label: '上午' };
    if (marker === 'afternoon') return { start: 12 * 60, end: 18 * 60, label: '下午' };
    if (marker === 'evening') return { start: 18 * 60, end: 23 * 60, label: '晚上' };
    return { start: 0, end: CALENDAR_DAY_MINUTES, label: '全天' };
}

function calendarPreferredStartsForAdjustment(text, anchorIndex = 0) {
    const marker = calendarTimeMarkers(text, anchorIndex);
    if (marker === 'morning') return [9 * 60, 10 * 60 + 30, 8 * 60 + 30, 14 * 60, 20 * 60];
    if (marker === 'afternoon') return [14 * 60, 15 * 60 + 30, 16 * 60, 20 * 60, 9 * 60];
    if (marker === 'evening') return [20 * 60, 21 * 60, 18 * 60 + 30, 9 * 60, 14 * 60];
    return [20 * 60, 9 * 60, 14 * 60, 10 * 60 + 30, 16 * 60];
}

function calendarFindAdjustmentSlot(plan, blockId, duration, requestedTarget, blockedDay, preferredStarts) {
    const targets = [];
    if (requestedTarget !== undefined) targets.push(requestedTarget);
    for (let offset = 1; offset <= 6; offset++) targets.push((blockedDay + offset) % 7);
    for (const day of [...new Set(targets)]) {
        const slot = calendarFindFreeSlotIgnoring(plan, day, duration, preferredStarts, blockId);
        if (slot !== null) return { day, start: slot };
    }
    return null;
}

function calendarFindFreeSlotIgnoring(plan, day, duration, preferredStarts, ignoreId) {
    const wake = calendarTimeToMinutes(plan.habits?.wake, 8 * 60);
    let sleep = calendarTimeToMinutes(plan.habits?.sleep, 23 * 60 + 30);
    if (sleep <= wake) sleep = CALENDAR_DAY_MINUTES;
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
        .filter(start => start >= wake && start + duration <= sleep);

    for (const start of starts) {
        if (calendarSlotIsFree(plan, day, start, start + duration, ignoreId)) return start;
    }
    for (let start = calendarRoundToSlot(wake); start + duration <= sleep; start += CALENDAR_SLOT_MINUTES) {
        if (calendarSlotIsFree(plan, day, start, start + duration, ignoreId)) return start;
    }
    return null;
}

function calendarApplyGenericPlan(plan, note, messages) {
    const title = calendarSummarizeTitle(note);
    const duration = calendarExtractDurationMinutes(note, /deadline|due|ddl|截至|截止|到期/i.test(note) ? 240 : 60);
    const everyDay = calendarLooksLikeEveryDayTask(note);
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

function calendarLooksLikeEveryDayTask(text) {
    const lower = String(text || '').toLowerCase();
    if (/每天(?:都)?(?:安排|做|练|复习|学习|写|读|打卡|推进|训练)|每日(?:安排|复盘|打卡|训练)|every day.*(?:practice|work on|review|train|study)|daily.*(?:practice|review|workout|study)/i.test(lower)) {
        return true;
    }
    return false;
}

function calendarSummarizeTitle(text) {
    const firstLine = String(text || '').split(/\n/).map(line => line.trim()).find(Boolean) || '新任务';
    const concise = firstLine
        .split(/[。；;.!?？]/)
        .map(item => item.trim())
        .find(item => item && !/请帮我|不要|比较能专注|留一点|每天晚上/.test(item)) || firstLine;
    return concise
        .replace(/^(i want to|i need to|我要|我想|计划|安排|帮我|请帮我)/i, '')
        .replace(/^这周[一二三四五六日天]?.*?(?:要|需要)/, '')
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
    const explicit = calendarExtractExplicitDurationMinutes(text);
    if (explicit !== null) return explicit;
    return calendarCleanDurationMinutes(fallback, 60, 720);
}

function calendarExtractExplicitDurationMinutes(text) {
    const lower = String(text || '').toLowerCase();
    const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|小時)/i);
    if (hourMatch) return calendarCleanDurationMinutes(Number(hourMatch[1]) * 60, 60, 720);
    const minMatch = lower.match(/(\d+)\s*(?:m|min|mins|minute|minutes|分钟|分鐘)/i);
    if (minMatch) return calendarCleanDurationMinutes(Number(minMatch[1]), 60, 720);
    return null;
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
        if (slot === null) return;
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
    let remaining = Math.max(CALENDAR_MIN_BLOCK_MINUTES, totalMinutes);
    let count = 0;
    const today = calendarCurrentDayIndex();
    const startDay = today >= 0 ? today : 0;

    for (let day = Math.min(deadlineDay, 6); day >= startDay && remaining > 0; day--) {
        const duration = remaining <= 90
            ? remaining
            : Math.min(90, Math.max(45, Math.ceil(Math.min(remaining, 90) / 15) * 15));
        const slot = calendarFindFreeSlot(plan, day, duration, [20 * 60, 9 * 60, 14 * 60, 18 * 60 + 30]);
        if (slot === null) continue;
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
    let sleep = calendarTimeToMinutes(plan.habits?.sleep, 23 * 60 + 30);
    if (sleep <= wake) sleep = CALENDAR_DAY_MINUTES;
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
    return !calendarBlocksForDay(plan, day).some(block => {
        if (block.id === ignoreId) return false;
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

function calendarBindDragEvents() {
    const cols = document.querySelectorAll('.ta-calendar__day-col');
    cols.forEach(col => {
        col.addEventListener('mousedown', calendarOnDragStart);
    });
}

function calendarDayIndexFromCol(col) {
    const match = col.id?.match(/calendar-day-(\d+)/);
    return match ? Number(match[1]) : -1;
}

function calendarMinuteFromY(y) {
    const raw = (y / CALENDAR_SLOT_HEIGHT) * CALENDAR_SLOT_MINUTES;
    return Math.max(0, Math.min(CALENDAR_DAY_MINUTES - CALENDAR_INPUT_STEP_MINUTES, calendarRoundToInputStep(raw)));
}

function calendarOnDragStart(e) {
    if (e.target.closest('.ta-block') || e.target.closest('.ta-quick-add') || e.target.closest('.ta-block-editor') || e.target.closest('.ta-block-form')) return;
    if (e.button !== 0) return;
    const col = e.currentTarget;
    const dayIndex = calendarDayIndexFromCol(col);
    if (dayIndex < 0) return;

    const rect = col.getBoundingClientRect();
    const scrollEl = col.closest('.ta-calendar__scroll');
    const y = e.clientY - rect.top + (scrollEl ? scrollEl.scrollTop : 0);
    const startMinute = calendarMinuteFromY(y);

    calendarDragState = { dayIndex, startMinute, currentMinute: Math.min(CALENDAR_DAY_MINUTES, startMinute + 20), col };

    const preview = document.createElement('div');
    preview.className = 'ta-drag-preview';
    preview.id = 'ta-drag-preview';
    col.appendChild(preview);
    calendarUpdateDragPreview();

    document.addEventListener('mousemove', calendarOnDragMove);
    document.addEventListener('mouseup', calendarOnDragEnd);
    e.preventDefault();
}

function calendarOnDragMove(e) {
    if (!calendarDragState) return;
    const col = calendarDragState.col;
    const rect = col.getBoundingClientRect();
    const scrollEl = col.closest('.ta-calendar__scroll');
    const y = e.clientY - rect.top + (scrollEl ? scrollEl.scrollTop : 0);
    calendarDragState.currentMinute = calendarMinuteFromY(y) + CALENDAR_INPUT_STEP_MINUTES;
    calendarUpdateDragPreview();
}

function calendarUpdateDragPreview() {
    const preview = document.getElementById('ta-drag-preview');
    if (!preview || !calendarDragState) return;
    const { startMinute, currentMinute } = calendarDragState;
    const minM = Math.min(startMinute, currentMinute);
    const maxM = Math.max(startMinute, currentMinute);
    const top = (minM / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
    const height = Math.max(10, ((maxM - minM) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT);
    preview.style.top = top + 'px';
    preview.style.height = height + 'px';
    preview.textContent = `${calendarMinutesToTime(minM)} - ${calendarMinutesToTime(maxM)}`;
}

function calendarOnDragEnd(e) {
    document.removeEventListener('mousemove', calendarOnDragMove);
    document.removeEventListener('mouseup', calendarOnDragEnd);
    if (!calendarDragState) return;

    const { dayIndex, startMinute, currentMinute, col } = calendarDragState;
    const start = Math.min(startMinute, currentMinute);
    const end = Math.max(startMinute, currentMinute);
    calendarDragState = null;

    if (end - start < CALENDAR_MIN_BLOCK_MINUTES) {
        const preview = document.getElementById('ta-drag-preview');
        if (preview) preview.remove();
        return;
    }

    calendarShowQuickAdd(col, dayIndex, start, end);
}

function calendarShowQuickAdd(col, dayIndex, start, end) {
    const preview = document.getElementById('ta-drag-preview');
    if (preview) preview.remove();

    const existing = document.getElementById('ta-quick-add');
    if (existing) existing.remove();

    const top = (start / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
    const height = ((end - start) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
    const fallback = calendarCleanBlock({
        id: calendarId('block'),
        title: '',
        date: calendarDateForDay(calendarPlan.weekStart, dayIndex),
        day: dayIndex,
        start,
        end,
        category: 'deep',
        kind: 'fixed',
        repeat: { frequency: 'none', interval: 1 },
        source: 'manual',
        status: 'planned'
    });

    const form = document.createElement('div');
    form.className = 'ta-quick-add';
    form.id = 'ta-quick-add';
    form.style.top = top + 'px';
    form.style.minHeight = Math.max(height, 230) + 'px';
    form.innerHTML = `
        <div class="ta-quick-add__time">${calendarMinutesToTime(start)} - ${calendarMinutesToTime(end)}</div>
        ${calendarBlockFormHtml('ta-quick-add', fallback, `
            <button type="button" class="ta-block-form__primary" onclick="calendarQuickAddConfirm(${dayIndex},${start},${end})">创建</button>
            <button type="button" onclick="calendarQuickAddCancel()">取消</button>
        `)}
    `;
    col.appendChild(form);

    const input = document.getElementById('ta-quick-add-title');
    if (input) {
        input.focus();
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); calendarQuickAddConfirm(dayIndex, start, end); }
            if (ev.key === 'Escape') calendarQuickAddCancel();
        });
    }
}

function calendarQuickAddConfirm(dayIndex, start, end) {
    if (!calendarPlan) return;
    const fallback = {
        id: calendarId('block'),
        title: '未命名',
        date: calendarDateForDay(calendarPlan.weekStart, dayIndex),
        day: dayIndex,
        start,
        end,
        category: 'deep',
        kind: 'fixed',
        repeat: { frequency: 'none', interval: 1 },
        source: 'manual',
        status: 'planned'
    };
    const block = calendarReadBlockForm('ta-quick-add', fallback);
    calendarPlan.blocks.push(block);
    calendarSelectedBlockId = block.id;
    calendarSelectedOccurrenceDate = block.date;
    calendarEditingBlockId = block.id;
    calendarEditingOccurrenceDate = block.date;
    calendarSavePlan();
}

function calendarQuickAddCancel() {
    const form = document.getElementById('ta-quick-add');
    if (form) form.remove();
}

function calendarAddManualBlock() {
    if (!calendarPlan) return;
    const title = document.getElementById('calendar-manual-title')?.value.trim() || '手动时间块';
    const selectedDay = Number(document.getElementById('calendar-manual-day')?.value || 0);
    const date = calendarCleanDate(document.getElementById('calendar-manual-date')?.value)
        || calendarDateForDay(calendarPlan.weekStart, selectedDay);
    const day = calendarWeekdayForDate(date, selectedDay);
    const start = calendarTimeToMinutes(document.getElementById('calendar-manual-start')?.value, 20 * 60);
    const duration = calendarCleanDurationMinutes(document.getElementById('calendar-manual-duration')?.value, 60);
    const category = document.getElementById('calendar-manual-category')?.value || 'deep';
    const repeat = calendarCleanRepeat(document.getElementById('calendar-manual-repeat')?.value || 'none');
    const rawKind = calendarNormalizeTaskKind(document.getElementById('calendar-manual-kind')?.value, 'fixed');
    const kind = repeat.frequency === 'none' ? rawKind : (rawKind === 'general' ? 'routine' : rawKind);
    const userNote = document.getElementById('calendar-manual-note')?.value.trim() || '';
    let finalStart = start;
    let moveNote = '';
    if (!calendarSlotIsFree(calendarPlan, day, start, start + duration)) {
        const slot = calendarFindFreeSlot(calendarPlan, day, duration, [start + duration, start - duration, 20 * 60, 9 * 60]);
        if (slot === null) return;
        finalStart = slot;
        moveNote = '原时间重叠，已自动移到最近空档。';
    }
    calendarPlan.blocks.push(calendarCleanBlock({
        title,
        date,
        day,
        start: finalStart,
        end: finalStart + duration,
        category,
        kind,
        repeat,
        source: 'manual',
        note: [userNote, moveNote].filter(Boolean).join('\n')
    }));
    calendarSavePlan();
}

function calendarClearBlockSelection() {
    calendarSelectedBlockId = null;
    calendarSelectedOccurrenceDate = '';
    calendarEditingBlockId = null;
    calendarEditingOccurrenceDate = '';
}

function calendarSelectBlock(id, occurrenceDate = '') {
    calendarSelectedBlockId = id;
    calendarSelectedOccurrenceDate = occurrenceDate;
    calendarEditingBlockId = id;
    calendarEditingOccurrenceDate = occurrenceDate;
    calendarRender();
}

function calendarCloseBlockEditor() {
    calendarEditingBlockId = null;
    calendarEditingOccurrenceDate = '';
    calendarRender();
}

function calendarSaveBlockEditor() {
    if (!calendarPlan || !calendarEditingBlockId) return;
    const target = calendarPlan.blocks.find(item => item.id === calendarEditingBlockId);
    if (!target) {
        calendarClearBlockSelection();
        calendarRender();
        return;
    }
    const fallback = {
        ...target,
        occurrenceDate: calendarEditingOccurrenceDate || target.date || calendarDateForDay(calendarPlan.weekStart, target.day)
    };
    const updated = calendarReadBlockForm('ta-edit-block', fallback);
    calendarPlan.blocks = calendarPlan.blocks.map(block => block.id === target.id
        ? calendarCleanBlock({
            ...target,
            ...updated,
            id: target.id,
            source: target.source || updated.source || 'manual'
        })
        : block);
    calendarSelectedBlockId = target.id;
    calendarSelectedOccurrenceDate = updated.date || '';
    calendarEditingBlockId = target.id;
    calendarEditingOccurrenceDate = updated.date || '';
    calendarSavePlan();
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
    calendarClearBlockSelection();
    calendarSavePlan();
}

function calendarClearGeneratedBlocks() {
    if (!calendarPlan) return;
    calendarPlan.blocks = calendarPlan.blocks.filter(block => !String(block.source || '').startsWith('coach:') && !String(block.source || '').startsWith('system:'));
    calendarClearBlockSelection();
    calendarPlan.reflections.push(calendarCleanReflection({
        text: '清理自动安排',
        messages: ['已清理自动生成块，保留手动添加的时间块。'],
        at: new Date().toISOString()
    }));
    calendarSavePlan();
}
