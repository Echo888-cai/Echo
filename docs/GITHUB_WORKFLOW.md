# GitHub 工作流

这份文档记录 Echo Research 项目的 GitHub 协作机制、推送、分支和登录凭据处理方式。

## 当前仓库

本地项目：

```text
/Users/arlan/Vibe Coding/ECHO
```

远程仓库：

```text
https://github.com/EchoResearchLab/Echo.git
```

`.env`（含 FMP / Tavily 等真实 key）已 gitignore，永远不会被推送。

查看状态：

```bash
git status --short --branch
git remote -v
```

## 双人协作机制（2026-07-10 起，PLAN v5 §3.5 的执行细则）

两位联合创始人按**平台/产品分层**分工（职责与代码属地全表见 `docs/PLAN.md` §3.5）：

- **Arlan — 平台与数据 Owner**：`src/server/**`、`src/db/**`、`scripts/`、`src/*.js`（数据适配层）。
- **兄弟 — 产品与体验 Owner**：`src/ui/**`、`src/styles/**`、`index.html`。
- **共同持有**：`docs/`、业务逻辑服务（valuationEngine / eventEngine 等）——谁的阶段需要谁改，对方 review。

规则（在 GitHub 仓库设置里落地）：

1. **保护 main**：Settings → Branches → main 加保护规则；禁止直接 push（纯文档除外，PLAN.md 例外见第 3 条）；PR 必须 CI 绿（lint + typecheck + 全量测试设为 required checks）。
2. **互审**：对方 approve 才可合并。低风险 PR 沿用既有的 CI 绿自动合并政策。
3. **双人 approve 清单**：DB 迁移（`src/db/migrations/**`）、鉴权、部署配置、`docs/PLAN.md`——PLAN.md 是宪法，改宪法要全体同意。
4. **CODEOWNERS**：`.github/CODEOWNERS` 已落库并由 `@Echo888-cai` 兜底；兄弟的 GitHub 账号取得 Write 权限后追加到产品目录和 `docs/`，开 PR 自动请求双人 reviewer。
5. **分支命名**：`feat/u1-auth`、`fix/watch-xxx`、`docs/xxx`——PLAN 轨道编号进分支名；commit 沿用中文单行惯例。
6. **看板**：一块 GitHub Projects 看板（待办/本周/进行中/待 review/完成），每个 PLAN 阶段一个 milestone。**PLAN.md 是唯一权威，看板只是镜像**。
7. **节奏**：周一 30 分钟定各自本周阶段目标；周五互相 demo + 完成项写回 PLAN §5 状态表。PR 小步提交（软上限 ≈400 行 diff）。
8. **值守**：beta 开放后按周轮换看生产报警（Telegram 错误通道）。

给兄弟开权限：GitHub 仓库 Settings → Collaborators → 邀请其账号（Write 权限即可，Admin 保留给 Arlan 一人，降低误操作面）。

## 每次改完以后怎么提交

先跑测试：

```bash
npm test
```

确认改动：

```bash
git status
git diff
```

提交：

```bash
git add .
git commit -m "这里写本次改动"
```

推送：

```bash
git push
```

## 推荐分支习惯

稳定版本放在 `main`。

每次大改先开新分支：

```bash
git checkout -b feature/short-name
```

例如：

```bash
git checkout -b feature/moat-followups
git checkout -b feature/research-room-ui
git checkout -b fix/company-resolution
```

改完后：

```bash
npm test
git add .
git commit -m "Fix company resolution"
git push -u origin feature/short-name
```

然后到 GitHub 上开 Pull Request，合并回 `main`。

## 如果终端 git push 要登录

当前 Git 已启用 macOS Keychain：

```bash
git config --get credential.helper
```

应该看到：

```text
osxkeychain
```

如果 `git push` 报：

```text
fatal: could not read Username for 'https://github.com': Device not configured
```

说明终端还没有拿到 GitHub 凭据。用下面任意一种方式解决。

## 方式一：GitHub Desktop 推送

这是最简单方式。

1. 打开 GitHub Desktop。
2. 选择仓库 `Echo`。
3. 如果看到本地 commit，点击 `Push origin`。

GitHub Desktop 会自己处理登录凭据。

## 方式二：Personal Access Token

适合继续使用 HTTPS remote。

1. 打开 GitHub token 页面：

```text
https://github.com/settings/tokens
```

2. 选择 `Generate new token`。
3. 如果用 classic token，至少勾选：

```text
repo
```

4. 生成后复制 token。
5. 运行：

```bash
git push
```

如果终端要求：

```text
Username:
```

输入 GitHub 用户名：

```text
Echo888-cai
```

如果要求：

```text
Password:
```

粘贴刚生成的 token。不是 GitHub 登录密码。

成功后，macOS Keychain 会保存凭据，以后一般不用再输入。

## 方式三：SSH Key

适合长期使用终端。

生成 GitHub 专用 SSH key：

```bash
ssh-keygen -t ed25519 -C "15824448882@163.com" -f ~/.ssh/github_luvio_ed25519
```

启动 agent 并加入 key：

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/github_luvio_ed25519
```

复制公钥：

```bash
pbcopy < ~/.ssh/github_luvio_ed25519.pub
```

打开 GitHub：

```text
Settings -> SSH and GPG keys -> New SSH key
```

把公钥粘进去。

切换 remote 到 SSH：

```bash
git remote set-url origin git@github.com:EchoResearchLab/Echo.git
```

测试：

```bash
ssh -T git@github.com
```

推送：

```bash
git push
```

## 当前注意事项

不要提交：

```text
.env
node_modules/
luvio.db
luvio.db-wal
luvio.db-shm
```

这些已经在 `.gitignore` 里。
