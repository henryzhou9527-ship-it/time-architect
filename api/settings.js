import { del } from '@vercel/blob';
import {
    ACCOUNT_MAX_BODY_BYTES,
    cleanAccountUsername,
    cleanAccountVerifier,
    hasBlobConfig,
    readJsonBlob,
    verifyAccountProof,
    writeJsonBlob
} from './_shared/accounts.js';

const MAX_BODY_BYTES = ACCOUNT_MAX_BODY_BYTES;
const ALLOWED_KEYS = new Set(['calendar_plan']);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Time-Architect-User, X-Time-Architect-Proof',
    'Access-Control-Max-Age': '86400'
};

function applyCors(res) {
    if (res && typeof res.setHeader === 'function') {
        for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...CORS_HEADERS
        }
    });
}

function send(res, data, status = 200) {
    if (res) {
        res.status(status).setHeader('Cache-Control', 'no-store').json(data);
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
        req.on('data', chunk => {
            raw += chunk;
            if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
                reject(new Error('request body too large'));
                req.destroy();
            }
        });
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

function cleanUser(value) {
    return cleanAccountUsername(value);
}

function cleanKey(value) {
    const key = String(value || '').trim();
    if (!/^[a-z0-9_-]{1,80}$/.test(key)) return '';
    return ALLOWED_KEYS.has(key) ? key : '';
}

function pathFor(user, key) {
    return `settings/${user}/${key}.json`;
}

async function requireAccountAccess(req, body, expectedUser) {
    const authUser = cleanUser(
        requestHeader(req, 'x-time-architect-user')
        || body?.auth?.username
        || body?.auth?.user
        || ''
    );
    const proof = cleanAccountVerifier(
        requestHeader(req, 'x-time-architect-proof')
        || body?.auth?.verifier
        || ''
    );
    if (!authUser || authUser !== expectedUser || !proof) {
        const error = new Error('login required');
        error.status = 401;
        throw error;
    }
    const account = await verifyAccountProof(authUser, proof);
    if (!account) {
        const error = new Error('invalid login');
        error.status = 401;
        throw error;
    }
    return account;
}

function publicRecord(record) {
    return {
        value: record?.value ?? null,
        updatedAt: record?.updatedAt || '',
        createdAt: record?.createdAt || ''
    };
}

async function readRecord(pathname) {
    return readJsonBlob(pathname);
}

async function writeRecord(pathname, record) {
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        const error = new Error('settings payload too large');
        error.status = 413;
        throw error;
    }
    return writeJsonBlob(pathname, record);
}

export default async function handler(req, res) {
    applyCors(res);
    if ((req.method || '') === 'OPTIONS') {
        if (res) { res.statusCode = 204; res.end(); return undefined; }
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (!hasBlobConfig()) {
        return send(res, { error: 'BLOB_READ_WRITE_TOKEN is not configured' }, 503);
    }

    const method = req.method || 'GET';
    try {
        if (method === 'GET') {
            const url = new URL(req.url, 'https://time-architect.local');
            const user = cleanUser(url.searchParams.get('user'));
            const key = cleanKey(url.searchParams.get('key'));
            if (!user || !key) return send(res, { error: 'invalid user or key' }, 400);
            await requireAccountAccess(req, null, user);
            const record = await readRecord(pathFor(user, key));
            return send(res, record ? publicRecord(record) : { value: null });
        }

        if (method === 'POST') {
            if (!requestHeader(req, 'content-type')?.includes('application/json')) {
                return send(res, { error: 'json required' }, 400);
            }
            const body = await readJsonBody(req);
            const user = cleanUser(body.user);
            const key = cleanKey(body.key);
            if (!user || !key) return send(res, { error: 'invalid user or key' }, 400);
            await requireAccountAccess(req, body, user);
            const existing = await readRecord(pathFor(user, key)).catch(() => null);
            const now = new Date().toISOString();
            const record = {
                key,
                user,
                value: body.value ?? null,
                createdAt: existing?.createdAt || now,
                updatedAt: now
            };
            const blob = await writeRecord(pathFor(user, key), record);
            return send(res, {
                ok: true,
                updatedAt: record.updatedAt,
                pathname: blob.pathname
            });
        }

        if (method === 'DELETE') {
            const body = await readJsonBody(req).catch(() => ({}));
            const url = new URL(req.url, 'https://time-architect.local');
            const user = cleanUser(body.user || url.searchParams.get('user'));
            const key = cleanKey(body.key || url.searchParams.get('key'));
            if (!user || !key) return send(res, { error: 'invalid user or key' }, 400);
            await requireAccountAccess(req, body, user);
            await del(pathFor(user, key));
            return send(res, { ok: true });
        }

        return send(res, { error: 'method not allowed' }, 405);
    } catch (error) {
        const status = error.status || 500;
        return send(res, {
            error: status === 500 ? 'settings backend unavailable' : String(error.message || error),
            detail: String(error.message || error).slice(0, 500)
        }, status);
    }
}
