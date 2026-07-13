# 部署手册（U-3 / E14，PLAN v5）

把 Echo Research 从本机搬到一台小 VPS，开给 ≤10 人的邀请制 beta。全程零新增运行时依赖，
Node + SQLite + Caddy 三件套。**前置：E11 安全底座与 U-1 鉴权必须已合入 main（红线 19）。**

## 0. 选机器

- **区域选香港或新加坡**——巨潮资讯网（A 股一手财报）和腾讯/新浪行情从欧美机房访问不稳定，这是实测约束不是偏好。
- 规格 2C4G 足够（SQLite 单进程；LLM 推理在外部 API）。
- 系统 Ubuntu 22.04+ / Debian 12+，装 Node ≥ 20（better-sqlite3 需要）。

## 1. 装应用

```bash
# 服务器上
sudo useradd -r -m -d /opt/echo-research echo
sudo -u echo git clone https://github.com/EchoResearchLab/Echo.git /opt/echo-research
cd /opt/echo-research
sudo -u echo npm install --omit=dev
sudo -u echo npm run seed          # 首次建库（生产库就是 /opt/echo-research/echo.db）
```

`.env` 手工放到 `/opt/echo-research/.env`（**scp 传，不进 git，红线 20**），内容同本机，另加：

```text
ECHO_TRUST_PROXY=1                # 信任 Caddy 的 X-Forwarded-For；cookie 带 Secure
ECHO_BETA_MODE=1                  # 免费邀请制 beta；取得商用数据授权后改用 ECHO_COMMERCIAL_DATA=1
ECHO_BACKUP_PUSH_CMD=rclone copy {file} b2:echo-backups/   # 异地备份（见 §4）
ECHO_DAILY_MODEL_CALLS=40         # 每位用户每日成功模型调用上限
ECHO_INPUT_USD_PER_M_TOKENS=0     # 按实际供应商合同填写；0 表示只记 token、不估成本
ECHO_OUTPUT_USD_PER_M_TOKENS=0
```

## 2. systemd + Caddy

```bash
sudo cp deploy/echo-research.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now echo-research

# Caddy（官方 apt 源装好后）
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # 先把域名改成你的
sudo systemctl reload caddy
```

域名 A 记录指到 VPS IP，Caddy 自动签 HTTPS。Node 只听 127.0.0.1:4173，公网只见 Caddy。

## 3. 开启多用户模式 + 发邀请

```bash
cd /opt/echo-research
sudo -u echo node scripts/manage-users.js create-owner arlan <你的密码>
sudo -u echo node scripts/manage-users.js invite-batch 10 beta-2026-07
sudo -u echo node scripts/manage-users.js list
sudo -u echo npm run doctor:prod   # 必须 0 退出后再开放域名
```

建 owner 前站点是单用户 legacy 模式；建完的下一个请求起全站要求登录。owner 的 id 固定为
`local`，本机迁移过去的历史数据自动归属 owner。朋友拿邀请码在登录页"注册新账号"。
`invite-batch` 生成的是一次性注册码，不会替任何人设置或保存密码；若严格控制总人数为 10，
owner 也算一人，请只发 9 枚邀请码。

**红线 17**：beta 免费、邀请制、不公开宣传（Caddyfile 已带 `X-Robots-Tag: noindex`），
直到拿到可商用行情授权。

## 4. 异地备份（必须做）

每日备份任务（scheduler 第 8 任务）在本机校验通过后，会执行 `ECHO_BACKUP_PUSH_CMD`
（`{file}` 替换为备份文件路径）。推荐 rclone + Backblaze B2（10GB 免费额度远够）：

```bash
sudo apt install rclone && sudo -u echo rclone config   # 配一个 b2 remote
# 验证一次端到端：
sudo -u echo env ECHO_BACKUP_PUSH_CMD="rclone copy {file} b2:echo-backups/" \
  node -e "import('./src/server/services/dbBackup.js').then(m => m.runBackup()).then(console.log)"
```

结果字符串里应有"异地推送 ✓"。scheduler 通知与设置页的任务状态会如实显示推送失败。

## 5. 迁移本机数据（可选）

想把本机的研究历史带到生产：

```bash
# 本机（先停本机 dev server，确保 WAL 已合并）
sqlite3 echo.db "PRAGMA wal_checkpoint(TRUNCATE);"
scp echo.db 服务器:/opt/echo-research/echo.db
# 服务器上 chown echo:echo 后重启 systemctl restart echo-research
```

服务器首次启动会自动跑 pending 迁移（`PRAGMA user_version` 迁移器）。

## 6. 上线核对清单

- [ ] `curl https://域名/.env` → 返回 SPA 壳 HTML 而不是密钥（E11 白名单生效）
- [ ] `curl https://域名/echo.db` → 同上
- [ ] 未登录访问 `/api/portfolio` → 401（多用户模式生效）
- [ ] 两人各自登录后互看不到对方的持仓/研究（U-2 隔离，红线 18）
- [ ] 设置页 scheduler 状态：8 个任务正常，备份"异地推送 ✓"
- [ ] Telegram 通知通路正常（生产 .env 里配了 bot token 的话）
- [ ] 手机 375px 实跑一遍看盘/持仓（M-2 修复面）

## 7. 日常运维

- 发版：`git pull && npm install --omit=dev && systemctl restart echo-research`（无热重载）
- 看日志：`journalctl -u echo-research -f`；Caddy 访问日志在 /var/log/caddy/
- 值守：beta 期两人按周轮换（PLAN v5 §3.5），报警通道 = Telegram 错误通知
