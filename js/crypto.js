/* Token 安全存储：WebCrypto AES-GCM 加密。
 *
 * 设计：
 *   - token 明文不再写入 localStorage，而是存为 "enc:v1:<iv>:<密文>"；
 *   - 加密密钥默认只放 sessionStorage（标签页会话级，关闭浏览器即失效），
 *     此时即使 localStorage 被完整 dump，也拿不到可解密的密钥；
 *   - 设置页勾选「记住 Token」时把密钥持久化到 localStorage（方便但安全性降低，
 *     密钥与密文同处一处，只是"明文不落盘"）。
 */
'use strict';

const TOKEN_STORE = {
  SESSION_KEY: 'github-todo-session-key',
  PERSIST_KEY: 'github-todo-persist-key',
  PREFIX: 'enc:v1:',
};

function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle
    && typeof crypto.subtle.encrypt === 'function' && typeof crypto.subtle.decrypt === 'function';
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function randomKeyMaterial() {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return bytesToB64(key);
}

async function importKeyMaterial(b64) {
  return crypto.subtle.importKey('raw', b64ToBytes(b64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* 读取当前会话可用的密钥；没有时生成一个新的并存入 sessionStorage。
 * 返回 base64 密钥字符串，或 null（环境不支持 WebCrypto，调用方降级明文）。 */
async function getOrCreateTokenKey() {
  if (!cryptoAvailable()) return null;
  const sess = sessionStorage.getItem(TOKEN_STORE.SESSION_KEY);
  if (sess) return sess;
  const persist = localStorage.getItem(TOKEN_STORE.PERSIST_KEY);
  if (persist) {
    sessionStorage.setItem(TOKEN_STORE.SESSION_KEY, persist);
    return persist;
  }
  const fresh = randomKeyMaterial();
  sessionStorage.setItem(TOKEN_STORE.SESSION_KEY, fresh);
  return fresh;
}

/* 只读：获取当前可解密的密钥（session 优先，其次持久密钥），无则 null */
async function getTokenKey() {
  if (!cryptoAvailable()) return null;
  return sessionStorage.getItem(TOKEN_STORE.SESSION_KEY)
    || localStorage.getItem(TOKEN_STORE.PERSIST_KEY)
    || null;
}

function persistTokenKey() {
  const k = sessionStorage.getItem(TOKEN_STORE.SESSION_KEY);
  if (k) localStorage.setItem(TOKEN_STORE.PERSIST_KEY, k);
}

function forgetPersistedTokenKey() {
  localStorage.removeItem(TOKEN_STORE.PERSIST_KEY);
}

function isEncryptedToken(t) {
  return typeof t === 'string' && t.startsWith(TOKEN_STORE.PREFIX);
}

async function encryptToken(plain, keyB64) {
  const key = await importKeyMaterial(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain)
  );
  return TOKEN_STORE.PREFIX + bytesToB64(iv) + ':' + bytesToB64(new Uint8Array(cipher));
}

/* 解密失败（密钥缺失 / 已更换 / 数据损坏）返回 null */
async function decryptToken(stored, keyB64) {
  if (!isEncryptedToken(stored) || !keyB64) return null;
  try {
    const body = stored.slice(TOKEN_STORE.PREFIX.length);
    const sep = body.indexOf(':');
    if (sep < 0) return null;
    const key = await importKeyMaterial(keyB64);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(body.slice(0, sep)) },
      key,
      b64ToBytes(body.slice(sep + 1))
    );
    return new TextDecoder().decode(plain);
  } catch (e) {
    return null;
  }
}
