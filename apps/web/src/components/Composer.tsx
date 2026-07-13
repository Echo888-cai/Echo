// React port of src/ui/research.js's renderComposer() — question textarea +
// quick-reply chips + file upload + busy status + send button.
import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import type { ResearchCompany } from "../lib/researchStore";
import { activeRun, isViewBusy } from "../lib/researchStore";
import { generateDeepResearch, parseFiles } from "../lib/researchActions";

export function Composer({ company, resolvingLabel, busySeconds, onSubmit }: { company: ResearchCompany | null; resolvingLabel: string; busySeconds: number; onSubmit: (q: string) => void }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = isViewBusy();

  function submit(text?: string) {
    const q = (text ?? value).trim();
    if (!q || busy) return;
    setValue("");
    onSubmit(q);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function quick(q: string) {
    setValue(q);
    textareaRef.current?.focus();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    await parseFiles(e.target.files);
    e.target.value = "";
  }

  const status = busy ? (
    <>
      {activeRun()?.label || resolvingLabel} · 已等待 <b>{busySeconds}</b>s
    </>
  ) : company ? (
    `${company.nameZh || company.ticker} · ${company.ticker}`
  ) : (
    "先输入公司名、A股、港股或美股代码"
  );

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-panel">
        <textarea
          ref={textareaRef}
          name="query"
          rows={2}
          maxLength={1200}
          placeholder={company ? "继续追问：利润、护城河、估值或证伪条件" : "输入公司名、A股、港股或美股代码，例如：阿里巴巴最近怎么样？AAPL 赚钱吗？"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="composer-footer">
          <div className="composer-left-tools">
            <label className="tool-chip icon-chip file-label" title="上传资料">
              +<input type="file" multiple accept=".pdf,.txt,.md,.csv,.json,image/*" onChange={handleFileChange} />
            </label>
            <button className="tool-chip" type="button" onClick={() => quick("它主要靠什么赚钱？")}>
              赚钱方式
            </button>
            <button className="tool-chip" type="button" onClick={() => quick("竞争对手有哪些？")}>
              竞争格局
            </button>
            <button className="tool-chip" type="button" onClick={() => quick("经营质量怎么样？")}>
              经营质量
            </button>
            <button className="tool-chip" type="button" onClick={() => quick("什么情况会证伪？")}>
              证伪条件
            </button>
            <button className="tool-chip emphasis" type="button" disabled={!company} onClick={() => void generateDeepResearch()}>
              深度研究
            </button>
          </div>
          <div className="composer-status">{status}</div>
          <button className="send-button" type="submit" aria-label="发送">
            ↑
          </button>
        </div>
      </div>
    </form>
  );
}
