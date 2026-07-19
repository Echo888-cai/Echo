import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authApi, membershipApi } from "../lib/api";

import "@echo/ui/styles/12-membership.css";

const TIER_COPY: Record<string, string> = {
  free: "用于轻量研究与产品体验",
  pro: "为高频个人投资研究而生",
  team: "面向投研团队的协同与审计"
};

function money(value: unknown) {
  const amount = Number(value || 0);
  return amount === 0 ? "免费" : `$${amount}`;
}

export function MembershipPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["membership", "overview"], queryFn: () => membershipApi.overview() });
  const data = query.data;
  const account = data?.account;
  const activePlan = data?.plan;
  const calls = data?.usage?.successfulCalls || 0;
  const callLimit = activePlan?.maxDailyCalls || 1;
  const usagePct = Math.min(100, Math.round((calls / callLimit) * 100));

  async function logout() {
    try { await authApi.logout(); } finally { location.assign("/login"); }
  }

  return (
    <section className="membership-page">
      <header className="membership-hero">
        <button className="membership-back" type="button" onClick={() => navigate({ to: "/" })}>← 返回研究</button>
        <p>ECHO MEMBERSHIP / PRIVATE ACCESS</p>
        <h1>你的研究席位，<br /><span>为长期判断而设。</span></h1>
        <p className="membership-lede">管理账号、研究额度与会员能力。核心研究记录属于你的独立数据空间。</p>
      </header>

        {query.isLoading ? <div className="membership-loading">正在读取会员信息…</div> : query.isError ? <div className="membership-loading is-error">会员信息暂时不可用，请稍后重试。</div> : (
          <>
            <div className="member-overview">
              <article className="member-identity">
                <div className="member-monogram">AH</div>
                <div><span>ACCOUNT</span><h2>{account?.displayName || account?.username}</h2><p>{account?.username}</p></div>
                <span className="member-role">{account?.role === "owner" ? "OWNER" : "MEMBER"}</span>
              </article>
              <article className="member-plan-summary">
                <span>CURRENT ACCESS</span>
                <strong>{activePlan?.name || "Echo Access"}</strong>
                <p>{TIER_COPY[activePlan?.tier || "free"]}</p>
              </article>
              <article className="member-usage">
                <div><span>TODAY</span><strong>{calls} <small>/ {callLimit} 次研究</small></strong></div>
                <div className="usage-track"><i style={{ width: `${usagePct}%` }} /></div>
                <p>今日输入 {Number(data?.usage?.inputTokens || 0).toLocaleString()} tokens · 输出 {Number(data?.usage?.outputTokens || 0).toLocaleString()} tokens</p>
              </article>
            </div>

            <section className="membership-plans">
              <div className="membership-section-head"><div><p>ACCESS LEVELS</p><h2>选择适合你的研究强度</h2></div><span>月付 · 可随时调整</span></div>
              <div className="plan-grid">
                {(data?.plans || []).map((plan) => {
                  const current = plan.id === activePlan?.id;
                  return (
                    <article className={`plan-card ${current ? "is-current" : ""}`} key={plan.id}>
                      <div className="plan-card-head"><span>{plan.tier.toUpperCase()}</span>{current ? <em>当前方案</em> : null}</div>
                      <h3>{plan.name}</h3>
                      <div className="plan-price"><strong>{money(plan.monthlyPriceUsd)}</strong>{Number(plan.monthlyPriceUsd) ? <span>/ 月</span> : null}</div>
                      <p>{TIER_COPY[plan.tier] || "证据优先的金融研究能力"}</p>
                      <ul>{(plan.features || []).map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
                      <button type="button" disabled>{current ? "已启用" : "支付通道接入后开放"}</button>
                    </article>
                  );
                })}
              </div>
              {!data?.billingReady ? <p className="billing-note">当前为私有部署席位，会员数据与权限已生效；在线支付通道尚未连接，因此不会产生自动扣款。</p> : null}
            </section>

            <section className="account-actions">
              <div><span>SESSION</span><h2>账号与会话</h2><p>退出后，本机当前会话会立即失效；研究记录仍安全保存在独立数据空间。</p></div>
              <button type="button" onClick={logout}>退出登录</button>
            </section>
          </>
        )}
      </section>
  );
}
