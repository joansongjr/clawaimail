# clawaimail

Official Node.js SDK for [ClawAIMail](https://clawaimail.com) -- email infrastructure for AI agents.

## Installation

```bash
npm install clawaimail
```

## Quick Start

```javascript
const { ClawAIMail } = require("clawaimail");

const client = new ClawAIMail({ apiKey: process.env.CLAWAIMAIL_API_KEY });

// Create a mailbox
const mailbox = await client.mailboxes.create({
  name: "my-agent",
  domain: "clawaimail.com",
});

// Send an email
await client.emails.send({
  from: mailbox.address,
  to: "user@example.com",
  subject: "Hello",
  text: "Sent from an AI agent.",
});

// Read incoming emails
const emails = await client.emails.list({ mailbox: mailbox.id, unread: true });
```

## Available Methods

### Emails

| Method | Description |
|--------|-------------|
| `client.emails.send(params)` | Send an email (text or HTML) |
| `client.emails.list(params)` | List emails for a mailbox, with optional filters |
| `client.emails.get(id)` | Retrieve a single email by ID |
| `client.emails.delete(id)` | Delete an email |
| `client.emails.search(params)` | Full-text search across email subject and body |
| `client.emails.markRead(id)` | Mark an email as read |
| `client.emails.reply(id, params)` | Reply to an existing email thread |

### Mailboxes

| Method | Description |
|--------|-------------|
| `client.mailboxes.create(params)` | Create a new mailbox |
| `client.mailboxes.list()` | List all mailboxes on the account |
| `client.mailboxes.get(id)` | Retrieve a mailbox by ID |
| `client.mailboxes.update(id, params)` | Update mailbox settings |
| `client.mailboxes.delete(id)` | Delete a mailbox |

### Webhooks

| Method | Description |
|--------|-------------|
| `client.webhooks.create(params)` | Register a webhook endpoint |
| `client.webhooks.list()` | List all registered webhooks |
| `client.webhooks.delete(id)` | Remove a webhook |

### Domains

| Method | Description |
|--------|-------------|
| `client.domains.list()` | List verified custom domains |
| `client.domains.verify(params)` | Verify a new custom domain |
| `client.domains.delete(id)` | Remove a custom domain |

### WebSocket

| Method | Description |
|--------|-------------|
| `client.ws.connect(params)` | Open a WebSocket connection for real-time events |
| `client.ws.on(event, callback)` | Listen for specific event types |
| `client.ws.close()` | Close the WebSocket connection |

## Configuration

```javascript
const client = new ClawAIMail({
  apiKey: "your-api-key",   // Required
  baseUrl: "https://api.clawaimail.com", // Optional, override for self-hosted
  timeout: 30000,           // Optional, request timeout in ms
});
```

## Documentation

Full API reference and guides: [clawaimail.com/docs](https://clawaimail.com/docs)

## License

MIT
