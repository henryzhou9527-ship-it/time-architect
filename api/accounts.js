import {
    ACCOUNT_MAX_BODY_BYTES,
    cleanAccountSalt,
    cleanAccountUsername,
    cleanAccountVerifier,
    hasBlobConfig,
    publicAccount,
    readAccount,
    verifyAccountProof,
    writeAccount
} from './_shared/accounts.js';

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

async function readJsonBody(req) {
    if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (typeof req.json === 'function') return req.json();
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (Buffer.byteLength(raw, 'utf8') > ACCOUNT_MAX_BODY_BYTES) {
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

function contentType(req) {
    if (typeof req.headers?.get === 'function') return req.headers.get('content-type') || '';
    return req.headers?.['content-type'] || req.headers?.['Content-Type'] || '';
}

export default async function handler(req, res) {
    if (!hasBlobConfig()) {
        return send(res, { error: 'account backend is not configured' }, 503);
    }

    const method = req.method || 'GET';
    try {
        if (method === 'GET') {
            const url = new URL(req.url, 'https://time-architect.local');
            const username = cleanAccountUsername(url.searchParams.get('username'));
            if (!username) return send(res, { error: 'invalid username' }, 400);
            const account = await readAccount(username);
            if (!account) return send(res, { error: 'account not found' }, 404);
            return send(res, { exists: true, account: publicAccount(account) });
        }

        if (method === 'POST') {
            if (!contentType(req).includes('application/json')) {
                return send(res, { error: 'json required' }, 400);
            }
            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();
            const username = cleanAccountUsername(body.username);
            if (!username) return send(res, { error: 'invalid username' }, 400);

            if (action === 'register') {
                const salt = cleanAccountSalt(body.salt);
                const verifier = cleanAccountVerifier(body.verifier);
                if (!salt || !verifier) return send(res, { error: 'invalid account proof' }, 400);
                const existing = await readAccount(username).catch(() => null);
                if (existing) return send(res, { error: 'username already exists' }, 409);
                const now = new Date().toISOString();
                await writeAccount({
                    username,
                    salt,
                    verifier,
                    createdAt: now,
                    updatedAt: now
                });
                const account = await readAccount(username);
                return send(res, { ok: true, account: publicAccount(account) });
            }

            if (action === 'login') {
                const verifier = cleanAccountVerifier(body.verifier);
                if (!verifier) return send(res, { error: 'invalid account proof' }, 400);
                const account = await verifyAccountProof(username, verifier);
                if (!account) return send(res, { error: 'username or password is incorrect' }, 401);
                return send(res, { ok: true, account: publicAccount(account) });
            }

            return send(res, { error: 'unknown account action' }, 400);
        }

        return send(res, { error: 'method not allowed' }, 405);
    } catch (error) {
        const status = error.status || 500;
        return send(res, {
            error: status === 500 ? 'account backend unavailable' : String(error.message || error),
            detail: String(error.message || error).slice(0, 500)
        }, status);
    }
}
