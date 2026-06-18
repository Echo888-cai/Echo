# GitHub 工作流

这份文档记录 Luvio 项目的 GitHub 推送、分支和登录凭据处理方式。

## 当前仓库

本地项目：

```text
/Users/arlan/Vibe Coding/LUVIO
```

远程仓库：

```text
https://github.com/ArlanHowarCai/Luvio.git
```

查看状态：

```bash
git status --short --branch
git remote -v
```

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
2. 选择仓库 `LUVIO`。
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
ArlanHowarCai
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
git remote set-url origin git@github.com:ArlanHowarCai/Luvio.git
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

