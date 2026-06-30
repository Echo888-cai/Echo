#!/bin/bash
# Luvio 一键「重启」器 —— 双击即可。会先杀掉旧后端，再用最新代码重新起服。
# 用途：后端无热重载，改了 src/server/** 后用这个一键拉起新代码（区别于「启动 Luvio.command」——
# 那个发现已在运行就只开浏览器、不重启；这个永远杀旧起新）。关闭本窗口即停服。

PROJECT_DIR="/Users/arlan/Vibe Coding/LUVIO"
NODE_BIN="/usr/local/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"
PORT=4173
URL="http://127.0.0.1:${PORT}"

cd "$PROJECT_DIR" || { echo "❌ 找不到项目目录：$PROJECT_DIR"; echo "（项目若移动过，请改本文件里的 PROJECT_DIR）"; read -r; exit 1; }

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
  /usr/local/bin/npm install || { echo "❌ 依赖安装失败"; read -r; exit 1; }
fi

# 3) 端口起来后自动开浏览器（最多等 30 秒）。
(
  for _ in $(seq 1 60); do
    if curl -s --max-time 1 "$URL" >/dev/null 2>&1; then open "$URL"; break; fi
    sleep 0.5
  done
) &

echo "🚀 正在用最新代码启动 Luvio … 服务起来后浏览器会自动打开 $URL"
echo "   （保持本窗口开着 = 服务在运行；关闭本窗口 = 停止服务）"
echo ""

# 4) 前台跑服务，日志直接打在窗口里。
exec "$NODE_BIN" server.js
