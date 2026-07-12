// Stub for routes not yet migrated in this slice (research/chat, watch desk,
// portfolio are explicitly out of scope for R-3's first cut). Wrapped in the
// now-migrated Shell so the topbar/nav/sidebar are already live on every
// route — only the page body below the shell is still a stub.
import { Shell } from "../components/Shell";

export function PlaceholderPage({ label }: { label: string }) {
  return (
    <Shell>
      <div style={{ padding: 40, fontFamily: "var(--font-display)" }}>
        <p>{label} 此页面待 R-3 后续切片迁移</p>
      </div>
    </Shell>
  );
}
