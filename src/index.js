import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { authenticate, handleRegister, handleLogin } from './auth.js';
import { initWebSocket, getOnlineCount } from './ws.js';
import {
  createInbox, getInboxes, getInboxById, deleteInbox, countInboxes,
  getEmails, getEmailById, markAsRead, insertEmail, searchEmails,
  getThreads, getThreadMessages,
  createLabel, getLabels, deleteLabel, addLabelToEmail, removeLabelFromEmail, getEmailLabels,
  addCustomDomain, getCustomDomains, verifyCustomDomain, deleteCustomDomain,
  createWebhook, getWebhooks, deleteWebhook,
  getApiKeys, createApiKey, deleteApiKey,
  getPlanLimits, countTodaySent
} from './db.js';
import { sendEmail } from './mailer.js';
import { getPlans, createCheckoutSession, handleStripeWebhook, upgradePlan } from './billing.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.MAIL_DOMAIN || 'clawaimail.com';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// === 公开接口 ===

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'clawaimail',
    ws_connections: getOnlineCount(),
    timestamp: new Date().toISOString()
  });
});

app.post('/v1/auth/register', handleRegister);
app.post('/v1/auth/login', handleLogin);

// 计费信息（公开）
app.get('/v1/plans', (req, res) => {
  res.json(getPlans());
});

// Stripe Webhook（需要 raw body，必须在 bodyParser 之前或用单独的 parser）
app.post('/v1/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const result = await handleStripeWebhook(req.body, sig);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// === 以下接口需要认证 ===

app.use('/v1', authenticate);

// 用户信息
app.get('/v1/me', (req, res) => {
  const limits = getPlanLimits(req.user.plan);
  const inboxCount = countInboxes(req.user.id);
  const todaySent = countTodaySent(req.user.id);
  res.json({
    ...req.user,
    limits,
    usage: { inboxes: inboxCount, sent_today: todaySent }
  });
});

// === 邮箱管理 ===

app.post('/v1/inboxes', (req, res) => {
  try {
    const { username, domain, display_name } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i.test(username) || username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: 'username must be 2-30 characters, alphanumeric/dots/hyphens' });
    }

    const limits = getPlanLimits(req.user.plan);
    const current = countInboxes(req.user.id);
    if (limits.maxInboxes > 0 && current >= limits.maxInboxes) {
      return res.status(403).json({ error: `Plan limit reached (${limits.maxInboxes} inboxes). Upgrade to create more.` });
    }

    // 支持自定义域名（付费功能）
    let mailDomain = DOMAIN;
    if (domain && domain !== DOMAIN) {
      const customDomains = getCustomDomains(req.user.id);
      const cd = customDomains.find(d => d.domain === domain && d.verified);
      if (!cd) {
        return res.status(400).json({ error: 'Domain not verified. Add and verify it first via /v1/domains.' });
      }
      mailDomain = domain;
    }

    const address = `${username}@${mailDomain}`;
    const inbox = createInbox({ userId: req.user.id, address, displayName: display_name });
    res.status(201).json(inbox);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'This email address is already taken' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/inboxes', (req, res) => {
  try {
    res.json(getInboxes(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/inboxes/:id', (req, res) => {
  try {
    const inbox = getInboxById(req.params.id, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });
    res.json(inbox);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/inboxes/:id', (req, res) => {
  try {
    const inbox = getInboxById(req.params.id, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });
    deleteInbox(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 邮件 ===

app.get('/v1/inboxes/:inboxId/messages', (req, res) => {
  try {
    const inbox = getInboxById(req.params.inboxId, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });

    const { limit = 50, offset = 0, unread } = req.query;
    const emails = getEmails({
      inboxId: inbox.id,
      limit: parseInt(limit),
      offset: parseInt(offset),
      unread: unread === 'true'
    });
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/inboxes/:inboxId/messages/:id', (req, res) => {
  try {
    const inbox = getInboxById(req.params.inboxId, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });

    const email = getEmailById(req.params.id, inbox.id);
    if (!email) return res.status(404).json({ error: 'Message not found' });

    markAsRead(email.id);
    email.labels = getEmailLabels(email.id);
    res.json(email);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/messages/send', async (req, res) => {
  try {
    const { inbox_id, to, subject, text, html, thread_id } = req.body;
    if (!inbox_id || !to || !subject) {
      return res.status(400).json({ error: 'inbox_id, to, and subject are required' });
    }

    const inbox = getInboxById(inbox_id, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });

    const limits = getPlanLimits(req.user.plan);
    const todaySent = countTodaySent(req.user.id);
    if (limits.maxSendPerDay > 0 && todaySent >= limits.maxSendPerDay) {
      return res.status(429).json({ error: `Daily send limit reached (${limits.maxSendPerDay}). Upgrade for more.` });
    }

    const result = await sendEmail({ from: inbox.address, to, subject, text, html });

    const emailId = insertEmail({
      inboxId: inbox.id,
      messageId: result.messageId,
      direction: 'outbound',
      from: inbox.address,
      to, subject, text, html,
      threadId: thread_id
    });

    res.json({ id: emailId, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 搜索 ===

app.get('/v1/inboxes/:inboxId/search', (req, res) => {
  try {
    const inbox = getInboxById(req.params.inboxId, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });

    const { q, limit = 20 } = req.query;
    if (!q) return res.status(400).json({ error: 'q (query) is required' });

    const results = searchEmails({ inboxId: inbox.id, query: q, limit: parseInt(limit) });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 线程 ===

app.get('/v1/inboxes/:inboxId/threads', (req, res) => {
  try {
    const inbox = getInboxById(req.params.inboxId, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });

    const { limit = 20, offset = 0 } = req.query;
    const threads = getThreads({ inboxId: inbox.id, limit: parseInt(limit), offset: parseInt(offset) });
    res.json(threads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/inboxes/:inboxId/threads/:threadId', (req, res) => {
  try {
    const inbox = getInboxById(req.params.inboxId, req.user.id);
    if (!inbox) return res.status(404).json({ error: 'Inbox not found' });

    const messages = getThreadMessages(req.params.threadId, inbox.id);
    res.json({ thread_id: req.params.threadId, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 标签 ===

app.post('/v1/labels', (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const label = createLabel({ userId: req.user.id, name, color });
    res.status(201).json(label);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Label already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/labels', (req, res) => {
  try {
    res.json(getLabels(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/labels/:id', (req, res) => {
  try {
    deleteLabel(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/messages/:id/labels', (req, res) => {
  try {
    const { label_id } = req.body;
    if (!label_id) return res.status(400).json({ error: 'label_id is required' });
    addLabelToEmail(req.params.id, label_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/messages/:id/labels/:labelId', (req, res) => {
  try {
    removeLabelFromEmail(req.params.id, req.params.labelId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 自定义域名 ===

app.post('/v1/domains', (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    // 付费功能检查
    if (req.user.plan === 'free') {
      return res.status(403).json({ error: 'Custom domains require a paid plan' });
    }

    const result = addCustomDomain({ userId: req.user.id, domain });
    res.status(201).json({
      ...result,
      instructions: {
        txt_record: {
          type: 'TXT',
          name: `_clawaimail.${domain}`,
          value: result.verification_token
        }
      }
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Domain already registered' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/domains', (req, res) => {
  try {
    res.json(getCustomDomains(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/domains/:id/verify', async (req, res) => {
  try {
    const domains = getCustomDomains(req.user.id);
    const domain = domains.find(d => d.id === parseInt(req.params.id));
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    // 检查 DNS TXT 记录
    const { promises: dns } = await import('dns');
    try {
      const records = await dns.resolveTxt(`_clawaimail.${domain.domain}`);
      const flat = records.map(r => r.join('')).flat();
      if (flat.includes(domain.verification_token)) {
        verifyCustomDomain(domain.id);
        res.json({ verified: true });
      } else {
        res.json({ verified: false, message: 'TXT record not found. Please add the verification record.' });
      }
    } catch {
      res.json({ verified: false, message: 'DNS lookup failed. Make sure the TXT record is set.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/domains/:id', (req, res) => {
  try {
    deleteCustomDomain(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Webhooks ===

app.post('/v1/webhooks', (req, res) => {
  try {
    const { url, events } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const webhook = createWebhook({ userId: req.user.id, url, events: events || ['email_received'] });
    res.json(webhook);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/webhooks', (req, res) => {
  try {
    res.json(getWebhooks(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/webhooks/:id', (req, res) => {
  try {
    deleteWebhook(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 计费 ===

app.post('/v1/billing/checkout', async (req, res) => {
  try {
    const { plan, success_url, cancel_url } = req.body;
    if (!plan) return res.status(400).json({ error: 'plan is required (pro or business)' });
    const result = await createCheckoutSession(req.user.id, plan, success_url, cancel_url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === API Keys ===

app.get('/v1/api-keys', (req, res) => {
  try {
    res.json(getApiKeys(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/api-keys', (req, res) => {
  try {
    const { name } = req.body;
    const apiKey = createApiKey(req.user.id, name || 'unnamed');
    res.status(201).json(apiKey);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/api-keys/:id', (req, res) => {
  try {
    deleteApiKey(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 启动服务器 ===

const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`ClawAIMail API running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/v1/ws?key=pb_xxx`);
});
