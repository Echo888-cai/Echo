// ── 后端 API 封装：普通 JSON 请求 + SSE 流式聊天 ────────────
import { S, running, activeRunKey, updateBusyClock, render } from "./state.js";
import { markdownToHtml } from "./markdown.js";

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Echo-Auth": "1", // U-1 CSRF：服务端要求所有非 GET 带此自定义头
      ...(options.headers || {})
    }
  });
  // U-1：多用户模式下会话失效 → 整页切到登录卡（/api/auth/* 自身除外，避免登录失败也触发）。
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    S.authRequired = true;
    S.authUser = null;
    render();
    throw new Error("请先登录");
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || json.error || `请求失败 ${response.status}`);
  return json?.ok && json.data ? json.data : json;
}

// 流式聊天：读 SSE，token 事件边到边渲染，final 事件携带完整面板/估值/接地。
// 端点不支持流式或中途出错（且还没拿到 final）时，回退到普通 JSON 请求，绝不丢回答。
// key：这条 run 的会话键。只有当它还是"前台"（当前激活会话）时才把 token 渲染到视图；
// 切到别的会话后 token 静默累计、不污染当前视图，final 仍按 key 落回对应会话。
export async function chatStream(body, key) {
  let finalResult = null;
  const isFg = () => key && key === activeRunKey(); // 这条 run 此刻是否在前台
  try {
    const resp = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Echo-Auth": "1" },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (resp.status === 401) {
      S.authRequired = true;
      S.authUser = null;
      render();
      throw new Error("请先登录");
    }
    const ctype = resp.headers.get("content-type") || "";
    if (!resp.ok || !resp.body || !ctype.includes("text/event-stream")) throw new Error("no-stream");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let evt = "message";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") { evt = "message"; continue; }
        if (line.startsWith("event:")) { evt = line.slice(6).trim(); continue; }
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        if (evt === "token") {
          if (!isFg()) continue; // 后台 run：静默，不渲染到当前视图
          if (S.streamingKey !== key) { S.streamingKey = key; S.streamingText = ""; render(); }
          S.streamingText += json.t || "";
          const node = document.getElementById("stream-body");
          if (node) node.innerHTML = `${markdownToHtml(S.streamingText)}<span class="stream-caret"></span>`;
          // 只在用户本来就贴着底部时才跟随滚动；用户上滚回看时不再被 token 往下拽。
          const conv = document.querySelector(".conversation");
          if (conv && conv.scrollHeight - conv.scrollTop - conv.clientHeight < 120) {
            conv.scrollTo({ top: conv.scrollHeight });
          }
        } else if (evt === "reasoning") {
          // 推理期：累计字数到这条 run；前台时等待卡的 phase 行（1s tick）会读出来。
          const r = running.get(key);
          if (r) r.reasoningChars += json.n || 0;
          if (isFg()) updateBusyClock();
        } else if (evt === "final") {
          finalResult = json;
        } else if (evt === "error") {
          throw new Error(json.message || "流式作答失败");
        }
      }
    }
  } catch {
    if (!finalResult) finalResult = await api("/api/ask", { method: "POST", body: JSON.stringify(body) });
  } finally {
    if (S.streamingKey === key) { S.streamingKey = null; S.streamingText = ""; }
  }
  return finalResult;
}
