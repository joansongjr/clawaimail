import 'dotenv/config';
import fs from 'fs';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { insertEmail, getInboxByAddress, getWebhooksByInboxAddress, getUserIdByInboxAddress } from './db.js';
import { pushToUser } from './ws.js';

const SMTP_PORT = process.env.SMTP_LISTEN_PORT || 2525;
const MAX_MESSAGE_SIZE = parseInt(process.env.MAX_MESSAGE_SIZE || '10485760'); // 10MB
const MAX_CONNECTIONS = parseInt(process.env.MAX_SMTP_CONNECTIONS || '50');

// TLS 配置（生产环境需要证书）
const tlsOptions = process.env.TLS_CERT ? {
  key: fs.readFileSync(process.env.TLS_KEY),
  cert: fs.readFileSync(process.env.TLS_CERT)
} : undefined;

const server = new SMTPServer({
  authOptional: true,
  size: MAX_MESSAGE_SIZE,
  maxClients: MAX_CONNECTIONS,
  banner: 'ClawAIMail SMTP',
  disabledCommands: ['AUTH'],  // 收件不需要认证
  ...(tlsOptions ? { secure: false, key: tlsOptions.key, cert: tlsOptions.cert } : {}),

  onConnect(session, cb) {
    console.log(`[SMTP] Connection from ${session.remoteAddress}`);
    cb();
  },

  onMailFrom(address, session, cb) {
    cb();
  },

  onRcptTo(address, session, cb) {
    const inbox = getInboxByAddress(address.address);
    if (!inbox) {
      console.log(`[SMTP] Rejected: unknown address ${address.address}`);
      return cb(new Error('550 No such user'));
    }
    // 把 inbox 挂到 session 上，onData 里用
    if (!session._inboxes) session._inboxes = [];
    session._inboxes.push(inbox);
    cb();
  },

  onData(stream, session, cb) {
    let size = 0;
    let chunks = [];

    stream.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_MESSAGE_SIZE) {
        stream.destroy();
        return cb(new Error('552 Message too large'));
      }
      chunks.push(chunk);
    });

    stream.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        const parsed = await simpleParser(raw);
        const inboxes = session._inboxes || [];

        for (const inbox of inboxes) {
          const email = {
            inboxId: inbox.id,
            messageId: parsed.messageId || `pawbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            direction: 'inbound',
            from: parsed.from?.text || session.envelope.mailFrom?.address,
            to: inbox.address,
            subject: parsed.subject || '(no subject)',
            text: parsed.text,
            html: parsed.html,
            attachments: parsed.attachments?.map(a => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.size
            })),
            threadId: parsed.inReplyTo || null
          };

          const id = insertEmail(email);
          console.log(`[SMTP] #${id} -> ${inbox.address}: "${email.subject}" from ${email.from}`);

          // WebSocket 实时推送
          const userId = getUserIdByInboxAddress(inbox.address);
          if (userId) {
            pushToUser(userId, {
              type: 'email_received',
              email: { id, inbox_id: inbox.id, from: email.from, to: email.to, subject: email.subject }
            });
          }

          // 异步通知 webhook，不阻塞 SMTP 响应
          notifyWebhooks(inbox.address, { ...email, id }).catch(err =>
            console.error('[Webhook] Error:', err.message)
          );
        }

        cb();
      } catch (err) {
        console.error('[SMTP] Parse error:', err.message);
        cb(err);
      }
    });
  }
});

async function notifyWebhooks(address, email) {
  const webhooks = getWebhooksByInboxAddress(address);
  for (const webhook of webhooks) {
    if (webhook.events.includes('email_received')) {
      try {
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'email_received',
            email: {
              id: email.id,
              inbox_id: email.inboxId,
              from: email.from,
              to: email.to,
              subject: email.subject,
              text: email.text?.substring(0, 500),
              received_at: new Date().toISOString()
            }
          }),
          signal: AbortSignal.timeout(10000) // 10s timeout
        });
        console.log(`[Webhook] ${webhook.url} -> ${res.status}`);
      } catch (err) {
        console.error(`[Webhook] ${webhook.url} failed: ${err.message}`);
      }
    }
  }
}

server.on('error', err => {
  console.error('[SMTP] Server error:', err.message);
});

server.listen(SMTP_PORT, () => {
  console.log(`ClawAIMail SMTP listening on port ${SMTP_PORT} (max ${MAX_MESSAGE_SIZE / 1024 / 1024}MB, max ${MAX_CONNECTIONS} connections)`);
});
