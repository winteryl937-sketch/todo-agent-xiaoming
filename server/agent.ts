import type { ChatMessage } from "../shared/chat.ts";
import type { TaskStore } from "./task-store.ts";

export type { ChatMessage } from "../shared/chat.ts";

const LIST_PATTERN = /(哪些|什么|看看|查看|列出|清单|列表|待办|任务)/;
const DELETE_PATTERN = /(删掉|删除|移除|不要了|取消)/;
const COMPLETE_PATTERN = /(完成|做完|好了|搞定|办完|结束)/;
const CREATE_PREFIXES = [
  /^请?(?:帮我)?(?:记一下|记下|记录|添加|新增|创建)(?:一条|一个|个)?(?:待办|任务)?[：:，,\s]*/,
  /^(?:再|还要)?记(?:一条|一个|个)?[：:，,\s]*/,
  /^(?:加|添加)(?:一条|一个|个)?(?:待办|任务)?[：:，,\s]*/,
];

function normalize(value: string) {
  return value
    .trim()
    .replace(/[，。！？!?；;：:、“”‘’]/g, "")
    .replace(/(?:这条|这个|任务|待办|事项)/g, "")
    .replace(/(?:已经|给我|帮我|一下|吧|了)$/g, "")
    .trim();
}

function formatList(tasks: ReturnType<TaskStore["list"]>) {
  if (tasks.length === 0) return "你的待办清单还是空的。可以说“帮我记一下买牛奶”来添加任务。";
  const lines = tasks.map(
    (task, index) => `${index + 1}. ${task.done ? "✅" : "⬜"} ${task.title}`,
  );
  const pending = tasks.filter((task) => !task.done).length;
  return `你的待办清单（${pending} 条待完成，共 ${tasks.length} 条）：\n${lines.join("\n")}`;
}

function findTasks(tasks: ReturnType<TaskStore["list"]>, message: string) {
  const target = normalize(
    message
      .replace(DELETE_PATTERN, "")
      .replace(COMPLETE_PATTERN, "")
      .replace(/^(把|将)/, ""),
  );
  if (!target) return [];
  const exact = tasks.filter((task) => normalize(task.title) === target);
  if (exact.length > 0) return exact;
  const targetCharacters = [...target].sort().join("");
  return tasks.filter((task) => {
    const title = normalize(task.title);
    return (
      title.includes(target) ||
      target.includes(title) ||
      (title.length === target.length && [...title].sort().join("") === targetCharacters)
    );
  });
}

/** 创建一个绑定任务存储的对话智能体。 */
export function createAgent(tasks: TaskStore) {
  return async function reply(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 1) return "你好，欢迎使用小明智能体";

    const message = messages.at(-1)!.content.trim();
    const allTasks = tasks.list();

    if (DELETE_PATTERN.test(message)) {
      const matches = findTasks(allTasks, message);
      if (matches.length === 0) return "没有找到要删除的任务，请说出更完整的任务名称。";
      if (matches.length > 1)
        return `找到多条相似任务：${matches.map((task) => `「${task.title}」`).join("、")}。请说得更具体一些。`;
      tasks.remove(matches[0].id);
      return `已删除待办「${matches[0].title}」。`;
    }

    if (COMPLETE_PATTERN.test(message)) {
      const matches = findTasks(allTasks, message);
      if (matches.length === 0) return "没有找到要完成的任务，请说出更完整的任务名称。";
      if (matches.length > 1)
        return `找到多条相似任务：${matches.map((task) => `「${task.title}」`).join("、")}。请说得更具体一些。`;
      if (matches[0].done) return `待办「${matches[0].title}」已经是已完成状态。`;
      tasks.update(matches[0].id, { done: true });
      return `做得好！已将「${matches[0].title}」标记为已完成。`;
    }

    for (const prefix of CREATE_PREFIXES) {
      if (!prefix.test(message)) continue;
      const title = message
        .replace(prefix, "")
        .replace(/[。！!]+$/, "")
        .trim();
      if (!title) return "请告诉我要记录的具体事情，例如“帮我记一下买牛奶”。";
      if (title.length > 200) return "任务名称太长了，请控制在 200 个字符以内。";
      const duplicate = allTasks.find(
        (task) => !task.done && normalize(task.title) === normalize(title),
      );
      if (duplicate) return `待办「${duplicate.title}」已经在清单里了。`;
      tasks.create(title);
      return `已添加待办「${title}」。`;
    }

    if (LIST_PATTERN.test(message)) return formatList(allTasks);
    return "我可以帮你添加、查看、完成或删除待办。例如说“帮我记一下买牛奶”或“我有哪些任务？”。";
  };
}
