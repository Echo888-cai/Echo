// Stub for routes not yet migrated in this slice (research/chat, watch desk,
// portfolio, settings, sidebar are explicitly out of scope for R-3's first cut).
export function PlaceholderPage({ label }: { label: string }) {
  return (
    <div style={{ padding: 40, fontFamily: "var(--font-display)" }}>
      <p>{label} 此页面待 R-3 后续切片迁移</p>
    </div>
  );
}
