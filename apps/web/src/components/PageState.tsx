// Shared high-fidelity loading and recoverable error states for data-heavy pages.
export function PageSkeleton({ label = "正在同步研究数据", cards = 4 }: { label?: string; cards?: number }) {
  return (
    <section className="page-state page-skeleton" role="status" aria-live="polite" aria-label={label}>
      <div className="ps-copy">
        <p>ECHO / LIVE DATA</p>
        <span>{label}</span>
      </div>
      <div className="ps-line ps-title" />
      <div className="ps-line ps-subtitle" />
      <div className="ps-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <div className="ps-card" key={index}>
            <i />
            <span />
            <span />
          </div>
        ))}
      </div>
    </section>
  );
}

export function PageErrorState({ title, description, onRetry }: { title: string; description: string; onRetry: () => void }) {
  return (
    <section className="page-state page-error" role="alert">
      <p>ECHO / CONNECTION</p>
      <span className="page-error-mark" aria-hidden="true">!</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <button className="primary" type="button" onClick={onRetry}>重新连接</button>
    </section>
  );
}
