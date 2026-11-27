import { useRef, useState, type KeyboardEvent } from "react";
import type { ChatMessage } from "../shared/chat.ts";
import { requestReply } from "./chat-client.ts";
import { ChatHistory } from "./ChatHistory.tsx";
import { downloadTaskListImage } from "./task-image.ts";

function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  // 中文输入法会用 Enter 确认选词，部分浏览器此时只报告键码 229。
  const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  return event.key === "Enter" && !event.shiftKey && !composing;
}

function needsDeletionConfirmation(answer: string) {
  return answer.includes("请回复“确认删除”") && answer.includes("“取消”");
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"image" | "word" | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const outgoing: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(outgoing);
    setDraft("");
    setPending(true);
    setError("");
    try {
      const answer = await requestReply(outgoing);
      if (needsDeletionConfirmation(answer)) {
        const description = answer.replace(/。?请回复“确认删除”[^。]*“取消”。?/, "");
        const confirmed = window.confirm(`${description}\n\n是否确定执行？`);
        const confirmationMessages: ChatMessage[] = [
          ...outgoing,
          { role: "assistant", content: answer },
          { role: "user", content: confirmed ? "确认删除" : "取消" },
        ];
        const result = await requestReply(confirmationMessages);
        setMessages([...outgoing, { role: "assistant", content: result }]);
      } else {
        setMessages([...outgoing, { role: "assistant", content: answer }]);
      }
    } catch (cause) {
      setMessages(messages);
      setDraft(text);
      setError(cause instanceof Error ? `发送失败：${cause.message}` : "发送失败，请重试。");
    } finally {
      setPending(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  return (
    <div className="app">
      <header>
        <img src="/logo.png" alt="" />
        <strong>TokeNow</strong>
        <span>小明智能体</span>
        <div className="export-actions" aria-label="导出清单">
          <button
            className="export"
            disabled={exporting !== null}
            onClick={async () => {
              setExporting("image");
              setError("");
              try {
                await downloadTaskListImage();
              } catch (cause) {
                setError(cause instanceof Error ? `导出失败：${cause.message}` : "导出图片失败。");
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "image" ? "正在导出…" : "导出图片"}
          </button>
          <button
            className="export"
            disabled={exporting !== null}
            onClick={async () => {
              setExporting("word");
              setError("");
              try {
                const { downloadTaskListWord } = await import("./task-word.ts");
                await downloadTaskListWord();
              } catch (cause) {
                setError(
                  cause instanceof Error ? `导出失败：${cause.message}` : "导出 Word 失败。",
                );
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "word" ? "正在导出…" : "导出 Word"}
          </button>
        </div>
      </header>
      <main>
        <ChatHistory messages={messages} pending={pending} onSelectPrompt={send} />
        <div className="compose">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              aria-label="消息"
              ref={input}
              placeholder="输入消息…"
              rows={2}
              value={draft}
              readOnly={pending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (isSendShortcut(event)) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button className="send" disabled={pending || !draft.trim()} aria-label="发送消息">
              ↑
            </button>
          </form>
          <small>Enter 发送 · Shift + Enter 换行</small>
        </div>
      </main>
    </div>
  );
}
