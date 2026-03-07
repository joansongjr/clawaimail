import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode


class ClawAIMail:
    def __init__(self, api_key: str, base_url: str = "https://api.clawaimail.com"):
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, body: dict = None):
        url = f"{self.base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        data = json.dumps(body).encode() if body else None
        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req) as resp:
                return json.loads(resp.read())
        except HTTPError as e:
            error_body = json.loads(e.read())
            raise Exception(error_body.get("error", f"HTTP {e.code}"))

    # User
    def me(self):
        return self._request("GET", "/v1/me")

    # Inboxes
    def create_inbox(self, username: str, display_name: str = None, domain: str = None):
        return self._request("POST", "/v1/inboxes", {
            "username": username,
            "display_name": display_name,
            "domain": domain,
        })

    def list_inboxes(self):
        return self._request("GET", "/v1/inboxes")

    def get_inbox(self, inbox_id: int):
        return self._request("GET", f"/v1/inboxes/{inbox_id}")

    def delete_inbox(self, inbox_id: int):
        return self._request("DELETE", f"/v1/inboxes/{inbox_id}")

    # Messages
    def list_messages(self, inbox_id: int, limit: int = 50, offset: int = 0, unread: bool = False):
        params = urlencode({"limit": limit, "offset": offset, **({"unread": "true"} if unread else {})})
        return self._request("GET", f"/v1/inboxes/{inbox_id}/messages?{params}")

    def get_message(self, inbox_id: int, message_id: int):
        return self._request("GET", f"/v1/inboxes/{inbox_id}/messages/{message_id}")

    def send_message(self, inbox_id: int, to: str, subject: str, text: str = None, html: str = None, thread_id: str = None):
        return self._request("POST", "/v1/messages/send", {
            "inbox_id": inbox_id,
            "to": to,
            "subject": subject,
            "text": text,
            "html": html,
            "thread_id": thread_id,
        })

    def search_messages(self, inbox_id: int, query: str, limit: int = 20):
        params = urlencode({"q": query, "limit": limit})
        return self._request("GET", f"/v1/inboxes/{inbox_id}/search?{params}")

    # Threads
    def list_threads(self, inbox_id: int, limit: int = 20, offset: int = 0):
        params = urlencode({"limit": limit, "offset": offset})
        return self._request("GET", f"/v1/inboxes/{inbox_id}/threads?{params}")

    def get_thread(self, inbox_id: int, thread_id: str):
        return self._request("GET", f"/v1/inboxes/{inbox_id}/threads/{thread_id}")

    # Labels
    def create_label(self, name: str, color: str = None):
        return self._request("POST", "/v1/labels", {"name": name, "color": color})

    def list_labels(self):
        return self._request("GET", "/v1/labels")

    def delete_label(self, label_id: int):
        return self._request("DELETE", f"/v1/labels/{label_id}")

    def add_label(self, message_id: int, label_id: int):
        return self._request("POST", f"/v1/messages/{message_id}/labels", {"label_id": label_id})

    def remove_label(self, message_id: int, label_id: int):
        return self._request("DELETE", f"/v1/messages/{message_id}/labels/{label_id}")

    # Domains
    def add_domain(self, domain: str):
        return self._request("POST", "/v1/domains", {"domain": domain})

    def list_domains(self):
        return self._request("GET", "/v1/domains")

    def verify_domain(self, domain_id: int):
        return self._request("POST", f"/v1/domains/{domain_id}/verify")

    def delete_domain(self, domain_id: int):
        return self._request("DELETE", f"/v1/domains/{domain_id}")

    # Webhooks
    def create_webhook(self, url: str, events: list = None):
        return self._request("POST", "/v1/webhooks", {"url": url, "events": events or ["email_received"]})

    def list_webhooks(self):
        return self._request("GET", "/v1/webhooks")

    def delete_webhook(self, webhook_id: int):
        return self._request("DELETE", f"/v1/webhooks/{webhook_id}")
