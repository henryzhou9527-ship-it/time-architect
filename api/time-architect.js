import { ALL_TOOLS } from './_shared/tool-schema.js';
import { validateToolCall } from './_shared/validation.js';

const DEFAULT_BASE_URL = 'https://api.ikuncode.cc/v1';
const DEFAULT_MODEL = 'claude-opus-4-6';
const DEFAULT_MODE = 'chat';
const MODEL_TIMEOUT_MS = 180000;
const STREAM_MAX_TOKENS = 4096;
const MAX_CLIENT_CONFIGS = 8;

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
        ? body.clientConfigs.map((item, index) => cleanClientConfig(item, index)).filter(Boolean).slice(0, MAX_CLIENT_CONFIGS)
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
        if (matched) return [matched, ...serverConfigs.filter(config => config !== matched)];
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

async function fetchModel(url, options = {}, timeoutMs = MODEL_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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

// --- Time helpers (all wall-clock; no server timezone involved) ---

function minutesToTime(m) {
    const clamped = Math.max(0, Math.min(1440, Math.round(Number(m) || 0)));
    const h = Math.floor(clamped / 60);
    const min = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Accepts minutes (480) or "HH:MM" ("08:00"); habits store wall-clock strings.
function parseTimeOfDay(value, fallback) {
    if (value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))) {
        return Math.max(0, Math.min(1440, Math.round(Number(value))));
    }
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return fallback;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes >= 0 && minutes <= 1440 ? minutes : fallback;
}

function isWallDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

// Wall-clock date arithmetic via UTC so the server timezone never leaks in.
function wallDatePlus(dateStr, days) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOfDate(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function wallDateDiffDays(fromDate, toDate) {
    const [y1, m1, d1] = String(fromDate).split('-').map(Number);
    const [y2, m2, d2] = String(toDate).split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// The client sends its local wall time as "YYYY-MM-DDTHH:MM".
// Fall back to server UTC when absent (older clients).
function resolveClientNow(body) {
    const raw = String(body?.clientNow || '').trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (match) return { date: match[1], time: match[2] };
    const iso = new Date().toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// Mirror of the client recurrence logic, used for free-slot computation.
function blockOccursOnDate(block, dateStr, weekStart) {
    const repeat = block?.repeat && typeof block.repeat === 'object' ? block.repeat : {};
    const frequency = ['daily', 'weekly', 'monthly'].includes(repeat.frequency) ? repeat.frequency : 'none';
    const interval = Math.max(1, Number(repeat.interval) || 1);
    const count = Math.max(0, Number(repeat.count) || 0);
    const anchor = isWallDate(block?.date)
        ? block.date
        : (isWallDate(weekStart) ? wallDatePlus(weekStart, Math.max(0, Math.min(6, Number(block?.day) || 0))) : '');
    if (!anchor) return false;
    const diff = wallDateDiffDays(anchor, dateStr);
    if (diff < 0) return false;
    if (repeat.until && isWallDate(repeat.until) && dateStr > repeat.until) return false;
    if (frequency === 'none') return diff === 0;
    if (frequency === 'daily') {
        return diff % interval === 0 && (!count || Math.floor(diff / interval) + 1 <= count);
    }
    if (frequency === 'weekly') {
        const weeks = Math.floor(diff / 7);
        return diff % 7 === 0 && weeks % interval === 0 && (!count || weeks + 1 <= count);
    }
    if (frequency === 'monthly') {
        const [ay, am, ad] = anchor.split('-').map(Number);
        const [cy, cm, cd] = dateStr.split('-').map(Number);
        if (cd !== ad) return false;
        const months = (cy - ay) * 12 + (cm - am);
        return months >= 0 && months % interval === 0 && (!count || months + 1 <= count);
    }
    return false;
}

// --- Streaming tool-use chat ---

function compactSystemPrompt(roleHint) {
    return roleHint || '';
}

function buildCompactContext(plan, clientNow) {
    const parts = [];
    const profile = plan?.profile;
    const habits = plan?.habits || {};
    const wakeMin = parseTimeOfDay(habits.wake, 480);
    const sleepMin = parseTimeOfDay(habits.sleep, 1380);

    if (profile) {
        const p = [];
        if (profile.name) p.push(profile.name);
        if (profile.timezone) p.push(profile.timezone);
        p.push(`wake ${minutesToTime(wakeMin)}`);
        p.push(`sleep ${minutesToTime(sleepMin)}${sleepMin <= wakeMin ? ' (past midnight)' : ''}`);
        if (profile.weeklyCapacityHours) p.push(`${profile.weeklyCapacityHours}h/week`);
        if (profile.planningStyle) p.push(profile.planningStyle);
        if (profile.fixedCommitments) p.push(`fixed: ${profile.fixedCommitments}`);
        if (profile.healthRecoveryConstraints) p.push(`health: ${profile.healthRecoveryConstraints}`);
        if (profile.currentLifeStage) p.push(`stage: ${profile.currentLifeStage}`);
        if (p.length) parts.push(`[Profile]\n${p.join('\n')}`);
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    parts.push(`[Today] ${clientNow.date} ${dayNames[weekdayOfDate(clientNow.date)]} ${clientNow.time} (user local time), week of ${plan?.weekStart || 'unknown'}`);

    const blocks = Array.isArray(plan?.blocks) ? plan.blocks : [];
    if (blocks.length) {
        const compact = blocks.map(b => {
            const time = `${minutesToTime(b.start || 0)}-${minutesToTime(b.end || 0)}`;
            const dateStr = b.date || `day${b.day}`;
            const repeat = b.repeat?.frequency && b.repeat.frequency !== 'none' ? ` | repeat:${b.repeat.frequency}` : '';
            return `${b.id} | ${b.title} | ${dateStr} ${time} | ${b.category || 'general'}/${b.kind || 'general'}${repeat}`;
        }).join('\n');
        parts.push(`[Blocks]\n${compact}`);
    } else {
        parts.push('[Blocks]\n(empty)');
    }

    const goals = Array.isArray(plan?.goals) ? plan.goals.filter(g => g.status === 'active') : [];
    if (goals.length) {
        const compact = goals.map(g => {
            const deadline = g.deadline ? ` | deadline ${g.deadline}` : '';
            const weekly = g.weeklyTarget ? ` | ${g.weeklyTarget}` : (g.estimatedWorkload?.realisticHours ? ` | ~${g.estimatedWorkload.realisticHours}h total` : '');
            return `${g.id} | ${g.title}${deadline}${weekly}`;
        }).join('\n');
        parts.push(`[Goals]\n${compact}`);
    }

    // Free slots for the next 7 days, expanding recurring blocks.
    // A sleep time at/before wake time crosses midnight, so the day stays
    // schedulable until 24:00 instead of closing at e.g. 00:10.
    const dayEnd = sleepMin <= wakeMin ? 1440 : sleepMin;
    const freeSlots = [];
    for (let d = 0; d < 7; d++) {
        const ds = wallDatePlus(clientNow.date, d);
        const dayBlocks = blocks
            .filter(b => blockOccursOnDate(b, ds, plan?.weekStart))
            .map(b => ({ s: Number(b.start) || 0, e: Number(b.end) || 0 }))
            .sort((a, b) => a.s - b.s);
        const gaps = [];
        let cursor = wakeMin;
        for (const blk of dayBlocks) {
            if (blk.s > cursor) gaps.push(`${minutesToTime(cursor)}-${minutesToTime(blk.s)}`);
            cursor = Math.max(cursor, blk.e);
        }
        if (cursor < dayEnd) gaps.push(`${minutesToTime(cursor)}-${minutesToTime(dayEnd)}`);
        if (gaps.length) {
            const label = d === 0 ? 'today' : d === 1 ? 'tomorrow' : dayNames[weekdayOfDate(ds)];
            freeSlots.push(`${ds} ${label}: ${gaps.join(', ')}`);
        }
    }
    if (freeSlots.length) {
        parts.push(`[Free slots next 7 days]\n${freeSlots.join('\n')}`);
    }

    return parts.join('\n\n');
}

function buildStreamMessages(body, clientNow) {
    const plan = body.plan && typeof body.plan === 'object' ? body.plan : {};
    const userMessage = String(body.message || '');
    const roleHint = body.roleHint ? String(body.roleHint) : '';
    const conversation = Array.isArray(body.conversation) ? body.conversation.slice(-10) : [];

    const context = buildCompactContext(plan, clientNow);
    const systemPrompt = compactSystemPrompt(roleHint) + `\n\n[Current calendar state]\n${context}`;

    // Build messages ensuring strict user/assistant alternation, starting with user
    const messages = [];
    let lastRole = null;
    for (const msg of conversation) {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        const content = String(msg.content || msg.text || '');
        if (!content) continue;
        if (messages.length === 0 && role === 'assistant') continue;
        if (role === lastRole && messages.length > 0) {
            messages[messages.length - 1].content += '\n\n' + content;
        } else {
            messages.push({ role, content });
            lastRole = role;
        }
    }

    // Append the current user message exactly once — older clients also include
    // it as the last conversation entry, so never double it up.
    const last = messages[messages.length - 1];
    if (lastRole === 'user' && last) {
        if (last.content.trim() !== userMessage.trim() && !last.content.trim().endsWith(userMessage.trim())) {
            last.content += '\n\n' + userMessage;
        }
    } else {
        messages.push({ role: 'user', content: userMessage });
    }

    return { systemPrompt, messages };
}

function flushSingleToolCall(tc, emitFn, plan, userMessage) {
    let args = {};
    try { args = tc.arguments ? JSON.parse(tc.arguments) : {}; } catch {}
    const context = {
        blocks: Array.isArray(plan?.blocks) ? plan.blocks : [],
        goals: Array.isArray(plan?.goals) ? plan.goals : []
    };
    const validated = validateToolCall({ name: tc.name, args }, context, 'all', userMessage);
    emitFn('delta', {
        type: 'tool_call',
        id: tc.id || '',
        name: validated.name,
        args: validated.args,
        valid: validated.valid !== false,
        error: validated.error || null
    });
}

function flushAllToolCalls(buffers, emitFn, plan, userMessage) {
    for (const idx of Object.keys(buffers)) {
        if (buffers[idx]?.name) {
            flushSingleToolCall(buffers[idx], emitFn, plan, userMessage);
            delete buffers[idx];
        }
    }
}

async function streamOpenAIProvider(config, systemPrompt, messages, tools, emitFn, plan, userMessage) {
    const body = {
        model: config.model,
        temperature: 0.3,
        max_tokens: STREAM_MAX_TOKENS,
        stream: true,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        tools: tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema }
        })),
        tool_choice: 'auto'
    };

    const endpoint = config.mode === 'responses' ? 'responses' : 'chat/completions';
    const response = await fetchModel(`${config.baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    }, MODEL_TIMEOUT_MS);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API ${response.status}: ${text.slice(0, 500)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const tcBuffers = {};
    let usage = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            if (trimmed === 'data: [DONE]') {
                flushAllToolCalls(tcBuffers, emitFn, plan, userMessage);
                continue;
            }

            let chunk;
            try { chunk = JSON.parse(trimmed.slice(6)); } catch { continue; }
            if (chunk.usage) usage = chunk.usage;

            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                emitFn('delta', { type: 'text', content: delta.content });
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (tc.id) {
                        if (tcBuffers[idx]?.name) {
                            flushSingleToolCall(tcBuffers[idx], emitFn, plan, userMessage);
                        }
                        tcBuffers[idx] = { id: tc.id, name: tc.function?.name || '', arguments: '' };
                    }
                    if (tc.function?.arguments) {
                        if (!tcBuffers[idx]) tcBuffers[idx] = { id: '', name: '', arguments: '' };
                        tcBuffers[idx].arguments += tc.function.arguments;
                    }
                    if (tc.function?.name && tcBuffers[idx]) {
                        tcBuffers[idx].name = tc.function.name;
                    }
                }
            }

            if (chunk.choices?.[0]?.finish_reason) {
                flushAllToolCalls(tcBuffers, emitFn, plan, userMessage);
            }
        }
    }

    flushAllToolCalls(tcBuffers, emitFn, plan, userMessage);
    return usage;
}

async function streamAnthropicProvider(config, systemPrompt, messages, tools, emitFn, plan, userMessage) {
    const body = {
        model: config.model,
        max_tokens: STREAM_MAX_TOKENS,
        stream: true,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages,
        tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
            cache_control: { type: 'ephemeral' }
        }))
    };

    const response = await fetchModel(`${config.baseUrl}/messages`, {
        method: 'POST',
        headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    }, MODEL_TIMEOUT_MS);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API ${response.status}: ${text.slice(0, 500)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const contentBlocks = {};
    let usage = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            let event;
            try { event = JSON.parse(trimmed.slice(6)); } catch { continue; }

            switch (event.type) {
                case 'content_block_start': {
                    const block = event.content_block;
                    contentBlocks[event.index] = {
                        type: block.type, text: block.text || '',
                        id: block.id || '', name: block.name || '', input: ''
                    };
                    break;
                }
                case 'content_block_delta': {
                    const cb = contentBlocks[event.index];
                    if (!cb) break;
                    if (event.delta.type === 'text_delta') {
                        emitFn('delta', { type: 'text', content: event.delta.text });
                    } else if (event.delta.type === 'input_json_delta') {
                        cb.input += event.delta.partial_json;
                    }
                    break;
                }
                case 'content_block_stop': {
                    const cb = contentBlocks[event.index];
                    if (cb?.type === 'tool_use') {
                        flushSingleToolCall(
                            { id: cb.id, name: cb.name, arguments: cb.input },
                            emitFn, plan, userMessage
                        );
                    }
                    delete contentBlocks[event.index];
                    break;
                }
                case 'message_delta': {
                    if (event.usage) usage = event.usage;
                    break;
                }
            }
        }
    }

    return usage;
}

async function handleStreamingToolUse(req, res, body, configs) {
    const config = configs[0];
    const plan = body.plan && typeof body.plan === 'object' ? body.plan : {};
    const userMessage = String(body.message || '');
    const clientNow = resolveClientNow(body);

    const { systemPrompt, messages } = buildStreamMessages(body, clientNow);
    const tools = ALL_TOOLS.filter(t => t.name !== 'respond_text' && t.name !== 'propose_memory');

    const model = String(config.model || '').toLowerCase();
    const baseUrl = String(config.baseUrl || '').toLowerCase();
    const isAnthropic = (/claude|anthropic/.test(model) || baseUrl.includes('anthropic'))
        && !baseUrl.includes('ikuncode');

    if (res && typeof res.writeHead === 'function') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        const emitFn = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
            emitFn('start', { model: config.model, name: config.name || config.model });
            const usage = isAnthropic
                ? await streamAnthropicProvider(config, systemPrompt, messages, tools, emitFn, plan, userMessage)
                : await streamOpenAIProvider(config, systemPrompt, messages, tools, emitFn, plan, userMessage);
            emitFn('done', { usage: usage || {} });
        } catch (error) {
            emitFn('error', { message: String(error.message || error).slice(0, 500) });
        } finally {
            res.end();
        }
        return;
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const emitFn = (event, data) => {
        writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    (async () => {
        try {
            emitFn('start', { model: config.model, name: config.name || config.model });
            const usage = isAnthropic
                ? await streamAnthropicProvider(config, systemPrompt, messages, tools, emitFn, plan, userMessage)
                : await streamOpenAIProvider(config, systemPrompt, messages, tools, emitFn, plan, userMessage);
            emitFn('done', { usage: usage || {} });
        } catch (error) {
            emitFn('error', { message: String(error.message || error).slice(0, 500) });
        } finally {
            try { await writer.close(); } catch {}
        }
    })();

    return new Response(readable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform'
        }
    });
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
        const configs = uniqueModelConfigs(resolveConfigs(body).filter(config => config.apiKey)).slice(0, MAX_CLIENT_CONFIGS);
        if (!configs.length) {
            return send(res, { error: 'TIME_ARCHITECT_API_KEY or OPENAI_API_KEY is not configured' }, 503);
        }

        if (body.stream) {
            return handleStreamingToolUse(req, res, body, configs);
        }

        return send(res, { error: 'this endpoint is streaming-only; send { "stream": true }' }, 400);
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

// Exported for the offline test suite (scripts/test-offline.mjs).
export {
    buildCompactContext,
    buildStreamMessages,
    blockOccursOnDate,
    parseTimeOfDay,
    resolveClientNow,
    wallDatePlus,
    weekdayOfDate,
    normalizeBaseUrl,
    cleanClientConfig,
    resolveConfigs
};
