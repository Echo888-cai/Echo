#!/bin/zsh
# Echo Research · 桌面启动器
# 双击即可：确保 Postgres/Redis → 启动 API + Web → 打开浏览器
# 关闭本窗口即停止开发服务；若已在跑则只打开页面

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WEB_URL="http://localhost:5190"
API_URL="http://127.0.0.1:4180"
API_PORT=4180
WEB_PORT=5190

clear 2>/dev/null || true
printf '\n'
printf '  Echo Research · 开发启动器\n'
printf '  ─────────────────────────────────\n'
printf '  项目目录：%s\n' "$ROOT"
printf '  将启动：PostgreSQL · Redis · API(%s) · Web(%s)\n' "$API_PORT" "$WEB_PORT"
printf '  关闭本窗口即停止全部开发服务\n'
printf '\n'

pause_fail() {
  printf '\n× %s\n' "$1"
  read -r '?按回车键关闭…'
  exit 1
}

port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

# ── 工具链 ──────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  pause_fail "未找到 node，请先安装 Node.js"
fi
if ! command -v npm >/dev/null 2>&1; then
  pause_fail "未找到 npm，请先安装 Node.js"
fi

# ── 数据服务（Homebrew） ────────────────────────────────
if command -v brew >/dev/null 2>&1; then
  for svc in postgresql@16 redis; do
    # zsh 里 `status` 是只读（等同 $?），不能当局部变量名，否则 set -e 会立刻退出。
    svc_state="$(brew services list 2>/dev/null | awk -v s="$svc" '$1==s {print $2}')"
    if [ "$svc_state" = "started" ]; then
      printf '✓ %s 已在运行\n' "$svc"
    else
      printf '… 正在启动 %s\n' "$svc"
      brew services start "$svc" >/dev/null 2>&1 || printf '! %s 启动失败，继续尝试（若 DATABASE_URL 可达可忽略）\n' "$svc"
    fi
  done
else
  printf '! 未找到 brew，跳过 Postgres/Redis 自动拉起\n'
fi

# 等 Postgres 就绪；socket 在但拒绝连接时重启一次（常见僵尸状态）
wait_pg() {
  command -v pg_isready >/dev/null 2>&1 || return 1
  for _ in {1..20}; do
    if pg_isready -q 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}
if wait_pg; then
  printf '✓ PostgreSQL 可连接\n'
elif command -v brew >/dev/null 2>&1; then
  printf '… PostgreSQL 无响应，正在重启\n'
  brew services restart postgresql@16 >/dev/null 2>&1 || true
  if wait_pg; then
    printf '✓ PostgreSQL 已恢复\n'
  else
    printf '! PostgreSQL 仍不可用——登录会失败。请检查 brew services\n'
  fi
fi

# ── 依赖 ────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  printf '… 首次运行，正在安装依赖\n'
  npm install || pause_fail "npm install 失败"
fi

if [ ! -f .env ]; then
  pause_fail "缺少 .env。请先从 .env.example 复制并填好 DATABASE_URL 与密钥"
fi

# ── 已在运行：只打开页面 ────────────────────────────────
if port_listening "$API_PORT" && port_listening "$WEB_PORT"; then
  printf '\n✓ Echo 已在运行\n'
  printf '  Web  %s\n' "$WEB_URL"
  printf '  API  %s\n' "$API_URL"
  open "$WEB_URL" 2>/dev/null || true
  printf '\n  再次双击可重新打开页面；要停止请到原终端窗口按 Ctrl+C。\n'
  sleep 2
  exit 0
fi

# ── 启动开发服务 ────────────────────────────────────────
printf '\n… 启动 API + Web\n'
printf '  Web  %s\n' "$WEB_URL"
printf '  API  %s\n' "$API_URL"
printf '\n'

# 后台等端口就绪后打开浏览器（本窗口关掉时一并结束）
(
  for _ in {1..90}; do
    if port_listening "$WEB_PORT"; then
      open "$WEB_URL" 2>/dev/null || true
      exit 0
    fi
    sleep 0.5
  done
) &
OPENER_PID=$!

cleanup() {
  kill "$OPENER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev
exit_code=$?

if [ "$exit_code" -ne 0 ]; then
  printf '\n× 启动失败（退出码 %s）\n' "$exit_code"
  read -r '?按回车键关闭…'
  exit "$exit_code"
fi
