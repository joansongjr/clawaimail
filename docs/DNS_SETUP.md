# PawBox DNS 配置指南

购买域名后，需要配置以下 DNS 记录才能收发邮件。

假设域名为 `clawaimail.com`，服务器 IP 为 `1.2.3.4`。

## 必需的 DNS 记录

### 1. MX 记录（收件）
告诉其他邮件服务器把发给 @clawaimail.com 的邮件投递到你的服务器。

```
类型: MX
名称: @
值:   mail.clawaimail.com
优先级: 10
```

### 2. A 记录（指向服务器）
```
类型: A
名称: mail
值:   1.2.3.4
```

### 3. SPF 记录（防伪造）
告诉收件方哪些 IP 有权代表你发邮件。

```
类型: TXT
名称: @
值:   v=spf1 ip4:1.2.3.4 include:_spf.resend.com -all
```

如果用 Amazon SES 发件，改为：
```
值:   v=spf1 ip4:1.2.3.4 include:amazonses.com -all
```

### 4. DKIM 记录（签名验证）
DKIM 密钥由发件服务提供：
- Resend: 在 Resend 后台添加域名后会给你 DKIM 记录
- Amazon SES: 同上
- 自建: 用 opendkim 生成

### 5. DMARC 记录（策略）
```
类型: TXT
名称: _dmarc
值:   v=DMARC1; p=quarantine; rua=mailto:dmarc@clawaimail.com
```

### 6. rDNS / PTR 记录（反向解析）
需要在 VPS 提供商处设置，将 IP 反向解析到 mail.clawaimail.com。
这对邮件送达率很重要，很多邮件服务器会检查 PTR 记录。

## 验证

配置完成后，可以用以下工具验证：

```bash
# 检查 MX 记录
dig MX clawaimail.com

# 检查 SPF
dig TXT clawaimail.com

# 检查 DKIM
dig TXT default._domainkey.clawaimail.com

# 检查 DMARC
dig TXT _dmarc.clawaimail.com

# 在线工具
# https://mxtoolbox.com
# https://mail-tester.com (发一封测试邮件，会给你评分)
```

## 推荐的发件方式

| 方式 | 优点 | 缺点 | 适合 |
|------|------|------|------|
| Resend | 简单、送达率高、免费额度 | 有限额 | 起步阶段 |
| Amazon SES | 便宜($0.10/千封)、高吞吐 | 配置复杂 | 规模化 |
| 自建 Postfix | 完全控制 | 需要维护、容易进垃圾箱 | 有经验的运维 |

建议起步用 Resend（每月 3000 封免费），规模上来后切换到 Amazon SES。
