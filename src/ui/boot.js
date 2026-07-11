// 首屏故障兜底：模块加载/初始化失败时不能留整页空白。错误只展示短消息，不含堆栈或密钥。
(function () {
  let detail = "";
  const remember = (value) => { detail = String(value || "").slice(0, 160); };
  window.addEventListener("error", (event) => remember(event.message || "前端资源加载失败"));
  window.addEventListener("unhandledrejection", (event) => remember(event.reason?.message || "页面初始化失败"));
  window.setTimeout(() => {
    const app = document.querySelector("#app");
    if (!app || app.childElementCount) return;
    app.innerHTML = `<main class="boot-error"><section><strong>Echo Research 暂时没能启动</strong><p>${detail || "请刷新页面；如果仍然失败，请把当前时间告诉管理员。"}</p><button type="button" data-boot-reload>重新加载</button></section></main>`;
    app.querySelector("[data-boot-reload]")?.addEventListener("click", () => location.reload());
  }, 3500);
})();
