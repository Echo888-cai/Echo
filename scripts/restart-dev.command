#!/bin/bash
# Echo Research 一键「重启」器 —— 双击即可。先杀掉旧后端，再用最新代码重新起服。
# 后端无热重载，改了 src/server/** 后用这个一键拉起新代码。关闭本窗口即停服。

# Finder 双击时 shell 的 PATH 往往很干净（找不到 node/npm/lsof）—— 先补齐常见位置。
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# 项目目录 = 本脚本所在目录的上一级（脚本在 scripts/ 里）。这样文件夹改名/移动也不会失灵。
PROJECT_DIR="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
PORT=4173
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
if [ -f "$ENV_FILE" ]; then
  CONFIGURED_URL="$(sed -n 's/^ECHO_BASE_URL=//p' "$ENV_FILE" | head -n 1 | tr -d '"\047' | xargs)"
fi
URL="${CONFIGURED_URL:-http://127.0.0.1:${PORT}}"

# 找 node：优先 PATH，其次常见安装位置（Intel /usr/local、Apple Silicon /opt/homebrew）。
NODE_BIN="$(command -v node 2>/dev/null)"
for cand in /usr/local/bin/node /opt/homebrew/bin/node; do
  [ -n "$NODE_BIN" ] && break
  [ -x "$cand" ] && NODE_BIN="$cand"
done
if [ -z "$NODE_BIN" ]; then
  echo "❌ 找不到 node。请先安装 Node.js（https://nodejs.org），装完再双击本文件。"
  echo "   按回车键关闭…"; read -r; exit 1
fi
NPM_BIN="$(dirname "$NODE_BIN")/npm"; [ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm 2>/dev/null)"

cd "$PROJECT_DIR" || { echo "❌ 找不到项目目录：$PROJECT_DIR"; echo "   按回车键关闭…"; read -r; exit 1; }
echo "📂 项目目录：$PROJECT_DIR"
echo "🟢 node：$NODE_BIN"

# 1) 杀掉占用 4173 的旧后端 + 任何残留的 node server.js。
echo "🧹 正在停止旧后端（端口 ${PORT}）…"
OLD_PIDS="$(lsof -ti tcp:${PORT} 2>/dev/null)"
[ -n "$OLD_PIDS" ] && kill -9 $OLD_PIDS 2>/dev/null
pkill -f "node server.js" 2>/dev/null
# 等端口真正释放，避免新进程 EADDRINUSE。
for _ in $(seq 1 20); do
  lsof -ti tcp:${PORT} >/dev/null 2>&1 || break
  sleep 0.2
done

# 2) 依赖没装就先装一次（首次使用或换了机器时）。
if [ ! -d "node_modules" ]; then
  echo "📦 第一次启动，正在安装依赖（只这一次，请稍候）…"
  "$NPM_BIN" install || { echo "❌ 依赖安装失败"; echo "   按回车键关闭…"; read -r; exit 1; }
fi

# 3) 端口起来后自动开浏览器（最多等 30 秒）。
(
  for _ in $(seq 1 60); do
    if curl -s --max-time 1 "$URL" >/dev/null 2>&1; then open "$URL"; break; fi
    sleep 0.5
  done
) &

echo "🚀 正在用最新代码启动 Echo Research … 服务起来后浏览器会自动打开 $URL"
echo "   （保持本窗口开着 = 服务在运行；关闭本窗口 = 停止服务）"
echo ""

# 4) 前台跑服务，日志直接打在窗口里。
exec "$NODE_BIN" server.js
