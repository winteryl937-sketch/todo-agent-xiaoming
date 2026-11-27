import type { TaskStore } from "./task-store.ts";

export type Task = ReturnType<TaskStore["list"]>[number];

export const LIST_PATTERN = /(哪些|什么|看看|查看|列出|清单|列表|待办|任务)/;
export const DELETE_PATTERN = /(删掉|删除|移除|不要了|取消|去掉|撤销|清除)/;
export const COMPLETE_PATTERN = /(完成|做完|好了|搞定|办完|结束|处理好了|弄完了|已经做了)/;
export const CREATE_PREFIXES = [
  /^(?:请)?提醒我(?:要|去)?[：:，,\s]*/,
  /^(?:别忘了|记得)(?:要|去)?[：:，,\s]*/,
  /^(?:请)?(?:帮我)?安排(?:一下)?[：:，,\s]*/,
  /^(?:加入|加到|放进)(?:我的)?(?:待办|任务|清单)(?:里)?[：:，,\s]*/,
  /^请?(?:帮我)?(?:记一下|记下|记录|添加|新增|创建)(?:一条|一个|个)?(?:待办|任务)?[：:，,\s]*/,
  /^(?:再|还要)?记(?:一条|一个|个)?[：:，,\s]*/,
  /^(?:加|添加)(?:一条|一个|个)?(?:待办|任务)?[：:，,\s]*/,
];

const priorityRank = { high: 0, medium: 1, low: 2 } as const;

export function compareByDeadlineAndPriority(a: Task, b: Task) {
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  }
  const aRank = typeof a.priority === "string" ? priorityRank[a.priority] : 3;
  const bRank = typeof b.priority === "string" ? priorityRank[b.priority] : 3;
  return aRank - bRank;
}

export function priorityLabel(task: Task) {
  return typeof task.priority === "string"
    ? `（${task.priority === "high" ? "高" : task.priority === "medium" ? "中" : "低"}优先级）`
    : "";
}

export function normalize(value: string) {
  return value
    .trim()
    .replace(/[，。！？!?；;：:、“”‘’]/g, "")
    .replace(/(?:这条|这个|任务|待办|事项)/g, "")
    .replace(/(?:已经|给我|帮我|一下|吧|了)$/g, "")
    .trim();
}

function localDate(offset = 0) {
  const now = new Date();
  const date = new Date(now.getTime() + (480 + now.getTimezoneOffset()) * 60_000);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDate(value: string) {
  if (value === "今天") return localDate();
  if (value === "明天") return localDate(1);
  if (value === "后天") return localDate(2);
  const match = value.match(/^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?$/);
  if (!match) return undefined;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(date)
    ? date
    : undefined;
}

export function extractDeadline(message: string) {
  const match = message.match(
    /(?:截止|到期)(?:时间|日期)?(?:是|为|到|至|：|:)?\s*(今天|明天|后天|\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?)/,
  );
  if (!match) return {};
  return {
    deadline: parseDate(match[1]),
    text: message.replace(match[0], "").replace(/[，,\s]+$/, ""),
  };
}

export function formatList(tasks: Task[], showCompleted: boolean, byDeadline: boolean) {
  let visible = showCompleted ? tasks : tasks.filter((task) => !task.done);
  if (byDeadline) visible = [...visible].sort(compareByDeadlineAndPriority);
  if (!visible.length)
    return tasks.length && !showCompleted
      ? "没有未完成的任务。（已隐藏完成项，说“显示已完成任务”可以恢复。）"
      : "你的待办清单还是空的。可以说“帮我记一下买牛奶”来添加任务。";
  if (byDeadline) {
    const lines = visible.map(
      (task, index) =>
        `${task.parentId ? "  ↳ " : `${index + 1}. `}${task.done ? "✅" : "⬜"} ${task.title}${priorityLabel(task)}${task.deadline ? `（截止 ${task.deadline}）` : ""}`,
    );
    const pending = visible.filter((task) => !task.done).length;
    return `你的待办清单（${pending} 条待完成，共显示 ${visible.length} 条${showCompleted ? "" : "，已隐藏完成项"}，按截止时间排序）：\n${lines.join("\n")}`;
  }
  const ids = new Set(visible.map((task) => task.id));
  const roots = visible.filter((task) => !task.parentId || !ids.has(task.parentId));
  const lines: string[] = [];
  const append = (task: Task, depth: number, index?: number) => {
    lines.push(
      `${depth ? `${"  ".repeat(depth)}↳ ` : `${index}. `}${task.done ? "✅" : "⬜"} ${task.title}${priorityLabel(task)}${task.deadline ? `（截止 ${task.deadline}）` : ""}`,
    );
    visible
      .filter((child) => child.parentId === task.id)
      .forEach((child) => append(child, depth + 1));
  };
  roots.forEach((task, index) => append(task, 0, index + 1));
  const pending = visible.filter((task) => !task.done).length;
  return `你的待办清单（${pending} 条待完成，共显示 ${visible.length} 条${showCompleted ? "" : "，已隐藏完成项"}）：\n${lines.join("\n")}`;
}

export function formatDueList(
  tasks: Task[],
  date: string,
  mode: "exact" | "through",
  showCompleted: boolean,
) {
  const due = tasks
    .filter(
      (task) =>
        task.deadline &&
        (mode === "exact" ? task.deadline === date : task.deadline <= date) &&
        (showCompleted || !task.done),
    )
    .sort(compareByDeadlineAndPriority);
  const scope = mode === "exact" ? date : `截至 ${date}（含当天）`;
  if (!due.length) return `${scope}没有${showCompleted ? "" : "未完成的"}到期任务。`;
  return `${scope}到期的任务：\n${formatList(due, true, true)}`;
}

export function findTasks(tasks: Task[], message: string) {
  const target = normalize(
    message
      .replace(DELETE_PATTERN, "")
      .replace(COMPLETE_PATTERN, "")
      .replace(/^(把|将)/, ""),
  );
  if (!target) return [];
  const exact = tasks.filter((task) => normalize(task.title) === target);
  if (exact.length) return exact;
  const fuzzyTarget = target.replace(/的$/, "");
  if (!fuzzyTarget) return [];
  const characters = [...fuzzyTarget].sort().join("");
  return tasks.filter((task) => {
    const title = normalize(task.title);
    return (
      title.includes(fuzzyTarget) ||
      fuzzyTarget.includes(title) ||
      (title.length === fuzzyTarget.length && [...title].sort().join("") === characters)
    );
  });
}

export function oneMatch(tasks: Task[], target: string): Task | Task[] {
  const matches = findTasks(tasks, target);
  return matches.length === 1 ? matches[0] : matches;
}

export function splitBatch(value: string) {
  return value
    .replace(/[。！!]+$/, "")
    .split(/[、，,；;]|和/)
    .map((item) => item.trim())
    .filter(Boolean);
}
