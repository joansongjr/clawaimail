export class ClawAIMail {
  constructor({ apiKey, baseUrl = 'https://api.clawaimail.com' }) {
    if (!apiKey) throw new Error('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async _request(method, path, body) {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // === User ===

  me() {
    return this._request('GET', '/v1/me');
  }

  // === Inboxes ===

  createInbox({ username, displayName, domain } = {}) {
    return this._request('POST', '/v1/inboxes', {
      username,
      display_name: displayName,
      domain
    });
  }

  listInboxes() {
    return this._request('GET', '/v1/inboxes');
  }

  getInbox(id) {
    return this._request('GET', `/v1/inboxes/${id}`);
  }

  deleteInbox(id) {
    return this._request('DELETE', `/v1/inboxes/${id}`);
  }

  // === Messages ===

  listMessages(inboxId, { limit = 50, offset = 0, unread } = {}) {
    const params = new URLSearchParams({ limit, offset });
    if (unread) params.set('unread', 'true');
    return this._request('GET', `/v1/inboxes/${inboxId}/messages?${params}`);
  }

  getMessage(inboxId, messageId) {
    return this._request('GET', `/v1/inboxes/${inboxId}/messages/${messageId}`);
  }

  sendMessage({ inboxId, to, subject, text, html, threadId }) {
    return this._request('POST', '/v1/messages/send', {
      inbox_id: inboxId,
      to, subject, text, html,
      thread_id: threadId
    });
  }

  searchMessages(inboxId, query, { limit = 20 } = {}) {
    const params = new URLSearchParams({ q: query, limit });
    return this._request('GET', `/v1/inboxes/${inboxId}/search?${params}`);
  }

  // === Threads ===

  listThreads(inboxId, { limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams({ limit, offset });
    return this._request('GET', `/v1/inboxes/${inboxId}/threads?${params}`);
  }

  getThread(inboxId, threadId) {
    return this._request('GET', `/v1/inboxes/${inboxId}/threads/${threadId}`);
  }

  // === Labels ===

  createLabel({ name, color }) {
    return this._request('POST', '/v1/labels', { name, color });
  }

  listLabels() {
    return this._request('GET', '/v1/labels');
  }

  deleteLabel(id) {
    return this._request('DELETE', `/v1/labels/${id}`);
  }

  addLabel(messageId, labelId) {
    return this._request('POST', `/v1/messages/${messageId}/labels`, { label_id: labelId });
  }

  removeLabel(messageId, labelId) {
    return this._request('DELETE', `/v1/messages/${messageId}/labels/${labelId}`);
  }

  // === Domains ===

  addDomain(domain) {
    return this._request('POST', '/v1/domains', { domain });
  }

  listDomains() {
    return this._request('GET', '/v1/domains');
  }

  verifyDomain(id) {
    return this._request('POST', `/v1/domains/${id}/verify`);
  }

  deleteDomain(id) {
    return this._request('DELETE', `/v1/domains/${id}`);
  }

  // === Webhooks ===

  createWebhook({ url, events }) {
    return this._request('POST', '/v1/webhooks', { url, events });
  }

  listWebhooks() {
    return this._request('GET', '/v1/webhooks');
  }

  deleteWebhook(id) {
    return this._request('DELETE', `/v1/webhooks/${id}`);
  }

  // === API Keys ===

  createApiKey(name) {
    return this._request('POST', '/v1/api-keys', { name });
  }

  listApiKeys() {
    return this._request('GET', '/v1/api-keys');
  }

  deleteApiKey(id) {
    return this._request('DELETE', `/v1/api-keys/${id}`);
  }
}

export default ClawAIMail;
