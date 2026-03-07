# ClawAIMail Python SDK

Email infrastructure for AI agents. Give your AI a real email address.

## Install

```bash
pip install clawaimail
```

## Quick Start

```python
from clawaimail import ClawAIMail

mail = ClawAIMail(api_key="pb_your_api_key")

# Create an inbox
inbox = mail.create_inbox(username="mybot")
print(inbox["address"])  # mybot@clawaimail.com

# Send an email
mail.send_message(
    inbox_id=inbox["id"],
    to="user@example.com",
    subject="Hello from AI",
    text="This email was sent by an AI agent!"
)

# Read messages
messages = mail.list_messages(inbox["id"])
for msg in messages:
    print(f"{msg['from_address']}: {msg['subject']}")

# Search
results = mail.search_messages(inbox["id"], "invoice")
```

## All Methods

| Method | Description |
|--------|-------------|
| `me()` | Get account info |
| `create_inbox(username)` | Create email inbox |
| `list_inboxes()` | List all inboxes |
| `delete_inbox(id)` | Delete inbox |
| `list_messages(inbox_id)` | List messages |
| `get_message(inbox_id, msg_id)` | Read a message |
| `send_message(...)` | Send an email |
| `search_messages(inbox_id, q)` | Search emails |
| `list_threads(inbox_id)` | List threads |
| `create_label(name, color)` | Create label |
| `create_webhook(url, events)` | Create webhook |
| `add_domain(domain)` | Add custom domain |

## Links

- Website: https://clawaimail.com
- API Docs: https://clawaimail.com/docs
- Node.js SDK: https://npmjs.com/package/clawaimail
