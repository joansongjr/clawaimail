import crypto from 'crypto';
import { getUserByApiKey, getUserByEmail, createUser, createApiKey } from './db.js';

// 密码哈希
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
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

    const apiKey = createApiKey(user.id, `login-${Date.now()}`);

    res.json({
      user: { id: user.id, email: user.email, plan: user.plan },
      api_key: apiKey.key
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
