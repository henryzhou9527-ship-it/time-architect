import { get, put, del } from '@vercel/blob';

const ACCESS = 'private';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ALLOWED_USERS = new Set(['henry', 'admin']);
const ALLOWED_KEYS = new Set(['calendar_plan']);

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
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
    const user = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(user)) return '';
    return ALLOWED_USERS.has(user) ? user : '';
}

function cleanKey(value) {
    const key = String(value || '').trim();
    if (!/^[a-z0-9_-]{1,80}$/.test(key)) return '';
    return ALLOWED_KEYS.has(key) ? key : '';
}

function pathFor(user, key) {
    return `settings/${user}/${key}.json`;
}

function publicRecord(record) {
    return {
        value: record?.value ?? null,
        updatedAt: record?.updatedAt || '',
        createdAt: record?.createdAt || ''
    };
}

async function readRecord(pathname) {
    const blob = await get(pathname, { access: ACCESS, useCache: false });
    if (!blob?.stream) return null;
    const text = await new Response(blob.stream).text();
    return text ? JSON.parse(text) : null;
}

async function writeRecord(pathname, record) {
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        const error = new Error('settings payload too large');
        error.status = 413;
        throw error;
    }
    return put(pathname, body, {
        access: ACCESS,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60
    });
}

export default async function handler(req, res) {
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
        return send(res, { error: 'BLOB_READ_WRITE_TOKEN is not configured' }, 503);
    }

    const method = req.method || 'GET';
    try {
        if (method === 'GET') {
            const url = new URL(req.url, 'https://time-architect.local');
            const user = cleanUser(url.searchParams.get('user'));
            const key = cleanKey(url.searchParams.get('key'));
            if (!user || !key) return send(res, { error: 'invalid user or key' }, 400);
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
