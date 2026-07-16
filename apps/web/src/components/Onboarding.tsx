import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { preferencesApi } from "../lib/api";

function Step({ done, n, title, detail, href }: { done: boolean; n: number; title: string; detail: string; href: string }) {
  return (
    <Link className={`onboard-step ${done ? "is-done" : ""}`} to={href}>
      <i>{done ? "✓" : n}</i>
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
    </Link>
  );
}

export function Onboarding() {
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: () => preferencesApi.get()
  });
  const preferences = preferencesQuery.data?.preferences;
  const progressQuery = useQuery({
    queryKey: ["preferences", "onboardingProgress"],
    queryFn: () => preferencesApi.onboardingProgress(),
    enabled: preferencesQuery.isSuccess && !preferences?.onboardingCompleted
  });

  if (!preferencesQuery.isSuccess) return null;
  if (preferences?.onboardingCompleted) return null;

  const researched = Boolean(progressQuery.data?.researched);
  const watched = Boolean(progressQuery.data?.watched);
  const held = Boolean(progressQuery.data?.held);

  async function completeOnboarding() {
    const data = await preferencesApi.update({ onboardingCompleted: true });
    queryClient.setQueryData(["preferences"], data);
  }

  return (
    <section className="onboard onboard-enter" aria-label="首次使用引导">
      <div className="onboard-copy">
        <span>3 步开始</span>
        <strong>把一个判断变成可持续跟踪的研究资产</strong>
        <small className="onboard-subtitle">Echo 帮你把投资判断变成可追踪、可证伪的研究资产</small>
      </div>
      <div className="onboard-steps">
        <Step done={researched} n={1} title="问一家公司" detail="先得到有证据的判断" href="/" />
        <Step done={watched} n={2} title="加入看盘" detail="让事件和证伪线持续更新" href="/watch" />
        <Step done={held} n={3} title="记一笔持仓" detail="补上成本与纪律线" href="/portfolio" />
      </div>
      <div className="onboard-footer">
        <Link className="onboard-sample" to="/">
          示例：看看腾讯的研究 →
        </Link>
        <button type="button" className="onboard-done" onClick={completeOnboarding}>
          {researched && watched ? "完成引导" : "不再显示"}
        </button>
      </div>
    </section>
  );
}
