#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomBytes } from 'crypto';

const API_KEY = process.env.CLAWAIMAIL_API_KEY;
const BASE_URL = process.env.CLAWAIMAIL_BASE_URL || 'https://api.clawaimail.com';

// Warn if API key is missing
if (!API_KEY) {
  console.error('[clawaimail] WARNING: CLAWAIMAIL_API_KEY not set. All API calls will fail.');
}

// Log unhandled errors and exit cleanly
process.on('uncaughtException', (err) => {
  console.error('[clawaimail] Uncaught exception:', err.message);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[clawaimail] Unhandled rejection:', err?.message || err);
  process.exit(1);
});

// Flexible ID schema: accepts number or numeric string
const idSchema = z.union([
  z.number(),
  z.string().transform((v) => {
    const n = Number(v);
    if (isNaN(n)) throw new Error(`Invalid ID: ${v}`);
    return n;
  })
]).describe('ID (number or numeric string)');

async function api(method, path, body) {
  try {
    if (!API_KEY) {
      return { error: 'CLAWAIMAIL_API_KEY not configured. Set it in your environment variables.' };
    }
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE_URL}${path}`, opts);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { error: `Server returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}` };
    }
    if (!res.ok) {
      return { error: data?.message || data?.error || `HTTP ${res.status}`, status: res.status, details: data };
    }
    return data;
  } catch (err) {
    return { error: `Request failed: ${err.message}` };
  }
}

// === Default inbox auto-provisioning ===
// Cached default inbox so we don't query every time
let _defaultInbox = null;

async function getExistingInboxes() {
  const list = await api('GET', '/v1/inboxes');
  if (list.error) return { error: list.error };
  return list.inboxes || list.data || list;
}

async function getDefaultInbox() {
  if (_defaultInbox) return _defaultInbox;

  const inboxes = await getExistingInboxes();
  if (inboxes.error) return { error: inboxes.error };

  if (Array.isArray(inboxes) && inboxes.length > 0) {
    _defaultInbox = inboxes[0];
    return _defaultInbox;
  }

  // No inboxes — return null so callers can decide what to do
  return null;
}

// Try to create an inbox with the preferred name, auto-append suffix if taken
async function createInboxWithName(preferredName) {
  // Try the exact name first
  const result = await api('POST', '/v1/inboxes', { username: preferredName });
  if (!result.error) {
    _defaultInbox = result.inbox || result;
    return _defaultInbox;
  }

  // If taken, try with short random suffix (up to 3 attempts)
  if (result.error?.includes('already taken') || result.status === 409) {
    for (let i = 0; i < 3; i++) {
      const suffix = randomBytes(2).toString('hex');
      const altName = `${preferredName}-${suffix}`;
      const alt = await api('POST', '/v1/inboxes', { username: altName });
      if (!alt.error) {
        _defaultInbox = alt.inbox || alt;
        return { ..._defaultInbox, note: `"${preferredName}" was taken, created "${altName}" instead.` };
      }
    }
    return { error: `"${preferredName}" is taken and could not find an available alternative.` };
  }

  return result; // other error
}

// Fallback: create with random name (only used when no preferred name given)
async function autoCreateInbox() {
  const randomName = `agent-${randomBytes(4).toString('hex')}`;
  console.error(`[clawaimail] Auto-creating inbox: ${randomName}@clawaimail.com`);
  const created = await api('POST', '/v1/inboxes', { username: randomName });
  if (created.error) return { error: `Failed to auto-create inbox: ${created.error}` };
  _defaultInbox = created.inbox || created;
  return _defaultInbox;
}

// Get or create default inbox (used by send/list/read when no inbox_id given)
// If no inbox exists, prompt the user to choose a name instead of auto-creating
async function getOrCreateDefaultInbox() {
  const inbox = await getDefaultInbox();
  if (inbox) return inbox;
  if (inbox?.error) return inbox;
  return {
    error: 'NO_INBOX',
    message: 'You don\'t have an email inbox yet! Let\'s set one up first.',
    action: 'Ask the user what name they want for their email address, then call my_email(preferred_name: "theirname") to create it. For example: jarvis@clawaimail.com, assistant@clawaimail.com, etc.',
    hint: 'The user can choose any name — if it\'s taken, a similar alternative will be suggested.'
  };
}

function inboxId(inbox) {
  return inbox?.id || inbox?.inbox_id;
}

const server = new McpServer({
  name: 'clawaimail',
  version: '0.2.1'
});

// === Tools ===

server.tool(
  'list_inboxes',
  'List all email inboxes',
  {},
  async () => {
    const result = await api('GET', '/v1/inboxes');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'create_inbox',
  'Create a new email inbox (optional — a default inbox is auto-created if needed)',
  { username: z.string().describe('Email username (e.g. "mybot" creates mybot@clawaimail.com)') },
  async ({ username }) => {
    const result = await api('POST', '/v1/inboxes', { username });
    if (!result.error) _defaultInbox = null; // reset cache
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'send_email',
  'Send an email with optional attachments. If inbox_id is omitted, uses the default inbox. Attachments: pass an array of { filename, content (base64), content_type }. Max 5MB per file, 10MB total.',
  {
    inbox_id: idSchema.optional().describe('Inbox ID to send from (optional, uses default inbox)'),
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject'),
    text: z.string().optional().describe('Plain text body'),
    html: z.string().optional().describe('HTML body'),
    attachments: z.array(z.object({
      filename: z.string().describe('File name (e.g. "report.pdf")'),
      content: z.string().describe('File content as base64 string'),
      content_type: z.string().optional().describe('MIME type (e.g. "application/pdf"). Defaults to application/octet-stream')
    })).optional().describe('File attachments (max 5MB each, 10MB total)')
  },
  async ({ inbox_id, to, subject, text, html, attachments }) => {
    if (!inbox_id) {
      const inbox = await getOrCreateDefaultInbox();
      if (inbox.error) return { content: [{ type: 'text', text: JSON.stringify(inbox, null, 2) }] };
      inbox_id = inboxId(inbox);
    }
    const result = await api('POST', '/v1/messages/send', { inbox_id, to, subject, text, html, attachments });
    if (!result.error) {
      result.tip = 'Email sent! Use list_messages() to check for replies later.';
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'list_messages',
  'List messages. If inbox_id is omitted, uses the default inbox.',
  {
    inbox_id: idSchema.optional().describe('Inbox ID (optional, uses default inbox)'),
    limit: z.number().optional().describe('Max messages to return (default 20)'),
    unread: z.boolean().optional().describe('Only show unread messages')
  },
  async ({ inbox_id, limit = 20, unread }) => {
    if (!inbox_id) {
      const inbox = await getOrCreateDefaultInbox();
      if (inbox.error) return { content: [{ type: 'text', text: JSON.stringify(inbox, null, 2) }] };
      inbox_id = inboxId(inbox);
    }
    const params = new URLSearchParams({ limit: String(limit) });
    if (unread) params.set('unread', 'true');
    const result = await api('GET', `/v1/inboxes/${inbox_id}/messages?${params}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'read_email',
  'Read a specific email message. If inbox_id is omitted, uses the default inbox.',
  {
    inbox_id: idSchema.optional().describe('Inbox ID (optional, uses default inbox)'),
    message_id: idSchema.describe('Message ID')
  },
  async ({ inbox_id, message_id }) => {
    if (!inbox_id) {
      const inbox = await getOrCreateDefaultInbox();
      if (inbox.error) return { content: [{ type: 'text', text: JSON.stringify(inbox, null, 2) }] };
      inbox_id = inboxId(inbox);
    }
    const result = await api('GET', `/v1/inboxes/${inbox_id}/messages/${message_id}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'search_emails',
  'Search emails by keyword. If inbox_id is omitted, uses the default inbox.',
  {
    inbox_id: idSchema.optional().describe('Inbox ID (optional, uses default inbox)'),
    query: z.string().describe('Search query')
  },
  async ({ inbox_id, query }) => {
    if (!inbox_id) {
      const inbox = await getOrCreateDefaultInbox();
      if (inbox.error) return { content: [{ type: 'text', text: JSON.stringify(inbox, null, 2) }] };
      inbox_id = inboxId(inbox);
    }
    const params = new URLSearchParams({ q: query });
    const result = await api('GET', `/v1/inboxes/${inbox_id}/search?${params}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_inbox',
  'Delete an inbox and all its messages',
  { inbox_id: idSchema.describe('Inbox ID to delete') },
  async ({ inbox_id }) => {
    const result = await api('DELETE', `/v1/inboxes/${inbox_id}`);
    if (!result.error) _defaultInbox = null; // reset cache
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'account_info',
  'Get account info, plan limits, and usage',
  {},
  async () => {
    const result = await api('GET', '/v1/me');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'my_email',
  'Get or create your agent\'s email address. Pass preferred_name to choose your email prefix (e.g. "jarvis" → jarvis@clawaimail.com). If no name given and no inbox exists, a random one is created.',
  {
    preferred_name: z.string().optional().describe('Your preferred email prefix (e.g. "jarvis" creates jarvis@clawaimail.com). If taken, a similar name will be tried.')
  },
  async ({ preferred_name }) => {
    // Check existing inboxes first
    const existing = await getDefaultInbox();

    // If user has an inbox already and didn't ask for a new name, return it
    if (existing && !existing.error && !preferred_name) {
      const email = existing.email || existing.address;
      return { content: [{ type: 'text', text: JSON.stringify({
        email,
        inbox_id: inboxId(existing),
        quick_start: [
          `Your email address is: ${email}`,
          'Send an email: use send_email(to, subject, text)',
          'Check inbox: use list_messages()',
          'New here? Call getting_started() for a full guide'
        ],
        ...existing
      }, null, 2) }] };
    }

    // User wants a specific name, or has no inbox yet
    let inbox;
    if (preferred_name) {
      inbox = await createInboxWithName(preferred_name);
    } else if (!existing) {
      inbox = await autoCreateInbox();
    } else {
      inbox = existing;
    }

    if (inbox.error) return { content: [{ type: 'text', text: JSON.stringify(inbox, null, 2) }] };

    const email = inbox.email || inbox.address;
    const response = {
      email,
      inbox_id: inboxId(inbox),
      quick_start: [
        `Your email address is: ${email}`,
        'Send an email: use send_email(to, subject, text)',
        'Check inbox: use list_messages()',
        'New here? Call getting_started() for a full guide'
      ]
    };
    if (inbox.note) response.note = inbox.note;
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }
);

server.tool(
  'getting_started',
  'Interactive onboarding guide for ClawAIMail. Shows you everything you can do with your AI email, step by step.',
  {
    level: z.enum(['beginner', 'advanced']).optional().describe('Guide level: "beginner" (default) for basics, "advanced" for power features')
  },
  async ({ level = 'beginner' }) => {
    const inbox = await getDefaultInbox();
    const hasInbox = inbox && !inbox.error;
    const email = hasInbox ? (inbox.email || inbox.address) : null;

    if (level === 'advanced') {
      return { content: [{ type: 'text', text: JSON.stringify({
        title: '🚀 ClawAIMail Advanced Features',
        features: [
          {
            name: 'Multiple Inboxes',
            description: 'Create separate inboxes for different purposes (support, notifications, personal)',
            tool: 'create_inbox',
            example: { username: 'support' },
            result: 'Creates support@clawaimail.com'
          },
          {
            name: 'Custom Domains',
            description: 'Want bot@yourdomain.com instead of bot@clawaimail.com? Paid plan users can add their own domain. Steps: 1) POST /v1/domains { domain: "yourdomain.com" } 2) Add the DNS TXT record provided 3) POST /v1/domains/:id/verify to confirm',
            api_endpoint: 'POST /v1/domains',
            requires: 'Pro plan ($29/mo) or above',
            steps: [
              'Call POST /v1/domains with your domain name',
              'Add the TXT record to your DNS: _clawaimail.yourdomain.com → verification token',
              'Call POST /v1/domains/:id/verify to complete',
              'Now create inboxes with: create_inbox(username: "bot", domain: "yourdomain.com")'
            ]
          },
          {
            name: 'Email Search',
            description: 'Search emails by keyword across subject, body, and sender',
            tool: 'search_emails',
            example: { query: 'invoice' }
          },
          {
            name: 'Webhooks',
            description: 'Get HTTP notifications when new emails arrive. Set up via the REST API: POST /v1/webhooks with { url, events: ["email_received"] }',
            api_endpoint: 'POST /v1/webhooks'
          },
          {
            name: 'WebSocket Real-time',
            description: 'Connect to ws://api.clawaimail.com/v1/ws?key=YOUR_API_KEY for real-time email notifications',
            protocol: 'WebSocket'
          },
          {
            name: 'Account & Limits',
            description: 'Check your plan, usage, and limits',
            tool: 'account_info'
          }
        ],
        plans: {
          free: '3 inboxes, 3K emails/month, 100 sends/day',
          starter: '$5/mo — 10 inboxes, 5K emails/month, unlimited sends',
          pro: '$29/mo — 50 inboxes, 50K emails/month, custom domains',
          business: '$99/mo — 200 inboxes, 200K emails/month, everything unlimited'
        },
        tip: 'Want a custom domain like @yourstartup.com? Upgrade to Pro and follow the Custom Domains steps above.'
      }, null, 2) }] };
    }

    // Beginner guide — step 1 depends on whether user already has an inbox
    const step1 = hasInbox
      ? {
          step: 1,
          title: '✉️ Your Email is Ready',
          description: `Your email address is ${email}. Anyone can send emails to this address and you'll receive them.`,
          done: true,
          tip: 'Want a different name? Call my_email(preferred_name: "yourname") to create a new one.'
        }
      : {
          step: 1,
          title: '✉️ Choose Your Email Name',
          description: 'First, pick a name for your email address! Call my_email(preferred_name: "yourname") to create yourname@clawaimail.com. Pick something memorable — this is your agent\'s identity.',
          tool: 'my_email',
          example: { preferred_name: 'jarvis' },
          result: 'Creates jarvis@clawaimail.com (or jarvis-xxxx@clawaimail.com if taken)',
          done: false
        };

    return { content: [{ type: 'text', text: JSON.stringify({
      title: '📬 Welcome to ClawAIMail!',
      subtitle: 'Your AI agent now has its own email address. Follow these steps to get started:',
      your_email: email || '(not created yet — complete step 1!)',
      steps: [
        step1,
        {
          step: 2,
          title: '📤 Send Your First Email',
          description: 'Try sending an email to yourself or someone you know.',
          tool: 'send_email',
          example: {
            to: 'someone@gmail.com',
            subject: 'Hello from my AI agent!',
            text: 'This email was sent by my AI agent using ClawAIMail.'
          }
        },
        {
          step: 3,
          title: '📥 Check Your Inbox',
          description: 'See all emails you\'ve received. Ask someone to send a test email to your address!',
          tool: 'list_messages',
          tip: 'Use unread: true to see only new messages'
        },
        {
          step: 4,
          title: '🔍 Search Emails',
          description: 'Find specific emails by keyword.',
          tool: 'search_emails',
          example: { query: 'hello' }
        }
      ],
      next: 'Want more? Call getting_started(level: "advanced") to learn about custom domains (use your own @yourdomain.com!), webhooks, multiple inboxes, and more.',
      custom_domain_hint: 'Pro tip: Paid users can use their own domain — e.g. bot@yourstartup.com. Call getting_started(level: "advanced") for details.',
      help: 'https://clawaimail.com/docs'
    }, null, 2) }] };
  }
);

// === Start ===

const transport = new StdioServerTransport();
await server.connect(transport);
