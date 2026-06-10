/**
 * Local dev server for Time Architect.
 *
 * Serves the static app AND mounts the Vercel serverless functions under /api/*,
 * so the full product (chat streaming, cloud accounts if BLOB token present)
 * runs locally with plain Node — no python, no vercel CLI.
 *
 * Usage:
 *   npm start                 # http://localhost:4175
 *   PORT=5000 npm start       # custom port
 *
 * .env.local (KEY=VALUE lines) is loaded into process.env automatically.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4175;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json'
};

function loadEnvLocal() {
    const file = path.join(ROOT, '.env.local');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || line.trim().startsWith('#')) continue;
        const key = match[1];
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

const API_ROUTES = {
    '/api/time-architect': '../api/time-architect.js',
    '/api/accounts': '../api/accounts.js',
    '/api/settings': '../api/settings.js'
};

const handlerCache = new Map();
async function apiHandler(route) {
    if (!handlerCache.has(route)) {
        const moduleUrl = pathToFileURL(path.join(ROOT, API_ROUTES[route].replace('../', ''))).href;
        handlerCache.set(route, import(moduleUrl).then(mod => mod.default));
    }
    return handlerCache.get(route);
}

// Vercel-style helpers on top of the Node response object.
function adaptResponse(res) {
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => {
        if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
        return res;
    };
    const nativeSetHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => { nativeSetHeader(name, value); return res; };
    return res;
}

function safeJoin(root, urlPath) {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const target = path.normalize(path.join(root, decoded));
    if (!target.startsWith(root)) return null;
    return target;
}

function serveStatic(req, res) {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = safeJoin(ROOT, urlPath);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
}

function lanAddresses() {
    const result = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const item of list || []) {
            if (item.family === 'IPv4' && !item.internal) result.push(item.address);
        }
    }
    return result;
}

loadEnvLocal();

const server = http.createServer(async (req, res) => {
    const route = Object.keys(API_ROUTES).find(prefix => req.url.split('?')[0] === prefix);
    if (route) {
        try {
            const handler = await apiHandler(route);
            await handler(req, adaptResponse(res));
        } catch (error) {
            console.error(`[api] ${req.method} ${req.url} failed:`, error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
            }
            try { res.end(JSON.stringify({ error: 'local api handler crashed', detail: String(error.message || error) })); } catch {}
        }
        return;
    }
    serveStatic(req, res);
});

function listen(port, attemptsLeft) {
    server.once('error', error => {
        if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
            console.log(`Port ${port} is busy, trying ${port + 1}...`);
            listen(port + 1, attemptsLeft - 1);
        } else {
            console.error(error.message || error);
            process.exit(1);
        }
    });
    server.listen(port, '0.0.0.0', () => {
        console.log(`Time Architect dev server running:`);
        console.log(`  Local:   http://localhost:${port}`);
        for (const ip of lanAddresses()) console.log(`  Network: http://${ip}:${port}  (phone on the same Wi-Fi)`);
        console.log(`  APIs:    ${Object.keys(API_ROUTES).join(', ')}`);
        console.log(process.env.BLOB_READ_WRITE_TOKEN ? '  Blob token loaded — cloud accounts work locally.' : '  No BLOB token — cloud accounts return 503 (local-only mode still works).');
    });
}

listen(PORT, 10);
