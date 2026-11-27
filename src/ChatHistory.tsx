import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../shared/chat.ts";

const examplePrompts = ["提醒我买牛奶", "看看我的待办"];

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

interface ChatHistoryProps {
  messages: ChatMessage[];
  pending: boolean;
  onSelectPrompt: (prompt: string) => void;
}

export function ChatHistory({ messages, pending, onSelectPrompt }: ChatHistoryProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number>();
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [messages, pending]);

  return (
    <div className="scroll" ref={viewport}>
      {messages.length === 0 ? (
        <section className="welcome">
          <img src="/logo.png" alt="" />
          <h1>小明智能体</h1>
          <p>今天有什么待办？</p>
          <div className="examples">
            {examplePrompts.map((prompt) => (
              <button key={prompt} onClick={() => onSelectPrompt(prompt)}>
                {prompt}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="thread" role="log" aria-label="对话记录" aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <small>{message.role === "user" ? "你" : "小明智能体"}</small>
              <div className="bubble">{message.content}</div>
              {message.role === "assistant" && (
                <button
                  className="copy-message"
                  aria-label="复制小明的回复"
                  onClick={async () => {
                    await copyText(message.content);
                    setCopiedIndex(index);
                    window.setTimeout(() => setCopiedIndex(undefined), 1600);
                  }}
                >
                  {copiedIndex === index ? "已复制" : "复制内容"}
                </button>
              )}
            </div>
          ))}
          {pending && <p role="status">正在回复…</p>}
        </div>
      )}
    </div>
  );
}
