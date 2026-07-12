// React port of src/ui/sidebar.js's renderGlobalSidebar(). This slice has no
// research-run state yet (that lands with the research/chat page migration),
// so this renders exactly what renderSnapshotCard(null, null, []) +
// renderContextCard(null) + an empty renderSessionHistory() produce today —
// i.e. the real "fresh session" empty state, not a fake stand-in.
import { Link } from "@tanstack/react-router";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link className="primary wide" to="/">
        新建研究
      </Link>
      <section className="research-snapshot">
        <div className="snapshot-head">
          <div className="snapshot-id">
            <p>研究公司</p>
            <h2>未选择公司</h2>
            <span>输入公司名、A股、港股或美股代码</span>
          </div>
        </div>
      </section>
      <section className="history-panel">
        <button className="history-toggle is-open" type="button" aria-expanded="true" disabled>
          <span>历史研究</span>
          <i>收起</i>
        </button>
        <div className="history-empty">还没有历史研究。完成第一轮回答后会自动保存。</div>
      </section>
      <div className="sidebar-tagline">
        <b>Seek signal. Ignore noise.</b>
        喧声之外，见真知。研究参考，非投资建议。
      </div>
    </aside>
  );
}
