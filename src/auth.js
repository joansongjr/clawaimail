import crypto from 'crypto';
import { getUserByApiKey, getUserByEmail, createUser, createApiKey, getApiKeys } from './db.js';

// 密码哈希
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const verify = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === verify;
}

// API Key 认证中间件
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing API key. Use: Authorization: Bearer pb_xxx' });
  }

  const key = authHeader.slice(7);
  const user = getUserByApiKey(key);
  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.user = user;
  next();
}

// 注册
export function handleRegister(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = hashPassword(password);
    let userId;
    try {
      userId = createUser({ email, passwordHash });
    } catch (e) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const apiKey = createApiKey(userId, 'default');

    res.status(201).json({
      user: { id: userId, email },
      api_key: apiKey.key
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// 登录
export function handleLogin(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Reuse existing key if available, otherwise create one
    const existingKeys = getApiKeys(user.id);
    const apiKey = existingKeys.length > 0 ? existingKeys[0].key : createApiKey(user.id, 'default').key;

    res.json({
      user: { id: user.id, email: user.email, plan: user.plan },
      api_key: apiKey
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// === OAuth: 找到或创建用户 ===

function findOrCreateOAuthUser(email) {
  let user = getUserByEmail(email);
  if (!user) {
    const userId = createUser({ email, passwordHash: '' });
    user = { id: userId, email };
  }
  // Reuse existing key if available
  const existingKeys = getApiKeys(user.id);
  const apiKey = existingKeys.length > 0 ? existingKeys[0].key : createApiKey(user.id, 'default').key;
  return { user, apiKey };
}

// === GitHub OAuth ===

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const OAUTH_REDIRECT_BASE = process.env.OAUTH_REDIRECT_BASE || 'https://clawaimail.com';

export function handleGitHubLogin(req, res) {
  if (!GITHUB_CLIENT_ID) return res.status(500).json({ error: 'GitHub OAuth not configured' });
  const redirect = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=user:email&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_BASE + '/v1/auth/github/callback')}`;
  res.redirect(redirect);
}

export async function handleGitHubCallback(req, res) {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).json({ error: 'Failed to get access token' });

    // Get user email
    const userRes = await fetch('https://api.github.com/user/emails', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'ClawAIMail' }
    });
    const emails = await userRes.json();
    const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
    if (!primary) return res.status(400).json({ error: 'No verified email found on GitHub account' });

    const { apiKey } = findOrCreateOAuthUser(primary.email);
    res.redirect(`${OAUTH_REDIRECT_BASE}/?token=${apiKey}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// === Google OAuth ===

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export function handleGoogleLogin(req, res) {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth not configured' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_BASE + '/v1/auth/google/callback',
    response_type: 'code',
    scope: 'email profile',
    access_type: 'offline',
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export async function handleGoogleCallback(req, res) {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    // Exchange code for token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: OAUTH_REDIRECT_BASE + '/v1/auth/google/callback',
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).json({ error: 'Failed to get access token' });

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userInfo = await userRes.json();
    if (!userInfo.email) return res.status(400).json({ error: 'No email found on Google account' });

    const { apiKey } = findOrCreateOAuthUser(userInfo.email);
    res.redirect(`${OAUTH_REDIRECT_BASE}/?token=${apiKey}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
