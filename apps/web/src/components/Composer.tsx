// Research composer: question textarea +
// quick-reply chips + file upload + send/stop button.
import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import type { ResearchCompany } from "../lib/researchStore";
import { abortActiveRun, canAbortActive, isViewBusy } from "../lib/researchStore";
import { generateDeepResearch, parseFiles } from "../lib/researchActions";

const MAX_QUESTION = 1200;
// 还剩这么多字时才开始提示——一直挂着字数会把注意力从问题本身引开。
const COUNTER_VISIBLE_FROM = MAX_QUESTION - 200;

export function Composer({ company, onSubmit }: { company: ResearchCompany | null; onSubmit: (q: string) => void }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = isViewBusy();
  const canStop = busy && canAbortActive();

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

  // 快捷追问是"补一句"，不是"清空重写"。这里曾经直接 setValue(q) 覆盖整个输入框——
  // 用户敲了半句话再点「赚钱方式」，已输入的内容就没了，且没有撤销。
  function quick(q: string) {
    setValue((prev) => {
      const base = prev.trim();
      if (!base) return q;
      if (base.includes(q)) return prev;
      return `${base}${/[？?。!！]$/.test(base) ? "" : "，"}${q}`.slice(0, MAX_QUESTION);
    });
    textareaRef.current?.focus();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    await parseFiles(e.target.files);
    e.target.value = "";
  }

  const remaining = MAX_QUESTION - value.length;

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-panel">
        <textarea
          ref={textareaRef}
          name="query"
          rows={2}
          maxLength={MAX_QUESTION}
          placeholder={company ? "继续追问：利润、护城河、估值或证伪条件" : "输入公司名、港股或美股代码，例如：阿里巴巴最近怎么样？AAPL 赚钱吗？"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {/* maxLength 会静默吃掉超出的字符：粘贴一段长问题，尾巴没了而用户毫不知情。
            快到上限时把剩余字数显式摆出来，让截断可预期。 */}
        {value.length >= COUNTER_VISIBLE_FROM && (
          <div className={`composer-count${remaining <= 0 ? " is-full" : ""}`} aria-live="polite">
            {remaining > 0 ? `还可输入 ${remaining} 字` : "已达 1200 字上限，再输入不会生效"}
          </div>
        )}
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
            <button
              className="tool-chip emphasis"
              type="button"
              disabled={!company || busy}
              // 禁用态必须自己解释为什么——否则用户只看到一个点不动的按钮。
              title={!company ? "先输入公司名或股票代码，才能生成深度研究" : busy ? "当前有研究正在进行" : "生成深度研究报告"}
              onClick={() => void generateDeepResearch()}
            >
              深度研究
            </button>
          </div>
          {/* 一轮研究实测 13–21s，期间 isViewBusy() 会让所有操作 early-return。
              忙时直接变成停止按钮——把死路变成出口。真实阶段反馈在对话流里的 WorkingStatus。 */}
          {canStop ? (
            <button className="send-button is-stop" type="button" aria-label="停止" title="停止这轮研究" onClick={() => abortActiveRun()}>
              ■
            </button>
          ) : (
            <button className="send-button" type="submit" aria-label="发送" disabled={busy || !value.trim()} title={busy ? "研究进行中" : "发送"}>
              →
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
