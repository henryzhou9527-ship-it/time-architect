import { get, put } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

export const ACCOUNT_ACCESS = 'private';
export const ACCOUNT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export function hasBlobConfig() {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export function cleanAccountUsername(value) {
    const user = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_-]{3,40}$/.test(user) ? user : '';
}

export function cleanAccountSalt(value) {
    const salt = String(value || '').trim();
    return /^[A-Za-z0-9+/=]{16,120}$/.test(salt) ? salt : '';
}

export function cleanAccountVerifier(value) {
    const verifier = String(value || '').trim();
    return /^[A-Za-z0-9+/=]{32,160}$/.test(verifier) ? verifier : '';
}

export function accountPath(user) {
    return `accounts/${user}.json`;
}

export async function readJsonBlob(pathname) {
    const blob = await get(pathname, { access: ACCOUNT_ACCESS, useCache: false });
    if (!blob?.stream) return null;
    const text = await new Response(blob.stream).text();
    return text ? JSON.parse(text) : null;
}

export async function writeJsonBlob(pathname, record) {
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body, 'utf8') > ACCOUNT_MAX_BODY_BYTES) {
        const error = new Error('payload too large');
        error.status = 413;
        throw error;
    }
    return put(pathname, body, {
        access: ACCOUNT_ACCESS,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60
    });
}

export async function readAccount(user) {
    const cleanUser = cleanAccountUsername(user);
    if (!cleanUser) return null;
    const record = await readJsonBlob(accountPath(cleanUser));
    if (!record || record.username !== cleanUser) return null;
    if (!cleanAccountSalt(record.salt) || !cleanAccountVerifier(record.verifier)) return null;
    return record;
}

export async function writeAccount(record) {
    const user = cleanAccountUsername(record?.username);
    const salt = cleanAccountSalt(record?.salt);
    const verifier = cleanAccountVerifier(record?.verifier);
    if (!user || !salt || !verifier) {
        const error = new Error('invalid account payload');
        error.status = 400;
        throw error;
    }
    return writeJsonBlob(accountPath(user), {
        version: 1,
        username: user,
        salt,
        verifier,
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: record.updatedAt || new Date().toISOString()
    });
}

export function publicAccount(record) {
    return {
        username: record?.username || '',
        salt: record?.salt || '',
        createdAt: record?.createdAt || '',
        updatedAt: record?.updatedAt || ''
    };
}

export function safeEqualText(left, right) {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export async function verifyAccountProof(user, proof) {
    const cleanUser = cleanAccountUsername(user);
    const cleanProof = cleanAccountVerifier(proof);
    if (!cleanUser || !cleanProof) return null;
    const account = await readAccount(cleanUser);
    if (!account) return null;
    return safeEqualText(account.verifier, cleanProof) ? account : null;
}
