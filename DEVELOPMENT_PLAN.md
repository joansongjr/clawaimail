# Agent Mail SaaS - 开发计划

> 目标：构建一个面向 AI Agent 的邮件 SaaS 服务，类似 agentmail.to
> 项目位置：/Users/apple/pearbot/agent-mail

---

## 一、产品定位

- 给 AI Agent 提供邮箱地址，支持收发邮件
- API-first，开发者通过 API/SDK 接入
- 支持 MCP 协议，可直接接入 OpenClaw/Claude Code/Cursor 等
- 免费版 + 付费版（Freemium 模式）

### 差异化方向（可选）
- 中国市场友好（中文文档、国内部署、支持国内支付）
- 深度 OpenClaw 集成
- 集成飞书/微信/钉钉通知
- 更低价格

---

## 二、功能规划

### 免费版
- 3 个邮箱（使用平台域名，如 bot@yourplatform.com）
- 收发邮件 API
- 100 封/天 发送限额
- Webhook 通知（1 个）
- 基础 API 访问

### 付费版
- 无限邮箱
- 自定义域名
- 更高发送限额（1000+/天）
- 多 Webhook
- WebSocket 实时通知
- 语义搜索
- 邮件数据提取（从邮件中提取结构化数据）
- 草稿审核（human-in-the-loop）
- 附件管理
- 优先支持

---

## 三、技术架构

```
                        用户/Agent
                            |
                     [API Gateway]
                      /    |    \
                     /     |     \
              [REST API] [MCP]  [WebSocket]
                     \     |     /
                      \    |    /
                    [核心业务层]
                   /    |    |    \
            [邮箱管理] [邮件处理] [用户系统] [计费系统]
                   \    |    |    /
                    [数据存储层]
                   /      |      \
            [PostgreSQL] [Redis] [对象存储(附件)]
                          |
                    [邮件服务器]
                   /            \
            [SMTP 收件]    [SMTP 发件]
            (Haraka/      (SES/Postmark
             Stalwart)     /自建)
```

---

## 四、开发阶段

### Phase 0：修复现有代码（1-2 天）
- [ ] 修复 .env.example 中 SMTP_PORT 重复问题
- [ ] 添加缺失的 POST /send 路由
- [ ] smtp-server.js 添加 dotenv 加载
- [ ] 修复 smtp-server 依赖（simple-smtp-server vs smtp-server）
- [ ] 本地跑通收发邮件流程

### Phase 1：核心 API 重构（1-2 周）
目标：把单机项目重构为可扩展的 SaaS 架构

- [ ] 切换数据库：SQLite -> PostgreSQL
- [ ] 用户系统：注册、登录、API Key 管理
- [ ] 多租户：每个用户独立的邮箱空间
- [ ] 邮箱管理 API：创建/删除/列出邮箱
- [ ] 重构邮件收发 API：
  - POST /v1/inboxes - 创建邮箱
  - GET  /v1/inboxes - 列出邮箱
  - POST /v1/messages/send - 发送邮件
  - GET  /v1/messages - 获取邮件列表
  - GET  /v1/messages/:id - 获取单封邮件
  - GET  /v1/threads - 线程管理
- [ ] API Key 认证中间件
- [ ] 请求频率限制（rate limiting）
- [ ] 输入验证

### Phase 2：邮件服务器（1-2 周）
目标：正式的邮件收发能力

- [ ] 部署邮件服务器（推荐 Haraka 或 Stalwart）
- [ ] 配置域名 DNS（MX、SPF、DKIM、DMARC）
- [ ] 入站邮件处理：接收 -> 解析 -> 路由到对应邮箱 -> 存储
- [ ] 出站邮件：集成 Amazon SES 或 Postmark（保证送达率）
- [ ] 退信/投诉处理
- [ ] 附件存储（S3 或兼容的对象存储）

### Phase 3：高级功能（2-3 周）
- [ ] Webhook 系统完善（事件：received/sent/delivered/bounced）
- [ ] WebSocket 实时通知
- [ ] 自定义域名支持（用户绑定自己的域名）
- [ ] 邮件线程（threading）支持
- [ ] 草稿功能（human-in-the-loop 审核）
- [ ] 标签系统（Labels）
- [ ] 邮件搜索

### Phase 4：SDK 和集成（1-2 周）
- [ ] Node.js SDK（TypeScript）
- [ ] Python SDK
- [ ] MCP Server（让 OpenClaw/Claude Code 等直接调用）
- [ ] OpenClaw 插件
- [ ] API 文档站（用 Mintlify 或 Fern）

### Phase 5：商业化（1-2 周）
- [ ] 计费系统（Stripe 或国内支付）
- [ ] 用量统计和配额管理
- [ ] 用户控制台（Web Dashboard）
  - 邮箱管理
  - API Key 管理
  - 用量查看
  - 账单管理
- [ ] 落地页（Landing Page）

### Phase 6：部署上线
- [ ] 服务器选择（VPS/云服务器，需要固定 IP）
- [ ] Docker 化部署
- [ ] CI/CD 流水线
- [ ] 监控和告警
- [ ] 日志系统

---

## 五、技术栈选择

| 组件 | 推荐 | 备选 |
|------|------|------|
| 后端框架 | Express.js / Fastify | Hono |
| 数据库 | PostgreSQL | - |
| 缓存 | Redis | - |
| 邮件服务器 | Haraka (Node.js) | Stalwart (Rust) |
| 出站邮件 | Amazon SES | Postmark / Resend |
| 对象存储 | S3 | MinIO (自建) |
| 认证 | API Key + JWT | - |
| 支付 | Stripe | LemonSqueezy |
| 文档 | Fern / Mintlify | - |
| 部署 | Docker + VPS | - |
| 语言 | Node.js (TypeScript) | - |

---

## 六、API 设计参考

```
认证：所有请求需要 Header: Authorization: Bearer <api_key>

# 邮箱
POST   /v1/inboxes                  创建邮箱
GET    /v1/inboxes                  列出邮箱
GET    /v1/inboxes/:id              获取邮箱详情
DELETE /v1/inboxes/:id              删除邮箱

# 邮件
POST   /v1/messages/send            发送邮件
GET    /v1/inboxes/:id/messages     获取某邮箱的邮件列表
GET    /v1/messages/:id             获取邮件详情
DELETE /v1/messages/:id             删除邮件

# 线程
GET    /v1/threads                  获取线程列表
GET    /v1/threads/:id              获取线程详情

# Webhook
POST   /v1/webhooks                 注册 webhook
GET    /v1/webhooks                 列出 webhooks
DELETE /v1/webhooks/:id             删除 webhook

# 域名
POST   /v1/domains                  添加自定义域名
GET    /v1/domains                  列出域名
GET    /v1/domains/:id/verify       验证域名 DNS 配置

# 用户
POST   /v1/auth/register            注册
POST   /v1/auth/login               登录
GET    /v1/api-keys                  列出 API Key
POST   /v1/api-keys                 创建 API Key
DELETE /v1/api-keys/:id             删除 API Key
```

---

## 七、当前状态

现有代码（MiniMax 生成）存在以下问题，需要在 Phase 0 修复：
1. POST /send 路由缺失（mailer.js 写了但没接入）
2. .env.example 中 SMTP_PORT 定义了两次（收件和发件冲突）
3. smtp-server.js 没有加载 dotenv
4. 依赖包名不匹配（装了 simple-smtp-server，代码用的 smtp-server）
5. 无 API 认证
6. 数据库每次写入都全量导出（性能差）

---

## 八、下一步行动

1. 先完成 Phase 0，把现有代码修好跑起来
2. 然后进入 Phase 1 重构为 SaaS 架构
3. 购买域名（建议：简短好记，如 xxxmail.com）
4. 租一台有固定 IP 的 VPS（用于部署邮件服务器）
