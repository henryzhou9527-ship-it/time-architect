/* ══════════════════════════════════════════════════════════════════════
   Time Architect — goal-first weekly time planning cockpit.

   Single-file vanilla JS app, organized in sections:
     1. Constants & global state
     2. Auth & encryption (cloud accounts, test accounts)
     3. Generic helpers (escape, ids, API endpoints)
     4. API profile store (BYOK model configs)
     5. Date/time helpers
     6. Plan data model (clean/normalize/migrate)
     7. Conversations & drafts
     8. Plan load/save & cloud sync
     9. Shell render (sidebar / ribbon / pages)
    10. Chat panel & streaming turn (fast path, @agent, @all council)
    11. Calendar board (grid, blocks, overlap layout, drag interactions)
    12. Pages: workflow / settings / archive / profile / goals
   ══════════════════════════════════════════════════════════════════════ */

const CALENDAR_PLAN_KEY = 'calendar_plan';
const CALENDAR_PLAN_STORAGE_KEY = 'time_architect_plan_v1';
const CALENDAR_ARCHITECT_API = '/api/time-architect';
const CALENDAR_ACCOUNT_API = '/api/accounts';
const CALENDAR_ARCHITECT_CLIENT_TIMEOUT_MS = 210000;
const CALENDAR_API_CONFIG_STORAGE_KEY = 'time_architect_api_v1';
const CALENDAR_FAST_MODE_KEY = 'ta_fast_mode_v1';
const CALENDAR_DEFAULT_DIALOGUE_PROFILE_KEY = 'ta_default_dialogue_profile_v1';
const CALENDAR_SLOT_MINUTES = 15;
const CALENDAR_INPUT_STEP_MINUTES = 5;
const CALENDAR_MIN_BLOCK_MINUTES = 5;
const CALENDAR_SLOT_HEIGHT = 16;
const CALENDAR_DAY_MINUTES = 24 * 60;
const CALENDAR_WORKFLOW_PROMPT_VERSION = 5;

const CALENDAR_DEFAULT_GLOBAL_PROMPT = `你是 Time Architect，一个个人时间管理助手。用用户的语言自然地回复。

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

主动指出风险：
- 计划太满、连续深度工作无休息
- deadline 太近且工作量不够
- 深度工作被碎片化打断
- 长期目标被紧急任务持续挤占

保护用户的成长时间和健康习惯，不让它们永远被紧急事项覆盖。
尊重 profile 中的显性偏好（如"不喜欢晚上工作""健身只在周二周四"）。

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
- 目标管理：create_goal 新建、update_goal 修改、delete_goal 删除，targetId 用 [Goals] 里的 id
- 用户画像可用 update_profile 更新（如睡眠窗口、每周可用小时）

## 上下文
系统自动附带 [Profile]、[Blocks]、[Goals]、[Free slots] 等当前日历状态，直接引用即可。`;

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

let calendarPlan = null;
let calendarSelectedBlockId = null;
let calendarSelectedOccurrenceDate = '';
let calendarEditingBlockId = null;
let calendarEditingOccurrenceDate = '';
let calendarDraftText = '';
let calendarSyncStatus = '';
let calendarApiStatus = 'API-only：等待在线模型。';
let calendarEditingApiProfile = false;
let calendarCurrentPage = 'calendar';
let calendarLastRenderedPage = '';
let calendarChatOpen = !(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches);
let calendarClockInterval = null;
let calendarFirstRender = true;
let calendarArchiveFilter = 'all';
let calendarExpandedArchiveId = null;
let calendarEditingMemoryId = null;
let calendarDragState = null;
let calendarBlockDrag = null;
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

function calendarNormalizeUsername(value) {
    const user = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_-]{3,40}$/.test(user) ? user : '';
}

function calendarIsAuthMeta(auth) {
    return auth
        && typeof auth === 'object'
        && typeof auth.username === 'string'
        && calendarNormalizeUsername(auth.username)
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
        return { ...auth, username: calendarNormalizeUsername(auth.username), cloud: auth.cloud === true };
    } catch { return null; }
}

function calendarSaveAuth(meta) {
    const username = calendarNormalizeUsername(meta?.username);
    if (!username) throw new Error('用户名只能使用 3-40 位小写字母、数字、下划线或连字符');
    localStorage.setItem(CALENDAR_AUTH_KEY, JSON.stringify({
        ...meta,
        username,
        cloud: meta?.cloud === true,
        savedAt: new Date().toISOString()
    }));
}


function calendarIsCloudAuth(auth = calendarLoadAuth()) {
    return !!auth?.cloud;
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

async function calendarAccountRequest(action, payload) {
    const res = await fetch(calendarAccountsApi(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = new Error(data.error || '账号服务暂不可用');
        error.status = res.status;
        throw error;
    }
    return data;
}

async function calendarFetchAccount(username) {
    const user = calendarNormalizeUsername(username);
    const res = await fetch(`${calendarAccountsApi()}?username=${encodeURIComponent(user)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = new Error(data.error || '账号不存在');
        error.status = res.status;
        throw error;
    }
    return data.account || null;
}

async function calendarStoreSessionKey(key) {
    const rawBytes = await crypto.subtle.exportKey('raw', key);
    sessionStorage.setItem(CALENDAR_SESSION_KEY, calendarB64Enc(rawBytes));
}

async function calendarLoadLocalApiForKey(key) {
    try {
        const encApi = JSON.parse(localStorage.getItem(CALENDAR_ENC_API_KEY));
        return encApi ? calendarCleanApiStore(await calendarDecrypt(key, encApi)) : calendarDefaultApiStore();
    } catch {
        return calendarDefaultApiStore();
    }
}

function calendarAccountErrorMessage(error, action = '登录') {
    const raw = String(error?.message || error || '');
    if (error?.status === 409 || /already exists/i.test(raw)) return '这个用户名已经被注册，请直接登录或换一个用户名。';
    if (error?.status === 404 || /not found/i.test(raw)) return '云端没有这个账号，请先创建账号。';
    if (error?.status === 401 || /incorrect|invalid login/i.test(raw)) return '用户名或密码不对。';
    if (error?.status === 503 || /not configured|unavailable|Failed to fetch/i.test(raw)) return '账号服务暂不可用，请确认线上环境已配置存储。';
    return `${action}失败：${raw}`;
}

async function calendarRegister(username, password) {
    const user = calendarNormalizeUsername(username);
    if (!user) throw new Error('用户名只能使用 3-40 位小写字母、数字、下划线或连字符');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await calendarDeriveKey(password, salt);
    const saltText = calendarB64Enc(salt);
    const verifier = await calendarCreateVerifier(key);

    await calendarAccountRequest('register', { username: user, salt: saltText, verifier });
    calendarSaveAuth({ username: user, salt: saltText, verifier, cloud: true });
    calendarEncKey = key;
    calendarAuthUser = user;

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

    await calendarStoreSessionKey(key);
    calendarApiStoreCache = apiToSave;
    return { ok: true };
}

async function calendarLogin(username, password) {
    const user = calendarNormalizeUsername(username);
    if (!user) return { ok: false, error: '请输入 3-40 位用户名' };

    try {
        const account = await calendarFetchAccount(user);
        const salt = new Uint8Array(calendarB64Dec(account.salt));
        const key = await calendarDeriveKey(password, salt);
        const verifier = await calendarCreateVerifier(key);
        await calendarAccountRequest('login', { username: user, verifier });

        calendarSaveAuth({ username: user, salt: account.salt, verifier, cloud: true });
        calendarEncKey = key;
        calendarAuthUser = user;
        await calendarStoreSessionKey(key);
        calendarApiStoreCache = await calendarLoadLocalApiForKey(key);
        return { ok: true };
    } catch (error) {
        const local = calendarLoadAuth();
        const canUseLocalFallback = local?.username === user
            && (!calendarIsCloudAuth(local) || error?.status === 503 || !error?.status);
        if (canUseLocalFallback) {
            try {
                const salt = new Uint8Array(calendarB64Dec(local.salt));
                const key = await calendarDeriveKey(password, salt);
                const verifier = await calendarCreateVerifier(key);
                if (verifier === local.verifier) {
                    calendarEncKey = key;
                    calendarAuthUser = local.username;
                    await calendarStoreSessionKey(key);
                    calendarApiStoreCache = await calendarLoadLocalApiForKey(key);
                    return { ok: true, warning: calendarIsCloudAuth(local) ? '账号服务暂不可用，已进入本机缓存。' : '已进入旧本机账户；注册同名云账号后才能跨设备同步。' };
                }
            } catch {}
        }
        return { ok: false, error: calendarAccountErrorMessage(error) };
    }
}

function calendarLogout() {
    calendarCleanup();
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
        ? '<p class="ta-auth__migrate-note">已发现本机旧计划和 API 配置。创建云账号后，会先用新密码保护这些本机数据。</p>'
        : (hasProtectedData && !hasAccount ? '<p class="ta-auth__migrate-note">已发现旧的加密数据，但缺少账号信息。登录云账号后会以云端日历为准。</p>' : '');
    const loginNote = hasAccount
        ? `<p class="ta-auth__migrate-note">本机记住了「${calendarEsc(username)}」。你也可以输入另一个云账号登录。</p>`
        : '<p class="ta-auth__migrate-note">新设备直接输入云账号和密码即可同步日历。</p>';

    if (mode === 'register') {
        return `<div class="ta-auth">
            <div class="ta-auth__card">
                <div class="ta-auth__logo">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span class="ta-auth__brand">Time Architect</span>
                </div>
                <h2 class="ta-auth__title">创建云账号</h2>
                <p class="ta-auth__subtitle">像游戏账号一样，换设备后用同一用户名和密码登录</p>
                ${registerNote}
                <div class="ta-auth__error" id="ta-auth-error" role="alert" aria-live="polite"></div>
                <div class="ta-auth__field">
                    <label for="ta-auth-username">用户名</label>
                    <input id="ta-auth-username" type="text" class="ta-auth__input" value="${calendarEsc(username)}" placeholder="3-40 位小写字母/数字" autocomplete="username">
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
                <div class="ta-auth__footer">
                    <button type="button" class="ta-auth__link" onclick="calendarRenderAuthScreen('login')">已有账号，去登录</button>
                    <button type="button" class="ta-auth__link" onclick="calendarHandleResetAccount()">清除本机缓存</button>
                </div>
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
            <h2 class="ta-auth__title">登录账号</h2>
            <p class="ta-auth__subtitle">登录后自动同步这个账号的日历</p>
            ${loginNote}
            <div class="ta-auth__error" id="ta-auth-error" role="alert" aria-live="polite"></div>
            <div class="ta-auth__field">
                <label for="ta-auth-username">用户名</label>
                <input id="ta-auth-username" type="text" class="ta-auth__input" value="${calendarEsc(username)}" placeholder="输入云账号用户名" autocomplete="username">
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
                <button type="button" class="ta-auth__link" onclick="calendarSwitchToRegister()">没有账号？创建</button>
                <button type="button" class="ta-auth__link" onclick="calendarHandleResetAccount()">清除本机缓存</button>
            </div>
            ${testAccounts}
        </div>
    </div>`;
}

function calendarRenderAuthScreen(forceMode) {
    const root = document.getElementById('ta-root') || document.getElementById('world-content');
    if (!root) return;
    const mode = forceMode === 'register' ? 'register' : 'login';
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
    const username = calendarNormalizeUsername(document.getElementById('ta-auth-username')?.value || '');
    const password = document.getElementById('ta-auth-password')?.value || '';
    const confirm = document.getElementById('ta-auth-confirm')?.value || '';

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
        calendarSetAuthError(calendarAccountErrorMessage(e, '注册'));
        btn.textContent = '创建账户';
        btn.disabled = false;
    }
}

async function calendarHandleLogin() {
    const errEl = document.getElementById('ta-auth-error');
    const username = calendarNormalizeUsername(document.getElementById('ta-auth-username')?.value || '');
    const password = document.getElementById('ta-auth-password')?.value || '';

    if (!username) { calendarSetAuthError('请输入用户名', 'ta-auth-username'); return; }
    if (!password) { calendarSetAuthError('请输入密码', 'ta-auth-password'); return; }

    const btn = document.getElementById('ta-auth-submit');
    btn.textContent = '验证中...';
    btn.disabled = true;
    if (errEl) errEl.textContent = '';

    try {
        const result = await calendarLogin(username, password);
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
    const accountName = auth?.username ? `「${auth.username}」` : '当前设备';
    if (!confirm(`这只会清除 ${accountName} 的本机缓存和本机加密数据，不会删除云账号或云端日历。\n\n确定要清除吗？`)) return;
    calendarClearLocalAccountData();
    calendarRenderAuthScreen();
}

function calendarSwitchToRegister() {
    calendarRenderAuthScreen('register');
}

async function calendarPostAuth() {
    const root = document.getElementById('ta-root') || document.getElementById('world-content');
    const loadingLabel = calendarIsTestSession() ? '正在载入测试账号...' : '正在解密数据...';
    root.innerHTML = `<div class="ta-shell"><div class="ta-loading">${loadingLabel}</div></div>`;
    await calendarLoadPlan();
    await calendarRefreshServerApiProfiles(false);
    calendarRender();
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

function calendarAccountsApi() {
    return typeof SHARED_ACCOUNTS_API !== 'undefined' ? SHARED_ACCOUNTS_API : CALENDAR_ACCOUNT_API;
}

function calendarCurrentAuthForCloud() {
    const auth = calendarLoadAuth();
    const current = calendarNormalizeUsername(calendarCurrentUsername());
    if (!auth || !current || auth.username !== current || !calendarIsCloudAuth(auth)) return null;
    return auth;
}

function calendarCloudAuthHeaders() {
    const auth = calendarCurrentAuthForCloud();
    if (!auth?.verifier) return {};
    return {
        'X-Time-Architect-User': auth.username,
        'X-Time-Architect-Proof': auth.verifier
    };
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
    const first = calendarDefaultApiConfig();
    return {
        activeId: first.id,
        profiles: [first]
    };
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
    calendarRender();
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


function calendarApiProfileIsReady(profile) {
    return Boolean(profile?.apiKey || profile?.server);
}

function calendarApiProfilesMatch(a, b) {
    const leftModel = String(a?.model || '').trim().toLowerCase();
    const rightModel = String(b?.model || '').trim().toLowerCase();
    const leftName = String(a?.name || '').trim().toLowerCase();
    const rightName = String(b?.name || '').trim().toLowerCase();
    if (leftModel && rightModel && leftModel === rightModel) return true;
    if (leftName && rightName && leftName === rightName) return true;
    return false;
}

function calendarApiProfileForAgent(agent, store = calendarLoadApiStore()) {
    const profiles = store?.profiles || [];
    const boundId = String(agent?.apiProfileId || '').trim();
    const bound = boundId && profiles.find(profile => profile.id === boundId);
    if (bound) return bound;
    const modelId = String(agent?.modelId || '').trim().toLowerCase();
    const configName = String(agent?.configName || '').trim().toLowerCase();
    const exact = profiles.find(profile => {
        const model = String(profile.model || '').trim().toLowerCase();
        const name = String(profile.name || '').trim().toLowerCase();
        return (modelId && model === modelId) || (configName && name === configName);
    });
    if (exact) return exact;
    return profiles.find(calendarApiProfileIsReady)
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
    const auth = calendarCurrentAuthForCloud();
    return !!auth?.username && !!auth?.verifier;
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
        agents: [],
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
        : [];
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
        apiProfileId: String(source.apiProfileId || '').trim().slice(0, 80),
        job: String(source.job || '').trim().slice(0, 200)
    };
}

function calendarGetAgents() {
    if (Array.isArray(calendarPlan?.agents)) return calendarPlan.agents.map(a => ({ ...a }));
    return [];
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

function calendarCompareGoalShape(goal) {
    return JSON.stringify({
        title: goal.title,
        deadline: goal.deadline,
        successCriteria: goal.successCriteria,
        weeklyTarget: goal.weeklyTarget,
        dailyMinimum: goal.dailyMinimum,
        priority: goal.priority,
        status: goal.status,
        estimatedWorkload: goal.estimatedWorkload,
        notes: goal.notes
    });
}

function calendarDraftPlanStats(draft = calendarActiveConversation?.proposedPlan) {
    if (!draft) return null;
    const cleanDraft = calendarCleanPlan(draft);
    const baseClean = calendarCleanPlan(calendarPlan);
    const baseBlocks = new Map((baseClean.blocks || []).map(block => [block.id, block]));
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

    const baseGoals = new Map((baseClean.goals || []).map(goal => [goal.id, goal]));
    const draftGoals = new Map((cleanDraft.goals || []).map(goal => [goal.id, goal]));
    let goalsAdded = 0;
    let goalsChanged = 0;
    draftGoals.forEach((goal, id) => {
        const base = baseGoals.get(id);
        if (!base) goalsAdded += 1;
        else if (calendarCompareGoalShape(base) !== calendarCompareGoalShape(goal)) goalsChanged += 1;
    });
    let goalsRemoved = 0;
    baseGoals.forEach((_, id) => {
        if (!draftGoals.has(id)) goalsRemoved += 1;
    });

    const profileChanged = JSON.stringify(calendarCleanProfile(cleanDraft.profile))
        !== JSON.stringify(calendarCleanProfile(baseClean.profile));

    return {
        added,
        changed,
        removed,
        goalsAdded,
        goalsChanged,
        goalsRemoved,
        profileChanged,
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


function calendarAgentMentionAliases(agent) {
    const key = String(agent?.key || '').toLowerCase();
    const label = String(agent?.label || '').toLowerCase();
    const model = String(agent?.modelId || agent?.model || '').toLowerCase();
    return [key, label, model].filter(Boolean);
}

function calendarAgentMentioned(note, agent) {
    const text = String(note || '').toLowerCase();
    return calendarAgentMentionAliases(agent).some(alias => alias && text.includes(`@${alias}`));
}

function calendarAllAgentsMentioned(note) {
    return /@all\b|@agents\b|@全体|@所有|@全部|@全模型|@会诊|(^|\s)\/council\b|会诊|全模型|所有\s*agent|全部\s*agent/i.test(String(note || ''));
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
        const res = await fetch(`${calendarSettingsApi()}?key=${encodeURIComponent(CALENDAR_PLAN_KEY)}&user=${user}`, {
            cache: 'no-store',
            headers: calendarCloudAuthHeaders()
        });
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
        if (res.status === 401) calendarSyncStatus = '云账号登录失效，请重新登录后再同步。';
        else if (res.status === 404) calendarSyncStatus = '云端同步接口未部署，正在使用本机计划。';
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
                headers: { 'Content-Type': 'application/json', ...calendarCloudAuthHeaders() },
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
        calendarStartClock();
    } else {
        calendarRenderAuthScreen();
    }
}

function calendarCleanup() {
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
            ${calendarMobileNavHtml()}
        </div>
    `;

    calendarFirstRender = false;
    calendarScrollToWorkingHours();
    calendarScrollChatToBottom();
    calendarBindDragEvents();
}

function calendarIsMobile() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
}

function calendarSetPage(page) {
    calendarCurrentPage = page;
    if (calendarIsMobile()) {
        calendarChatOpen = false;
    } else if (page === 'settings' || page === 'workflow' || page === 'archive' || page === 'profile') {
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



function calendarScrollChatToBottom() {
    const el = document.getElementById('ta-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
}

function calendarMobileNavHtml() {
    const items = [
        { key: 'calendar', label: '日历', icon: 'M8 5h11M8 12h11M8 19h11M4 5h.01M4 12h.01M4 19h.01' },
        { key: 'workflow', label: 'Flow', icon: 'M12 3v3M12 18v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M3 12h3M18 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 100 8 4 4 0 000-8z' },
        { key: 'archive', label: '日志', icon: 'M8 3v4M16 3v4M4 9h16M6 5h12a2 2 0 012 2v12H4V7a2 2 0 012-2z' },
        { key: 'settings', label: '设置', icon: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z' }
    ];
    return `
        <nav class="ta-mobile-nav" aria-label="底部导航">
            ${items.map(item => `
                <button type="button" class="ta-mobile-nav__item${calendarCurrentPage === item.key && !calendarChatOpen ? ' ta-mobile-nav__item--active' : ''}" onclick="calendarSetPage('${item.key}')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${item.icon}"/></svg>
                    <span>${calendarEsc(item.label)}</span>
                </button>
            `).join('')}
            <button type="button" class="ta-mobile-nav__item ta-mobile-nav__item--ai${calendarChatOpen ? ' ta-mobile-nav__item--active' : ''}" onclick="calendarToggleChat()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                <span>AI</span>
            </button>
        </nav>
    `;
}

function calendarSidebarHtml() {
    const navItems = [
        { key: 'calendar', icon: 'M8 5h11M8 12h11M8 19h11M4 5h.01M4 12h.01M4 19h.01', label: 'Timeline' },
        { key: 'workflow', icon: 'M12 3v3M12 18v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M3 12h3M18 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 100 8 4 4 0 000-8z', label: 'Flow' },
        { key: 'archive', icon: 'M8 3v4M16 3v4M4 9h16M6 5h12a2 2 0 012 2v12H4V7a2 2 0 012-2z', label: 'Journal' },
        { key: 'profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM5 21a7 7 0 0114 0', label: 'Account' },
        { key: 'settings', icon: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M19.4 15a1.7 1.7 0 00.34 1.88l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 1.55V21a2 2 0 01-4 0v-.05a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.88.34l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.55-1H3a2 2 0 010-4h.05A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.88l-.06-.06a2 2 0 012.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001-1.55V3a2 2 0 014 0v.05a1.7 1.7 0 001 1.55 1.7 1.7 0 001.88-.34l.06-.06a2 2 0 012.83 2.83l-.06.06A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.55 1H21a2 2 0 010 4h-.05A1.7 1.7 0 0019.4 15z', label: 'Settings' },
    ];
    const profileName = calendarAuthUser || calendarPlan?.profile?.name || 'User';
    const profileRole = calendarIsTestSession() ? '测试账户 · 本机隔离' : (calendarCanSync() ? '云账号 · 已登录' : '本机缓存');
    return `
        <nav class="ta-sidebar">
            <div class="ta-sidebar__logo">
                <div class="ta-sidebar__logo-icon">
                    <svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true">
                        <circle cx="19" cy="19" r="4" fill="#FF6B1A"/>
                        <circle cx="19" cy="8" r="5" fill="#FF7A1A"/>
                        <circle cx="28.5" cy="13.5" r="5" fill="#FF8A00"/>
                        <circle cx="28.5" cy="24.5" r="5" fill="#FF5A1F"/>
                        <circle cx="19" cy="30" r="5" fill="#FF7A1A"/>
                        <circle cx="9.5" cy="24.5" r="5" fill="#FF8A00"/>
                        <circle cx="9.5" cy="13.5" r="5" fill="#FF5A1F"/>
                    </svg>
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
                    <span class="ta-ribbon__info-icon" aria-hidden="true">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>
                    </span>
                    ${calendarEsc(dateStr)}
                </span>
                <span class="ta-ribbon__info">
                    <span class="ta-ribbon__info-icon" aria-hidden="true">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>
                    </span>
                    <span id="ta-ribbon-time">${calendarEsc(timeStr)}</span>
                </span>
                <span class="ta-ribbon__progress">
                    <span class="ta-ribbon__progress-dot"></span>
                    任务完成情况 ${pct}%
                </span>
                ${calendarPreviewDraft ? '<span class="ta-ribbon__draft">草案预览中</span>' : ''}
            </div>
            <div class="ta-ribbon__right">
                <div class="ta-ribbon__mobile-account" aria-label="当前账户" onclick="calendarSetPage('profile')">
                    <span class="ta-ribbon__mobile-avatar">${calendarEsc(profileName.charAt(0).toUpperCase())}</span>
                    <span class="ta-ribbon__mobile-name">${calendarEsc(profileName)}</span>
                    ${isTest ? '<span class="ta-ribbon__test-badge">TEST</span>' : ''}
                    <button class="ta-ribbon__mobile-logout" onclick="event.stopPropagation();calendarLogout()" title="退出登录" aria-label="退出登录">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    </button>
                </div>
                <button class="ta-ribbon__btn" onclick="calendarSavePlan()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    Save
                </button>
                <button class="ta-ribbon__btn ta-ribbon__btn--primary" onclick="calendarShowAddForm()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                    Add
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


function calendarDraftSummaryText(stats) {
    if (!stats) return '有未应用草案';
    const goalBits = [
        stats.goalsAdded ? `+${stats.goalsAdded}` : '',
        stats.goalsChanged ? `~${stats.goalsChanged}` : '',
        stats.goalsRemoved ? `-${stats.goalsRemoved}` : ''
    ].filter(Boolean).join(' ');
    const parts = [
        stats.added ? `新增 ${stats.added}` : '',
        stats.changed ? `修改 ${stats.changed}` : '',
        stats.removed ? `删除 ${stats.removed}` : '',
        goalBits ? `目标 ${goalBits}` : '',
        stats.profileChanged ? '资料更新' : ''
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


function calendarStartAgentThinking(label) {
    calendarAgentTurnRunning = true;
    calendarAgentTurnStartedAt = Date.now();
    calendarAgentTurnLabel = label || 'Agent 正在回复';
    if (calendarAgentTurnTick) clearInterval(calendarAgentTurnTick);
    calendarAgentTurnTick = setInterval(calendarUpdateTurnStatusText, 1000);
}

function calendarUpdateTurnStatusText() {
    if (!calendarAgentTurnRunning || !calendarAgentTurnStartedAt) return;
    const el = document.querySelector('.ta-chat__header-status');
    if (!el) return;
    const secs = Math.round((Date.now() - calendarAgentTurnStartedAt) / 1000);
    el.textContent = `${calendarAgentTurnLabel} · ${secs}s`;
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
        ? `${calendarAgentTurnLabel || 'Streaming'}...`
        : activeProfile.name;
    const canArchive = conversation.entries.length && !calendarAgentTurnRunning;
    const chatModelOptions = apiStore.profiles.map(p =>
        `<option value="${calendarEsc(p.id)}"${p.id === apiStore.activeId ? ' selected' : ''}>${calendarEsc(p.name)}</option>`
    ).join('');
    const agents = calendarConfiguredAgents();
    const agentChipsHtml = agents.map(a =>
        `<button type="button" class="ta-chat__agent-chip" onclick="calendarInsertAgentMention('${calendarEsc(a.label)}')" title="@${calendarEsc(a.label)}">@${calendarEsc(a.label)}</button>`
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
                <button type="button" class="ta-chat__fast-toggle${calendarFastMode ? ' ta-chat__fast-toggle--on' : ''}"
                    onclick="calendarToggleFastMode()" title="${calendarFastMode ? 'Fast mode ON：简单日历请求本地处理' : 'Fast mode OFF：全部走 API'}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>${calendarFastMode ? ' Fast' : ''}
                </button>
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
                    ${conversation.entries.length ? conversation.entries.map(entry => calendarChatEntryHtml(entry)).join('') : calendarChatWelcomeHtml()}
                </div>
                <div class="ta-chat__agent-chips">${agentChipsHtml}</div>
                <div class="ta-chat__input-area">
                    <div class="ta-chat__input-wrap">
                        <textarea id="ta-chat-input" class="ta-chat__input" placeholder="输入消息，或 @agent..." rows="1"
                            ${calendarAgentTurnRunning ? 'disabled' : ''}
                            oninput="calendarDraftText=this.value; this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,80)+'px'; calendarHandleAtAutocomplete(this)"
                            onkeydown="calendarHandleAutocompleteKey(event) || (event.key==='Enter'&&!event.shiftKey&&(event.preventDefault(),calendarSendChatMessage()))">${calendarEsc(calendarDraftText)}</textarea>
                        <div class="ta-chat__autocomplete" id="ta-chat-autocomplete"></div>
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

function calendarChatWelcomeHtml() {
    const samples = [
        '明天 14:00 写周报 60min',
        '下周三 10:00-11:30 项目评审',
        '帮我规划这周的雅思备考，每天至少 1 小时'
    ];
    return `
        <div class="ta-chat__welcome">
            <strong>你好，我是你的时间助理</strong>
            <span>一句话就能排进日历，试试：</span>
            ${samples.map(s => `<button type="button" onclick="calendarFillChatInput('${calendarEsc(s)}')">${calendarEsc(s)}</button>`).join('')}
            <small>Fast 亮起时简单请求本地秒建；复杂请求自动走模型。@agent 指定模型，@all 发起多 Agent 会诊。日历修改都先生成草案，确认后才写入。</small>
        </div>
    `;
}

function calendarFillChatInput(text) {
    const input = document.getElementById('ta-chat-input');
    if (!input) return;
    input.value = text;
    calendarDraftText = text;
    input.focus();
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

function calendarRecentMessages(limit) {
    const conversation = calendarActiveConversation || {};
    const entries = (Array.isArray(conversation.entries) ? conversation.entries : []).filter(entry => !entry.streaming);
    const messages = [];
    const recent = entries.slice(-(limit || 10));
    for (const entry of recent) {
        if (entry.role === 'user') {
            messages.push({ role: 'user', content: entry.text || '' });
        } else if (entry.role === 'agent' && entry.text) {
            const speaker = entry.agentLabel && entry.agentLabel !== 'Fast' ? `[${entry.agentLabel}] ` : '';
            messages.push({ role: 'assistant', content: speaker + entry.text });
        }
    }
    return messages;
}

function calendarLocalNowString() {
    const now = new Date();
    return `${calendarFormatDate(now)}T${calendarPad(now.getHours())}:${calendarPad(now.getMinutes())}`;
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
            case 'update_goal': {
                const goal = draft.goals.find(g => g.id === args.targetId);
                if (goal) {
                    const { targetId, ...updates } = args;
                    Object.assign(goal, updates);
                }
                break;
            }
            case 'delete_goal': {
                draft.goals = draft.goals.filter(g => g.id !== args.targetId);
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
        update_goal: { icon: '~', label: 'Goal', cls: 'update' },
        delete_goal: { icon: '-', label: 'Goal', cls: 'delete' },
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
    } else if (tc.name === 'update_goal') {
        detail = [args.targetId, ...Object.keys(args).filter(k => k !== 'targetId')].join(' | ');
    } else if (tc.name === 'delete_goal') {
        detail = args.targetId || '';
        if (args.reason) detail += ` (${args.reason})`;
    } else if (tc.name === 'update_profile') {
        detail = Object.keys(args).join(', ');
    } else if (tc.name === 'propose_memory') {
        detail = args.content || args.key || '';
    }
    return `<div class="ta-chat__tool-card ta-chat__tool-card--${calendarEsc(op.cls)}">${calendarEsc(op.icon)} ${calendarEsc(op.label)}: ${calendarEsc(detail)}</div>`;
}

function calendarInsertAgentMention(label) {
    const input = document.getElementById('ta-chat-input');
    if (!input) return;
    const val = input.value;
    const pos = input.selectionStart || val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const atIdx = before.lastIndexOf('@');
    const prefix = atIdx >= 0 ? before.slice(0, atIdx) : before;
    input.value = prefix + '@' + label + ' ' + after;
    calendarDraftText = input.value;
    const newPos = prefix.length + label.length + 2;
    input.setSelectionRange(newPos, newPos);
    input.focus();
    calendarHideAutocomplete();
}

function calendarHandleAtAutocomplete(textarea) {
    const val = textarea.value;
    const pos = textarea.selectionStart || val.length;
    const before = val.slice(0, pos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0 || (atIdx > 0 && /\S/.test(before[atIdx - 1]))) {
        calendarHideAutocomplete();
        return;
    }
    const partial = before.slice(atIdx + 1).toLowerCase();
    if (/\s/.test(partial)) {
        calendarHideAutocomplete();
        return;
    }
    const agents = calendarConfiguredAgents();
    const matches = agents.filter(a => {
        const aliases = calendarAgentMentionAliases(a);
        return aliases.some(alias => alias && alias.startsWith(partial));
    });
    if (!matches.length) {
        calendarHideAutocomplete();
        return;
    }
    const el = document.getElementById('ta-chat-autocomplete');
    if (!el) return;
    el.innerHTML = matches.map(a =>
        `<button type="button" class="ta-chat__autocomplete-item" onmousedown="event.preventDefault();calendarInsertAgentMention('${calendarEsc(a.label)}')">
            <strong>@${calendarEsc(a.label)}</strong>
            <span>${calendarEsc(a.configName || a.modelId || a.key)}</span>
        </button>`
    ).join('');
    el.style.display = 'block';
}

function calendarHideAutocomplete() {
    const el = document.getElementById('ta-chat-autocomplete');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

function calendarHandleAutocompleteKey(event) {
    const el = document.getElementById('ta-chat-autocomplete');
    if (!el || el.style.display === 'none' || !el.children.length) return false;
    if (event.key === 'Escape') {
        event.preventDefault();
        calendarHideAutocomplete();
        return true;
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        const first = el.querySelector('.ta-chat__autocomplete-item');
        if (first) {
            event.preventDefault();
            first.click();
            return true;
        }
    }
    return false;
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

async function calendarStreamChatRequest(note, profile, roleHint, originalNote = '') {
    const plan = calendarPlan || {};
    const conversation = calendarRecentMessages(11);
    const last = conversation[conversation.length - 1];
    if (last && last.role === 'user' && (last.content.trim() === String(originalNote || note).trim() || last.content.trim() === note.trim())) {
        conversation.pop();
    }

    const clientConfigs = calendarClientConfigsForProfile(profile);
    const requestBody = {
        stream: true,
        message: note,
        clientNow: calendarLocalNowString(),
        plan: { ...plan, blocks: calendarContextBlocks(plan), archives: undefined, reflections: undefined, memories: undefined },
        conversation: conversation.slice(-10),
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
    return !!(stats && (stats.added || stats.changed || stats.removed
        || stats.goalsAdded || stats.goalsChanged || stats.goalsRemoved
        || stats.profileChanged));
}

// Send the most relevant blocks to the model: recurring blocks always matter,
// dated blocks from 7 days ago onward, sorted by date, capped at 40.
function calendarContextBlocks(plan = calendarPlan) {
    const blocks = Array.isArray(plan?.blocks) ? plan.blocks : [];
    const cutoff = calendarDatePlus(calendarFormatDate(new Date()), -7);
    const relevant = blocks.filter(block => {
        const repeat = calendarCleanRepeat(block.repeat);
        if (repeat.frequency !== 'none') return !repeat.until || repeat.until >= cutoff;
        const anchor = calendarBlockAnchorDate(block, plan);
        return !anchor || anchor >= cutoff;
    });
    relevant.sort((a, b) => calendarBlockAnchorDate(a, plan).localeCompare(calendarBlockAnchorDate(b, plan)));
    return relevant.slice(0, 40);
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
        await calendarRunCouncilTurn(note, cleanNote);
        return;
    }

    const hasMention = calendarConfiguredAgents().some(a => calendarAgentMentioned(note, a));

    // --- Fast Path: manual toggle, simple calendar input, no @ mention ---
    if (calendarFastMode && !hasMention) {
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
                    text: '已生成草案预览。满意后点“应用并存档”，不满意可继续对话调整或点“丢弃”。'
                });
                calendarRender();
                return;
            }
        }
    }

    // --- Single-agent streaming path ---
    const { profile, roleHint, agentLabel, agentModel } = calendarResolveStreamConfig(note);
    const displayLabel = agentLabel || profile.name || profile.model || 'AI';
    calendarStartAgentThinking(`${displayLabel} 正在回复`);
    calendarApiStatus = `Streaming: ${displayLabel}...`;
    calendarRender();

    const result = await calendarStreamOneAgentTurn(cleanNote, profile, roleHint, agentLabel, agentModel, note);
    calendarStopAgentThinking();

    if (result.aborted) {
        calendarApiStatus = '已停止';
    } else if (result.errored) {
        calendarApiStatus = '对话失败';
    } else {
        calendarBuildDraftFromToolCalls(result.toolCalls);
        calendarApiStatus = `${displayLabel} 完成`;
    }
}

// Streams one agent reply into the conversation; returns collected tool calls.
// Shared by the single-agent path and council mode.
async function calendarStreamOneAgentTurn(message, profile, roleHint, agentLabel, agentModel, originalNote) {
    const streamEntry = calendarConversationAddEntry({
        role: 'agent',
        agentLabel: agentLabel || '',
        agentModel: agentModel || profile.model || '',
        text: '',
        toolCalls: [],
        streaming: true
    });
    const result = { toolCalls: [], aborted: false, errored: false };

    try {
        const { reader, controller } = await calendarStreamChatRequest(message, profile, roleHint, originalNote);
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
                        result.errored = true;
                        calendarUpdateStreamingBubble(streamEntry);
                    }
                }
            }
        }

        streamEntry.streaming = false;
        result.toolCalls = collectedToolCalls;
    } catch (error) {
        streamEntry.streaming = false;
        const isAbort = error?.name === 'AbortError';
        result.aborted = isAbort;
        result.errored = !isAbort;
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
    } finally {
        calendarActiveStreamController = null;
    }

    return result;
}

// Validated calendar tool calls → draft preview. Returns true if a draft was created.
function calendarBuildDraftFromToolCalls(toolCalls) {
    const conversation = calendarEnsureAgentConversation();
    const calendarToolCalls = (toolCalls || []).filter(tc =>
        tc.valid && tc.name !== 'respond_text' && tc.name !== 'propose_memory'
    );
    if (!calendarToolCalls.length) return false;
    const draft = calendarApplyToolCallsToPlan(calendarToolCalls, calendarPlan);
    if (!calendarDraftHasMeaningfulChanges(draft)) return false;
    conversation.proposedPlan = draft;
    calendarPreviewDraft = true;
    calendarCurrentPage = 'calendar';
    calendarChatOpen = true;
    calendarConversationAddEntry({
        role: 'system',
        text: '已生成草案预览。满意后点“应用并存档”，不满意可继续对话调整或点“丢弃”。'
    });
    return true;
}

// Council mode (@all): every configured agent speaks in turn, sees earlier
// speakers via conversation history, and all tool calls merge into one draft.
async function calendarRunCouncilTurn(note, cleanNote) {
    const agents = calendarConfiguredAgents();
    if (!agents.length) {
        calendarConversationAddEntry({
            role: 'system',
            text: '会诊模式需要至少一个 Agent。先到 Flow 页用「+ 添加 Agent」创建（名称 + 模型 + 专属 prompt），再 @all 发起会诊。'
        });
        calendarRender();
        return;
    }

    const store = calendarLoadApiStore();
    const prompts = calendarNormalizeWorkflowPrompts(calendarPlan?.workflowPrompts);
    calendarConversationAddEntry({
        role: 'system',
        text: `会诊开始：${agents.map(a => a.label).join(' → ')} 依次发言，全部工具调用会合并成一份草案。`
    });

    const allToolCalls = [];
    let stopped = false;
    for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const profile = calendarApiProfileForAgent(agent, store);
        const councilHint = `[会诊] 你是第 ${i + 1}/${agents.length} 位发言的 Agent「${agent.label}」。之前 Agent 的发言在对话历史里（以 [名字] 开头）。请独立判断，可以补充或反驳；需要修改日历就直接调用工具，最终草案会合并所有 Agent 的工具调用，避免与前面重复创建相同事件。`;
        const roleHint = [prompts.globalPrompt, prompts.agents[agent.key] || '', councilHint]
            .filter(Boolean).join('\n\n');

        calendarStartAgentThinking(`会诊 ${i + 1}/${agents.length} · ${agent.label} 正在回复`);
        calendarApiStatus = `会诊 ${i + 1}/${agents.length}：${agent.label}`;
        calendarRender();

        const result = await calendarStreamOneAgentTurn(
            cleanNote, profile, roleHint,
            agent.label, profile?.model || agent.modelId || '', note
        );
        allToolCalls.push(...result.toolCalls);
        if (result.aborted) {
            stopped = true;
            calendarConversationAddEntry({ role: 'system', text: `会诊在 ${agent.label} 处被停止，后续 Agent 未执行。` });
            break;
        }
    }

    calendarStopAgentThinking();
    const made = calendarBuildDraftFromToolCalls(allToolCalls);
    calendarApiStatus = stopped ? '会诊已停止' : (made ? '会诊完成，合并草案已生成。' : '会诊完成。');
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



















function calendarScrollToWorkingHours() {
    const scroller = document.getElementById('calendar-board-scroll');
    if (!scroller || scroller.dataset.scrolled) return;
    scroller.dataset.scrolled = '1';
    scroller.scrollTop = Math.max(0, (7 * 60 / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT - 24);
}

function calendarBoardHtml() {
    const hourHeight = (60 / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
    const boardHeight = 24 * hourHeight;
    return `
        <div class="ta-calendar__scroll" id="calendar-board-scroll">
            <div class="ta-calendar__board" style="--ta-board-height:${boardHeight}px;--ta-hour-height:${hourHeight}px">
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

function calendarOccurrenceKey(block) {
    return `${block.id}@@${block.occurrenceDate || ''}`;
}

// Outlook-style overlap layout: cluster transitively-overlapping blocks,
// assign each block the first free column inside its cluster.
function calendarLayoutDayBlocks(blocks) {
    const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
    const layouts = new Map();
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
        if (!cluster.length) return;
        const colEnds = [];
        const placed = [];
        for (const block of cluster) {
            let col = colEnds.findIndex(end => end <= block.start);
            if (col === -1) {
                col = colEnds.length;
                colEnds.push(0);
            }
            colEnds[col] = block.end;
            placed.push({ block, col });
        }
        for (const { block, col } of placed) {
            layouts.set(calendarOccurrenceKey(block), { col, cols: colEnds.length });
        }
        cluster = [];
    };
    for (const block of sorted) {
        if (cluster.length && block.start >= clusterEnd) flush();
        clusterEnd = cluster.length ? Math.max(clusterEnd, block.end) : block.end;
        cluster.push(block);
    }
    flush();
    return layouts;
}

function calendarDayColumnHtml(dayIndex) {
    const viewPlan = calendarDisplayPlan() || calendarPlan;
    const blocks = calendarBlocksForDay(viewPlan, dayIndex);
    const layouts = calendarLayoutDayBlocks(blocks);
    const today = dayIndex === calendarCurrentDayIndex(viewPlan);
    const nowTop = today ? (calendarNowMinutes() / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT : null;
    return `
        <div class="ta-calendar__day-col${today ? ' ta-calendar__day-col--today' : ''}" id="calendar-day-${dayIndex}">
            ${today && nowTop !== null ? `<div class="ta-calendar__now-line" style="top:${nowTop}px"></div>` : ''}
            ${blocks.map(block => calendarBlockHtml(block, layouts.get(calendarOccurrenceKey(block)))).join('')}
            ${calendarSelectedBlockEditorHtml(dayIndex, blocks)}
        </div>
    `;
}

function calendarBlockHtml(block, layout) {
    const info = calendarCategoryInfo(block.category);
    const top = (block.start / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT;
    const duration = block.end - block.start;
    const height = Math.max(22, (duration / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT - 2);
    const cols = layout?.cols || 1;
    const col = layout?.col || 0;
    const left = `calc(${(col / cols) * 100}% + 2px)`;
    const width = `calc(${(100 / cols)}% - 4px)`;
    const selected = !calendarPreviewDraft
        && block.id === calendarSelectedBlockId
        && (!calendarSelectedOccurrenceDate || calendarSelectedOccurrenceDate === (block.occurrenceDate || ''));
    const statusIcon = block.status === 'done' ? '✓' : block.status === 'missed' ? '✗' : '';
    const compactClass = duration <= 30 ? ' compact' : '';
    const recurring = block.recurringOccurrence ? '1' : '';
    const timeText = duration <= 30
        ? `${calendarMinutesToTime(block.start)}-${calendarMinutesToTime(block.end)}`
        : calendarMinutesToTime(block.start);
    return `
        <button class="ta-block${selected ? ' selected' : ''}${compactClass}${recurring ? ' ta-block--recurring' : ''}"
            ${calendarPreviewDraft ? 'aria-disabled="true"' : ''}
            data-block-id="${calendarEsc(block.id)}" data-occ="${calendarEsc(block.occurrenceDate || '')}" data-recurring="${recurring}"
            title="${calendarEsc(calendarBlockTitle(block))}"
            style="top:${top}px;height:${height}px;left:${left};width:${width};--cat-color:${info.color}">
            ${statusIcon ? `<span class="ta-block__status">${statusIcon}</span>` : ''}
            <span class="ta-block__title">${calendarEsc(calendarReadableBlockTitle(block))}</span>
            <span class="ta-block__time">${calendarEsc(timeText)}</span>
            ${calendarBlockTooltipHtml(block)}
            ${recurring || calendarPreviewDraft ? '' : '<span class="ta-block__resize" title="拖动调整时长"></span>'}
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
    return String(block?.title || '未命名时间块').trim().slice(0, 52);
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

function calendarIsLegacyDefaultPrompt(text) {
    const value = String(text || '');
    return value.startsWith('你是 Time Architect，一个个人时间管理助手。')
        && value.includes('## 草案与确认')
        && !value.includes('update_goal');
}

function calendarNormalizeWorkflowPrompts(raw) {
    const defaults = calendarDefaultWorkflowPrompts();
    if (!raw || typeof raw !== 'object') return defaults;
    if (raw.orchestrator || raw.common || raw.deployment) return defaults;
    const oldVersion = Number(raw.version || 0);
    let globalPrompt = oldVersion < 5 && !String(raw.globalPrompt || '').trim()
        ? CALENDAR_DEFAULT_GLOBAL_PROMPT
        : String(raw.globalPrompt || '');
    // Stored copies of an older built-in default get the refreshed default.
    if (calendarIsLegacyDefaultPrompt(globalPrompt)) globalPrompt = CALENDAR_DEFAULT_GLOBAL_PROMPT;
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
                `;}).join('') : '<div class="ta-empty">还没有目标。在右侧对话里直接说，例如：帮我建立一个雅思 7 分目标，6 月底前完成，每周 10 小时。</div>'}
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
        const isEditing = isActive && calendarEditingApiProfile;
        const status = calendarApiProfileStatusLabel(item);
        const statusClass = status === 'no key' ? 'ta-api-card__badge--none' : (item.apiKey ? 'ta-api-card__badge--local' : 'ta-api-card__badge--server');
        const statusText = status === 'no key' ? '无 key' : (item.apiKey ? '本地 key' : 'Server key');
        const activeClass = isActive ? ' ta-api-card--active' : '';
        const onclick = isActive
            ? 'calendarToggleApiEdit()'
            : `calendarSwitchApiProfile(this.dataset.pid)`;
        let html = `<button class="ta-api-card${activeClass}" onclick="${onclick}" data-pid="${item.id}">
            <div class="ta-api-card__header">
                <div class="ta-api-card__title">${calendarEsc(item.name || '(未命名)')}</div>
                <span class="ta-api-card__badge ${statusClass}">${statusText}</span>
            </div>
            <div class="ta-api-card__meta">${calendarEsc(item.model || '(未设置)')} · ${calendarEsc(item.baseUrl.replace(/^https?:\/\//, ''))}</div>
        </button>`;
        if (isEditing) {
            const keyPh = calendarApiProfileHasServerMatch(item) ? 'Server 已配置，留空即可' : (item.apiKey ? '已保存，留空保留' : 'sk-...');
            html += `<div class="ta-api-card__form" onclick="event.stopPropagation()">
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
            </div>`;
        }
        return html;
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
    calendarEditingApiProfile = false;
    calendarSaveApiStore({ ...store, activeId: next.id });
    calendarApiStatus = `已切换 API：${calendarActiveApiLabel(next)}`;
    calendarRenderSettingsOnly();
}

function calendarToggleApiEdit() {
    calendarEditingApiProfile = !calendarEditingApiProfile;
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
    calendarEditingApiProfile = true;
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











































































function calendarSlug(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'task';
}












function calendarBindDragEvents() {
    const cols = document.querySelectorAll('.ta-calendar__day-col');
    cols.forEach(col => {
        col.addEventListener('mousedown', calendarOnDragStart);
    });
    document.querySelectorAll('.ta-block').forEach(el => {
        el.addEventListener('mousedown', calendarOnBlockMouseDown);
    });
}

/* ── Block drag: move (whole block) and resize (bottom handle) ──
   Click without movement = select/edit, same as before.
   Recurring occurrences stay click-only — edit the series via the form. */

function calendarOnBlockMouseDown(e) {
    if (e.button !== 0 || calendarPreviewDraft || calendarAgentTurnRunning) return;
    const blockEl = e.currentTarget;
    const id = blockEl.dataset.blockId;
    const occ = blockEl.dataset.occ || '';
    const recurring = blockEl.dataset.recurring === '1';
    const isResize = !!e.target.closest('.ta-block__resize');
    const source = (calendarPlan?.blocks || []).find(b => b.id === id);
    if (!source) return;
    e.stopPropagation();
    e.preventDefault();

    calendarBlockDrag = {
        mode: isResize ? 'resize' : 'move',
        id,
        occ,
        recurring,
        startX: e.clientX,
        startY: e.clientY,
        origStart: source.start,
        origEnd: source.end,
        newStart: source.start,
        newEnd: source.end,
        newDayIndex: null,
        moved: false,
        el: blockEl
    };
    document.addEventListener('mousemove', calendarOnBlockDragMove);
    document.addEventListener('mouseup', calendarOnBlockDragEnd);
}

function calendarOnBlockDragMove(e) {
    const st = calendarBlockDrag;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (st.recurring) return; // recurring occurrences are click-only
    if (!st.moved) {
        st.moved = true;
        st.el.classList.add('ta-block--dragging');
        if (calendarEditingBlockId) {
            calendarEditingBlockId = null;
            calendarEditingOccurrenceDate = '';
            document.querySelector('.ta-block-editor')?.remove();
        }
    }

    const deltaMinutes = calendarRoundToInputStep((dy / CALENDAR_SLOT_HEIGHT) * CALENDAR_SLOT_MINUTES);
    const duration = st.origEnd - st.origStart;

    if (st.mode === 'resize') {
        st.newEnd = Math.max(st.origStart + CALENDAR_MIN_BLOCK_MINUTES, Math.min(CALENDAR_DAY_MINUTES, st.origEnd + deltaMinutes));
        st.el.style.height = `${Math.max(22, ((st.newEnd - st.origStart) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT - 2)}px`;
        calendarUpdateBlockDragTime(st, st.origStart, st.newEnd);
        return;
    }

    st.newStart = Math.max(0, Math.min(CALENDAR_DAY_MINUTES - duration, st.origStart + deltaMinutes));
    st.newEnd = st.newStart + duration;
    st.el.style.top = `${(st.newStart / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_HEIGHT}px`;

    const hover = document.elementsFromPoint(e.clientX, e.clientY)
        .find(el => el.classList && el.classList.contains('ta-calendar__day-col'));
    if (hover) {
        const idx = calendarDayIndexFromCol(hover);
        if (idx >= 0 && idx !== st.newDayIndex && hover !== st.el.parentElement) {
            hover.appendChild(st.el);
        }
        if (idx >= 0) st.newDayIndex = idx;
    }
    calendarUpdateBlockDragTime(st, st.newStart, st.newEnd);
}

function calendarUpdateBlockDragTime(st, start, end) {
    const timeEl = st.el.querySelector('.ta-block__time');
    if (timeEl) timeEl.textContent = `${calendarMinutesToTime(start)}-${calendarMinutesToTime(end)}`;
}

function calendarOnBlockDragEnd() {
    document.removeEventListener('mousemove', calendarOnBlockDragMove);
    document.removeEventListener('mouseup', calendarOnBlockDragEnd);
    const st = calendarBlockDrag;
    calendarBlockDrag = null;
    if (!st) return;

    if (!st.moved) {
        calendarSelectBlock(st.id, st.occ);
        return;
    }

    const target = (calendarPlan?.blocks || []).find(b => b.id === st.id);
    if (!target) {
        calendarRender();
        return;
    }

    if (st.mode === 'resize') {
        target.end = st.newEnd;
    } else {
        target.start = st.newStart;
        target.end = st.newEnd;
        if (st.newDayIndex !== null) {
            target.date = calendarDateForDay(calendarPlan.weekStart, st.newDayIndex);
        }
    }
    calendarSelectedBlockId = target.id;
    calendarSelectedOccurrenceDate = target.date || '';
    calendarEditingBlockId = null;
    calendarEditingOccurrenceDate = '';
    calendarSavePlan();
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
    if (calendarPreviewDraft) return;
    if (calendarEditingBlockId) {
        // First click on empty space just closes the editor.
        calendarCloseBlockEditor();
        return;
    }
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
    setTimeout(() => {
        const closeOnOutside = (ev) => {
            const current = document.getElementById('ta-quick-add');
            if (!current) {
                document.removeEventListener('mousedown', closeOnOutside);
                return;
            }
            if (!current.contains(ev.target)) {
                document.removeEventListener('mousedown', closeOnOutside);
                calendarQuickAddCancel();
            }
        };
        document.addEventListener('mousedown', closeOnOutside);
    }, 0);
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


function calendarGlobalKeydown(e) {
    if (!calendarPlan) return;
    if (e.key === 'Escape') {
        if (document.getElementById('ta-quick-add')) { calendarQuickAddCancel(); return; }
        if (calendarEditingBlockId) { calendarCloseBlockEditor(); return; }
        return;
    }
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((e.key === 'Delete' || e.key === 'Backspace')
        && calendarSelectedBlockId && !calendarPreviewDraft && calendarCurrentPage === 'calendar') {
        e.preventDefault();
        calendarDeleteSelectedBlock();
    }
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', calendarGlobalKeydown);
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
    const block = calendarPlan.blocks.find(item => item.id === calendarSelectedBlockId);
    if (!block) return;
    const repeat = calendarCleanRepeat(block.repeat);
    const seriesNote = repeat.frequency !== 'none' ? '\n这是重复日程，整个系列都会被删除。' : '';
    if (!confirm(`删除「${calendarReadableBlockTitle(block)}」？${seriesNote}`)) return;
    calendarPlan.blocks = calendarPlan.blocks.filter(item => item.id !== calendarSelectedBlockId);
    calendarClearBlockSelection();
    calendarSavePlan();
}

