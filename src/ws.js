import { WebSocketServer } from 'ws';
import { getUserByApiKey } from './db.js';

let wss;
// userId -> Set<ws>
const clients = new Map();

export function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/v1/ws' });

  wss.on('connection', (ws, req) => {
    // 从 URL 参数获取 API Key: /v1/ws?key=pb_xxx
    const url = new URL(req.url, 'http://localhost');
    const key = url.searchParams.get('key');

    if (!key) {
      ws.close(4001, 'Missing API key');
      return;
    }

    const user = getUserByApiKey(key);
    if (!user) {
      ws.close(4003, 'Invalid API key');
      return;
    }

    ws._userId = user.id;

    if (!clients.has(user.id)) {
      clients.set(user.id, new Set());
    }
    clients.get(user.id).add(ws);

    ws.send(JSON.stringify({ type: 'connected', user_id: user.id }));

    ws.on('close', () => {
      const set = clients.get(user.id);
      if (set) {
        set.delete(ws);
        if (set.size === 0) clients.delete(user.id);
      }
    });

    // 心跳
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  // 30s 心跳检测
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

// 推送事件给指定用户
export function pushToUser(userId, event) {
  const set = clients.get(userId);
  if (!set) return;
  const data = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// 获取在线连接数
export function getOnlineCount() {
  let total = 0;
  for (const set of clients.values()) total += set.size;
  return total;
}
