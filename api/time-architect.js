const DEFAULT_BASE_URL = 'https://api.ikuncode.cc/v1';
const DEFAULT_MODEL = 'claude-opus-4-6';
const DEFAULT_MODE = 'chat';
const MODEL_TIMEOUT_MS = 120000;
const MODEL_MAX_TOKENS = 8192;
const MODEL_COUNCIL_LIMIT = 8;

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function send(res, data, status = 200) {
    if (res) {
        res.status(status).json(data);
        return undefined;
    }
    return jsonResponse(data, status);
}

function requestHeader(req, name) {
    if (typeof req.headers?.get === 'function') return req.headers.get(name);
    return req.headers?.[name.toLowerCase()] || req.headers?.[name] || '';
}

async function readJsonBody(req) {
    if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (typeof req.json === 'function') return req.json();
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function apiConfig() {
    const mode = String(process.env.TIME_ARCHITECT_API_MODE || DEFAULT_MODE).trim().toLowerCase();
    const allowServerKey = String(process.env.TIME_ARCHITECT_ALLOW_SERVER_KEY || '').trim().toLowerCase() === 'true';
    return {
        name: 'Server API',
        mode: mode === 'responses' ? 'responses' : 'chat',
        baseUrl: normalizeBaseUrl(process.env.TIME_ARCHITECT_BASE_URL || DEFAULT_BASE_URL),
        model: String(process.env.TIME_ARCHITECT_MODEL || DEFAULT_MODEL).trim(),
        apiKey: allowServerKey ? (process.env.TIME_ARCHITECT_API_KEY || process.env.OPENAI_API_KEY || '') : '',
        source: 'server'
    };
}

function cleanServerConfig(raw, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const apiKey = String(source.apiKey || source.key || '').trim();
    if (!apiKey) return null;
    const mode = String(source.mode || DEFAULT_MODE).trim().toLowerCase() === 'responses' ? 'responses' : 'chat';
    const name = String(source.name || source.label || `Server API ${index + 1}`).trim().slice(0, 80) || `Server API ${index + 1}`;
    const model = String(source.model || DEFAULT_MODEL).trim().slice(0, 120) || DEFAULT_MODEL;
    const baseUrl = normalizeBaseUrl(source.baseUrl || source.url || DEFAULT_BASE_URL, {
        assumeV1: source._type === 'newapi_channel_conn'
    });
    return {
        name,
        mode,
        baseUrl,
        model,
        apiKey,
        source: 'server'
    };
}

function serverApiConfigs() {
    const allowServerKey = String(process.env.TIME_ARCHITECT_ALLOW_SERVER_KEY || '').trim().toLowerCase() === 'true';
    if (!allowServerKey) return [];
    const rawList = String(process.env.TIME_ARCHITECT_SERVER_CONFIGS || '').trim();
    if (rawList) {
        try {
            const parsed = JSON.parse(rawList);
            const list = Array.isArray(parsed) ? parsed : [parsed];
            return list.map(cleanServerConfig).filter(Boolean).slice(0, 8);
        } catch {
            return [];
        }
    }
    const single = apiConfig();
    return single.apiKey ? [single] : [];
}

function isPrivateHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host.startsWith('10.')
        || host.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
        || host.startsWith('169.254.');
}

function normalizeBaseUrl(value, options = {}) {
    const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    const url = new URL(raw);
    if ((options.assumeV1 || url.hostname === 'api.ikuncode.cc') && (url.pathname === '' || url.pathname === '/')) {
        url.pathname = '/v1';
        return url.toString().replace(/\/+$/, '');
    }
    return raw;
}

function cleanClientConfig(raw, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const apiKey = String(source.apiKey || '').trim();
    if (!apiKey) return null;

    const name = String(source.name || source.label || `Client API ${index + 1}`).trim().slice(0, 80) || `Client API ${index + 1}`;
    const mode = String(source.mode || DEFAULT_MODE).trim().toLowerCase() === 'responses' ? 'responses' : 'chat';
    const model = String(source.model || DEFAULT_MODEL).trim().slice(0, 120) || DEFAULT_MODEL;
    const rawBase = normalizeBaseUrl(source.baseUrl || DEFAULT_BASE_URL);
    const url = new URL(rawBase);
    if (url.protocol !== 'https:' || isPrivateHost(url.hostname)) {
        throw new Error('client base URL must be a public https URL');
    }

    return {
        name,
        mode,
        model,
        baseUrl: rawBase,
        apiKey,
        source: 'client'
    };
}

function resolveConfigs(body) {
    const clientConfigs = Array.isArray(body?.clientConfigs)
        ? body.clientConfigs.map((item, index) => cleanClientConfig(item, index)).filter(Boolean).slice(0, MODEL_COUNCIL_LIMIT)
        : [];
    if (clientConfigs.length) return clientConfigs;

    const clientConfig = cleanClientConfig(body?.clientConfig, 0);
    if (clientConfig) return [clientConfig];

    const serverConfigs = serverApiConfigs();
    const override = body?.clientConfig && typeof body.clientConfig === 'object' ? body.clientConfig : {};
    if (serverConfigs.length) {
        const requestedName = String(override.name || override.label || '').trim().toLowerCase();
        const requestedModel = String(override.model || '').trim().toLowerCase();
        const matched = serverConfigs.find(config => {
            return (requestedModel && String(config.model || '').toLowerCase() === requestedModel)
                || (requestedName && String(config.name || '').toLowerCase() === requestedName);
        });
        if (matched) return [matched];
        return serverConfigs;
    }

    const config = apiConfig();
    if (override.mode) config.mode = String(override.mode).trim().toLowerCase() === 'responses' ? 'responses' : 'chat';
    if (override.model) config.model = String(override.model).trim().slice(0, 120) || config.model;
    return [config];
}

function publicConfig(config) {
    return {
        configured: Boolean(config.apiKey),
        name: config.name || (config.source === 'client' ? 'Client API' : 'Server API'),
        mode: config.mode,
        baseUrl: config.baseUrl,
        model: config.model,
        provider: config.baseUrl.includes('api.openai.com') ? 'openai' : 'custom',
        source: config.source || 'server'
    };
}

function configModelSignature(config) {
    return `${String(config.baseUrl || '').toLowerCase()}::${String(config.model || '').toLowerCase()}`;
}

function uniqueModelConfigs(configs) {
    const seen = new Set();
    return configs.filter(config => {
        const signature = configModelSignature(config);
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
    });
}

function supportsStrictJsonSchema(config) {
    return String(config?.baseUrl || '').includes('api.openai.com');
}

function supportsJsonObjectMode(config) {
    const baseUrl = String(config?.baseUrl || '').toLowerCase();
    return baseUrl.includes('api.deepseek.com') || baseUrl.includes('deepseek');
}

async function fetchModel(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error?.name === 'AbortError') {
            const timeoutError = new Error('model provider timed out');
            timeoutError.status = 504;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function architectSystemPrompt() {
    return `You are Time Architect, a goal-first 24/7 scheduling engine.

Return JSON only. Update the provided plan object, preserving compatible keys. Do not return markdown outside JSON.

Identity:
- You are not a todo-list generator. You are a goal-to-calendar architect.
- Your job is to maintain a living time system: profile -> goal contract -> workload estimate -> feasibility check -> weekly/daily blocks -> execution feedback -> reschedule.
- Every block must serve a goal, maintenance need, recovery need, fixed constraint, or feedback loop.

Default workflow prompt:
- If payload.agentInstruction is present, treat it as the selected Time Architect role contract for this call.
- Follow the role boundaries, coordination rules, and output discipline in agentInstruction unless they conflict with this JSON contract.
- Non-planner agents should put review findings, risks, challenges, or engineering recommendations in messages and preserve plan state unless a concrete plan proposal is necessary.

Top-down rules:
1. Start from life/current-stage goals, then project goals, milestones, weekly targets, daily outputs, and current action.
2. Never fill a calendar just because time is empty.
3. User may speak casually; infer scheduling-relevant facts, but do not silently store sensitive or unconfirmed long-term facts.
4. When information is missing, proceed with explicit placeholders such as "unknown baseline; calibrate after diagnostic" and low/medium confidence.

Workload before calendar:
- For every goal, define success criteria and current baseline before scheduling.
- Build a GoalContract with: title, desiredOutcome, deadline, successCriteria, currentBaseline, gap, requiredDeliverables, requiredSkills, estimatedWorkload {minimumHours, realisticHours, strongHours, confidence}, risks, dependencies, reviewCheckpoints, priority, consequenceIfDelayed, weeklyTarget, dailyMinimum.
- Estimate doing time, review time, feedback/correction time, mock/test time, and buffer.
- Buffer guidance: familiar task 10-20%, uncertain task 25-40%, exam/high-risk project 40-60%.
- Do not create vague blocks like "Study IELTS". Create exact-output blocks like "Write one Task 2 essay under a 40-minute timer, then mark structure/grammar/examples; output: one essay and five correction notes."

Feasibility:
- Estimate available capacity from weeklyCapacityHours and known constraints.
- Compare required realisticHours against available capacity before the deadline.
- If required > capacity, explicitly say not feasible under current constraints and offer options: increase weekly time, extend deadline, reduce target, accept high-risk sprint, or replace lower-priority commitments.
- Protect sleep, meals, recovery, exercise, basic life admin, and buffer. Do not solve overload by pushing high-cognition work late at night unless the user explicitly accepts a short sprint risk.
- Distinguish plan completion from outcome guarantee. You can ensure planned training/output/review loops, not external results.

ScheduleBlock design:
- Blocks use day 0-6, start/end minutes from midnight, category, title, source, goalId, note, exactAction, output, ifInterrupted, ifFinishedEarly, status.
- Choose block length by task: 15 min reset/review, 25-30 min light/admin, 45-60 min normal practice, 75-90 min deep work, 2-3h mock/project sprint.
- Titles should be short natural calendar labels. exactAction and output carry the real specificity.
- Each block should read like an Outlook calendar event with a human summary, not a cryptic tag.
- For high-cognition work, prefer high-focus windows from profile. Evenings should default to review/light/admin unless profile says otherwise.

Priority model:
Use this mental scoring model when tasks compete:
PriorityScore =
GoalImpact * 0.30 + DeadlineUrgency * 0.25 + RiskReduction * 0.15 + DependencyUnlock * 0.10 + EnergyFit * 0.10 + UserPreference * 0.05 + RecoveryNeed * 0.05 - OverloadPenalty - ContextSwitchPenalty.
Before deadlines, raise urgency/risk-reduction, reduce exploration, increase output/check/submit/review blocks.
After missed blocks, diagnose cause before moving work.

Feedback behavior:
- /reflect: record completed, missed, cause, energy 1-10, and next-day protected block. Re-estimate if needed.
- /adjust: compare original plan and actual result. Decide keep/move/split/drop/replace/defer.
- /catch-up: do not punish. Create a realistic recovery path with smaller blocks and buffers.
- /audit: find overload, unclear tasks, missing review, missing buffer, infeasible goals, bad energy fit.
- /council: if agentInstruction is present, obey that agent role while still returning a complete JSON plan update.
- /light-mode: keep the chain alive with low-intensity blocks when tired.
- /sprint: allow short-term compression only with stated risk.
- /reset: rebuild a minimum viable plan.

Visible context:
- If conversation is present, it is the current visible chat transcript only. Use it for continuity, but do not treat old archives or hidden logs as context.
- The plan payload may intentionally omit archives, memories, and reflections to save tokens. Preserve compatible plan keys and do not invent hidden history.

Memory/profile consent:
- Stable scheduling facts may become memoryCandidates: timezone, fixed commitments, sleep window, high-focus time, low-energy time, failure modes, preferred planning style, health/recovery constraints.
- Do not silently save sensitive or speculative facts. If user clearly says save/remember, update profile. Otherwise emit memoryCandidates with fact, why, field.

Output contract:
Return:
{
  "plan": { full updated plan },
  "messages": ["short user-facing explanations of decisions, feasibility, and next step"],
  "memoryCandidates": [{"fact":"","why":"","field":""}]
}

Plan schema:
- profile: name, timezone, currentLifeStage, roles, fixedCommitments, sleepWindow, mealRoutines, commuteConstraints, energyPattern, healthRecoveryConstraints, planningStyle, defaultBlockLength, motivationPattern, commonFailureModes, weeklyCapacityHours, preferredReviewCadence.
- habits: wake, sleep, deepWorkStart.
- goals: GoalContract objects.
- blocks: ScheduleBlock objects.
- reflections: recent feedback records.
- weekStart: local Sunday YYYY-MM-DD.

When updating plan:
- Preserve user manual blocks unless the user asks to clear or move them.
- Generated blocks should use source prefixes like "coach:ielts", "coach:weight", "coach:generic:<slug>", "system:daily-reflection".
- Repair overlaps where possible.
- Keep the current week view useful, but goal estimates may cover future weeks.
- Messages should be concise, honest, and actionable.`;
}

function responseSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            plan: { type: 'object', additionalProperties: true },
            messages: {
                type: 'array',
                items: { type: 'string' }
            },
            memoryCandidates: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        fact: { type: 'string' },
                        why: { type: 'string' },
                        field: { type: 'string' }
                    },
                    required: ['fact', 'why', 'field']
                }
            }
        },
        required: ['plan', 'messages', 'memoryCandidates']
    };
}

function extractOutputText(data) {
    if (typeof data?.output_text === 'string') return data.output_text;
    const output = Array.isArray(data?.output) ? data.output : [];
    const chunks = [];
    output.forEach(item => {
        const content = Array.isArray(item?.content) ? item.content : [];
        content.forEach(part => {
            if (typeof part?.text === 'string') chunks.push(part.text);
            if (typeof part?.output_text === 'string') chunks.push(part.output_text);
        });
    });
    if (chunks.length) return chunks.join('\n');
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    return choices.map(choice => choice?.message?.content || choice?.text || '').filter(Boolean).join('\n');
}

function parseModelJson(data) {
    const text = extractOutputText(data).trim();
    if (!text) throw new Error('empty model output');
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('model did not return JSON');
        return JSON.parse(match[0]);
    }
}

async function callResponses(config, payload) {
    const body = {
        model: config.model,
        input: [
            { role: 'system', content: architectSystemPrompt() },
            { role: 'user', content: JSON.stringify(payload) }
        ],
        max_output_tokens: MODEL_MAX_TOKENS,
        text: {
            format: {
                type: 'json_schema',
                name: 'time_architect_update',
                strict: true,
                schema: responseSchema()
            }
        }
    };
    return fetchModel(`${config.baseUrl}/responses`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
}

async function callChat(config, payload) {
    const body = {
        model: config.model,
        temperature: 0.2,
        max_tokens: MODEL_MAX_TOKENS,
        messages: [
            { role: 'system', content: architectSystemPrompt() },
            { role: 'user', content: JSON.stringify(payload) }
        ]
    };
    if (supportsStrictJsonSchema(config)) {
        body.response_format = {
            type: 'json_schema',
            json_schema: {
                name: 'time_architect_update',
                strict: true,
                schema: responseSchema()
            }
        };
    } else if (supportsJsonObjectMode(config)) {
        body.response_format = { type: 'json_object' };
    }
    return fetchModel(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
}

async function callModel(config, payload) {
    const response = config.mode === 'chat'
        ? await callChat(config, payload)
        : await callResponses(config, payload);
    const text = await response.text();
    if (!response.ok) {
        const error = new Error('time architect API failed');
        error.status = response.status;
        error.detail = text.slice(0, 1200);
        throw error;
    }
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error('model provider returned non-JSON response');
    }
    return parseModelJson(data);
}

async function runCouncil(configs, payload) {
    const settled = await Promise.allSettled(configs.map((config, index) => {
        return callModel(config, {
            ...payload,
            councilRole: 'advisor',
            councilInstruction: `You are advisor ${index + 1} in a Time Architect model council. Produce your best independent plan update. The final synthesizer will compare your proposal with other models.`
        }).then(parsed => ({ config, parsed }));
    }));

    const successes = settled
        .filter(item => item.status === 'fulfilled')
        .map(item => item.value);
    const failures = settled
        .filter(item => item.status === 'rejected')
        .map((item, index) => `模型会诊成员 ${index + 1} 调用失败：${String(item.reason?.message || item.reason).slice(0, 180)}`);

    if (!successes.length) {
        const error = new Error('all council models failed');
        error.detail = failures.join(' | ');
        throw error;
    }

    let final = successes[0].parsed;
    let synthesizer = successes[0].config;
    const councilMessages = [
        `不同模型会诊完成：${successes.length}/${configs.length} 个模型返回方案。`,
        ...failures
    ];

    if (successes.length > 1) {
        try {
            synthesizer = successes[0].config;
            final = await callModel(synthesizer, {
                ...payload,
                councilRole: 'synthesizer',
                councilInstruction: 'You are the final Time Architect synthesizer. Compare the candidate plans, keep the most feasible and specific schedule decisions, remove contradictions, preserve useful manual blocks, and return one final JSON update.',
                councilCandidates: successes.map(item => ({
                    api: publicConfig(item.config),
                    plan: item.parsed.plan || payload.plan,
                    messages: Array.isArray(item.parsed.messages) ? item.parsed.messages.slice(0, 8) : [],
                    memoryCandidates: Array.isArray(item.parsed.memoryCandidates) ? item.parsed.memoryCandidates.slice(0, 6) : []
                }))
            });
            councilMessages.push(`最终综合模型：${synthesizer.name || synthesizer.model}`);
        } catch (error) {
            councilMessages.push(`最终综合失败，已采用第一个可用方案：${String(error.message || error).slice(0, 180)}`);
        }
    }

    return {
        final,
        messages: councilMessages,
        synthesizer,
        participants: successes.map(item => publicConfig(item.config))
    };
}

export default async function handler(req, res) {
    const envConfig = apiConfig();

    if (req.method === 'GET') {
        const profiles = serverApiConfigs().map(publicConfig);
        return send(res, {
            ...publicConfig(profiles[0] ? { ...profiles[0], apiKey: 'configured' } : envConfig),
            profiles
        });
    }

    if (req.method !== 'POST') {
        return send(res, { error: 'method not allowed' }, 405);
    }

    if (!requestHeader(req, 'content-type')?.includes('application/json')) {
        return send(res, { error: 'json required' }, 400);
    }

    try {
        const body = await readJsonBody(req);
        const configs = uniqueModelConfigs(resolveConfigs(body).filter(config => config.apiKey)).slice(0, MODEL_COUNCIL_LIMIT);
        if (!configs.length) {
            return send(res, { error: 'TIME_ARCHITECT_API_KEY or OPENAI_API_KEY is not configured' }, 503);
        }

        const payload = {
            message: String(body.message || '').slice(0, 6000),
            plan: body.plan && typeof body.plan === 'object' ? body.plan : {},
            agent: body.agent && typeof body.agent === 'object' ? body.agent : null,
            agentInstruction: String(body.agentInstruction || '').slice(0, 60000),
            conversation: body.conversation && typeof body.conversation === 'object' ? body.conversation : null,
            user: String(body.user || '').slice(0, 120),
            now: new Date().toISOString()
        };

        if (body.council && configs.length > 1) {
            const council = await runCouncil(configs, payload);
            const parsed = council.final || {};
            return send(res, {
                ok: true,
                api: {
                    ...publicConfig(council.synthesizer),
                    source: 'council',
                    primary: publicConfig(configs[0]),
                    participants: council.participants
                },
                plan: parsed.plan || body.plan,
                messages: [...council.messages, ...(Array.isArray(parsed.messages) ? parsed.messages : [])],
                memoryCandidates: Array.isArray(parsed.memoryCandidates) ? parsed.memoryCandidates : []
            });
        }

        const config = configs[0];
        const parsed = await callModel(config, payload);
        return send(res, {
            ok: true,
            api: publicConfig(config),
            plan: parsed.plan || body.plan,
            messages: Array.isArray(parsed.messages) ? parsed.messages : [],
            memoryCandidates: Array.isArray(parsed.memoryCandidates) ? parsed.memoryCandidates : []
        });
    } catch (error) {
        if (error.status || error.detail) {
            return send(res, {
                error: String(error.message || 'time architect API failed'),
                status: error.status || 502,
                detail: String(error.detail || '').slice(0, 1200)
            }, 502);
        }
        return send(res, { error: 'time architect backend unavailable', detail: String(error.message || error) }, 500);
    }
}
