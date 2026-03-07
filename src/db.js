import initSqlJs from 'sql.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'pawbox.db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const SQL = await initSqlJs();
let db;

if (fs.existsSync(dbPath)) {
  const buffer = fs.readFileSync(dbPath);
  db = new SQL.Database(buffer);
} else {
  db = new SQL.Database();
}

// === 初始化表 ===

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT 'default',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS inboxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    address TEXT UNIQUE NOT NULL,
    display_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbox_id INTEGER NOT NULL,
    message_id TEXT,
    direction TEXT DEFAULT 'inbound',
    from_addr TEXT,
    to_addr TEXT,
    subject TEXT,
    text_content TEXT,
    html_content TEXT,
    attachments TEXT,
    thread_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0,
    FOREIGN KEY (inbox_id) REFERENCES inboxes(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    events TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#666',
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, name)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS email_labels (
    email_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    PRIMARY KEY (email_id, label_id),
    FOREIGN KEY (email_id) REFERENCES emails(id),
    FOREIGN KEY (label_id) REFERENCES labels(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS custom_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT UNIQUE NOT NULL,
    verified INTEGER DEFAULT 0,
    verification_token TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

function saveDb() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function lastInsertId() {
  const stmt = db.prepare('SELECT last_insert_rowid()');
  stmt.step();
  const id = stmt.get()[0];
  stmt.free();
  return id;
}

// === 用户 ===

export function createUser({ email, passwordHash }) {
  db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash || '']);
  const id = lastInsertId();
  saveDb();
  return id;
}

export function getUserByEmail(email) {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  stmt.bind([email]);
  const user = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return user;
}

export function getUserById(id) {
  const stmt = db.prepare('SELECT id, email, plan, created_at FROM users WHERE id = ?');
  stmt.bind([id]);
  const user = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return user;
}

// === API Keys ===

export function createApiKey(userId, name = 'default') {
  const key = 'pb_' + crypto.randomBytes(24).toString('hex');
  db.run('INSERT INTO api_keys (user_id, key, name) VALUES (?, ?, ?)', [userId, key, name]);
  saveDb();
  return { key, name };
}

export function getUserByApiKey(key) {
  const stmt = db.prepare(`
    SELECT u.id, u.email, u.plan, u.created_at
    FROM api_keys ak JOIN users u ON ak.user_id = u.id
    WHERE ak.key = ?
  `);
  stmt.bind([key]);
  const user = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return user;
}

export function getApiKeys(userId) {
  const stmt = db.prepare('SELECT id, name, key, created_at FROM api_keys WHERE user_id = ?');
  stmt.bind([userId]);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({ ...row, key: row.key.substring(0, 10) + '...' });
  }
  stmt.free();
  return rows;
}

export function deleteApiKey(id, userId) {
  db.run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [id, userId]);
  saveDb();
}

// === 邮箱 ===

export function createInbox({ userId, address, displayName }) {
  db.run('INSERT INTO inboxes (user_id, address, display_name) VALUES (?, ?, ?)',
    [userId, address, displayName || null]);
  const id = lastInsertId();
  saveDb();
  return { id, address, display_name: displayName };
}

export function getInboxes(userId) {
  const stmt = db.prepare('SELECT * FROM inboxes WHERE user_id = ?');
  stmt.bind([userId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function getInboxById(id, userId) {
  const stmt = db.prepare('SELECT * FROM inboxes WHERE id = ? AND user_id = ?');
  stmt.bind([id, userId]);
  const inbox = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return inbox;
}

export function getInboxByAddress(address) {
  const stmt = db.prepare('SELECT * FROM inboxes WHERE address = ?');
  stmt.bind([address]);
  const inbox = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return inbox;
}

export function deleteInbox(id, userId) {
  db.run('DELETE FROM emails WHERE inbox_id = ?', [id]);
  db.run('DELETE FROM inboxes WHERE id = ? AND user_id = ?', [id, userId]);
  saveDb();
}

export function countInboxes(userId) {
  const stmt = db.prepare('SELECT COUNT(*) FROM inboxes WHERE user_id = ?');
  stmt.bind([userId]);
  let count = 0;
  if (stmt.step()) count = stmt.get()[0];
  stmt.free();
  return count;
}

// === 邮件 ===

export function insertEmail({ inboxId, messageId, direction, from, to, subject, text, html, attachments, threadId }) {
  db.run(`
    INSERT INTO emails (inbox_id, message_id, direction, from_addr, to_addr, subject, text_content, html_content, attachments, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [inboxId, messageId, direction || 'inbound', from, to, subject, text, html, JSON.stringify(attachments || []), threadId || null]);
  const id = lastInsertId();
  saveDb();
  return id;
}

function formatEmail(row) {
  return {
    id: row.id,
    inbox_id: row.inbox_id,
    message_id: row.message_id,
    direction: row.direction,
    from: row.from_addr,
    to: row.to_addr,
    subject: row.subject,
    text: row.text_content,
    html: row.html_content,
    attachments: row.attachments ? JSON.parse(row.attachments) : [],
    thread_id: row.thread_id,
    created_at: row.created_at,
    is_read: row.is_read
  };
}

export function getEmails({ inboxId, limit = 50, offset = 0, unread = false }) {
  let sql = 'SELECT * FROM emails WHERE inbox_id = ?';
  const params = [inboxId];
  if (unread) {
    sql += ' AND is_read = 0';
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(formatEmail(stmt.getAsObject()));
  stmt.free();
  return rows;
}

export function getEmailById(id, inboxId) {
  const stmt = db.prepare('SELECT * FROM emails WHERE id = ? AND inbox_id = ?');
  stmt.bind([id, inboxId]);
  const email = stmt.step() ? formatEmail(stmt.getAsObject()) : null;
  stmt.free();
  return email;
}

export function markAsRead(id) {
  db.run('UPDATE emails SET is_read = 1 WHERE id = ?', [id]);
  saveDb();
}

// === Webhooks ===

export function createWebhook({ userId, url, events }) {
  db.run('INSERT INTO webhooks (user_id, url, events) VALUES (?, ?, ?)',
    [userId, url, JSON.stringify(events)]);
  const id = lastInsertId();
  saveDb();
  return { id, url, events };
}

export function getWebhooks(userId) {
  const stmt = db.prepare('SELECT * FROM webhooks WHERE user_id = ?');
  stmt.bind([userId]);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({ ...row, events: JSON.parse(row.events || '[]') });
  }
  stmt.free();
  return rows;
}

export function getWebhooksByInboxAddress(address) {
  const stmt = db.prepare(`
    SELECT w.* FROM webhooks w
    JOIN inboxes i ON w.user_id = i.user_id
    WHERE i.address = ?
  `);
  stmt.bind([address]);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({ ...row, events: JSON.parse(row.events || '[]') });
  }
  stmt.free();
  return rows;
}

export function deleteWebhook(id, userId) {
  db.run('DELETE FROM webhooks WHERE id = ? AND user_id = ?', [id, userId]);
  saveDb();
}

// === 用量限制 ===

const PLAN_LIMITS = {
  free:     { maxInboxes: 3,   maxEmailsPerMonth: 3000,   maxSendPerDay: 100, maxStorageMB: 3072,   maxDomains: 0,  maxWebhooks: 2 },
  starter:  { maxInboxes: 10,  maxEmailsPerMonth: 5000,   maxSendPerDay: -1,  maxStorageMB: 10240,  maxDomains: 0,  maxWebhooks: 5 },
  pro:      { maxInboxes: 50,  maxEmailsPerMonth: 50000,  maxSendPerDay: -1,  maxStorageMB: 51200,  maxDomains: 20, maxWebhooks: 20 },
  business: { maxInboxes: 200, maxEmailsPerMonth: 200000, maxSendPerDay: -1,  maxStorageMB: 204800, maxDomains: -1, maxWebhooks: -1 }
};

export function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export function countTodaySent(userId) {
  const today = new Date().toISOString().split('T')[0];
  const stmt = db.prepare(`
    SELECT COUNT(*) FROM emails e
    JOIN inboxes i ON e.inbox_id = i.id
    WHERE i.user_id = ? AND e.direction = 'outbound' AND e.created_at >= ?
  `);
  stmt.bind([userId, today]);
  let count = 0;
  if (stmt.step()) count = stmt.get()[0];
  stmt.free();
  return count;
}

// === 标签 ===

export function createLabel({ userId, name, color }) {
  db.run('INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)',
    [userId, name, color || '#666']);
  const id = lastInsertId();
  saveDb();
  return { id, name, color: color || '#666' };
}

export function getLabels(userId) {
  const stmt = db.prepare('SELECT * FROM labels WHERE user_id = ?');
  stmt.bind([userId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function deleteLabel(id, userId) {
  db.run('DELETE FROM email_labels WHERE label_id = ?', [id]);
  db.run('DELETE FROM labels WHERE id = ? AND user_id = ?', [id, userId]);
  saveDb();
}

export function addLabelToEmail(emailId, labelId) {
  try {
    db.run('INSERT INTO email_labels (email_id, label_id) VALUES (?, ?)', [emailId, labelId]);
    saveDb();
  } catch (e) { /* already labeled */ }
}

export function removeLabelFromEmail(emailId, labelId) {
  db.run('DELETE FROM email_labels WHERE email_id = ? AND label_id = ?', [emailId, labelId]);
  saveDb();
}

export function getEmailLabels(emailId) {
  const stmt = db.prepare(`
    SELECT l.* FROM labels l
    JOIN email_labels el ON l.id = el.label_id
    WHERE el.email_id = ?
  `);
  stmt.bind([emailId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// === 线程 ===

export function getThreads({ inboxId, limit = 20, offset = 0 }) {
  // 按 thread_id 分组，取每组最新邮件
  const stmt = db.prepare(`
    SELECT thread_id, COUNT(*) as message_count,
           MAX(created_at) as last_message_at,
           MIN(created_at) as first_message_at
    FROM emails
    WHERE inbox_id = ? AND thread_id IS NOT NULL
    GROUP BY thread_id
    ORDER BY last_message_at DESC
    LIMIT ? OFFSET ?
  `);
  stmt.bind([inboxId, limit, offset]);
  const threads = [];
  while (stmt.step()) threads.push(stmt.getAsObject());
  stmt.free();

  // 获取每个线程的最新邮件作为预览
  for (const thread of threads) {
    const s = db.prepare('SELECT * FROM emails WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1');
    s.bind([thread.thread_id]);
    if (s.step()) {
      const preview = formatEmail(s.getAsObject());
      thread.subject = preview.subject;
      thread.last_from = preview.from;
    }
    s.free();
  }
  return threads;
}

export function getThreadMessages(threadId, inboxId) {
  const stmt = db.prepare('SELECT * FROM emails WHERE thread_id = ? AND inbox_id = ? ORDER BY created_at ASC');
  stmt.bind([threadId, inboxId]);
  const rows = [];
  while (stmt.step()) rows.push(formatEmail(stmt.getAsObject()));
  stmt.free();
  return rows;
}

// === 搜索 ===

export function searchEmails({ inboxId, query, limit = 20 }) {
  const like = `%${query}%`;
  const stmt = db.prepare(`
    SELECT * FROM emails
    WHERE inbox_id = ? AND (subject LIKE ? OR text_content LIKE ? OR from_addr LIKE ?)
    ORDER BY created_at DESC LIMIT ?
  `);
  stmt.bind([inboxId, like, like, like, limit]);
  const rows = [];
  while (stmt.step()) rows.push(formatEmail(stmt.getAsObject()));
  stmt.free();
  return rows;
}

// === 自定义域名 ===

export function addCustomDomain({ userId, domain }) {
  const token = 'clawaimail-verify-' + crypto.randomBytes(16).toString('hex');
  db.run('INSERT INTO custom_domains (user_id, domain, verification_token) VALUES (?, ?, ?)',
    [userId, domain, token]);
  const id = lastInsertId();
  saveDb();
  return { id, domain, verified: false, verification_token: token };
}

export function getCustomDomains(userId) {
  const stmt = db.prepare('SELECT * FROM custom_domains WHERE user_id = ?');
  stmt.bind([userId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function getCustomDomainByDomain(domain) {
  const stmt = db.prepare('SELECT * FROM custom_domains WHERE domain = ?');
  stmt.bind([domain]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

export function verifyCustomDomain(id) {
  db.run('UPDATE custom_domains SET verified = 1 WHERE id = ?', [id]);
  saveDb();
}

export function deleteCustomDomain(id, userId) {
  db.run('DELETE FROM custom_domains WHERE id = ? AND user_id = ?', [id, userId]);
  saveDb();
}

// 获取邮箱所属用户（通过地址的域名部分查找）
export function getUserIdByInboxAddress(address) {
  const stmt = db.prepare('SELECT user_id FROM inboxes WHERE address = ?');
  stmt.bind([address]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row?.user_id;
}

export default db;
