import type { ModelIntent } from "./model.ts";
import type { TaskStore } from "./task-store.ts";
import { formatDueList, formatList, normalize, oneMatch, type Task } from "./task-language.ts";

interface IntentContext {
  tasks: TaskStore;
  allTasks: Task[];
  showCompleted: boolean;
  setShowCompleted(value: boolean): void;
  confirmDeletion(description: string, run: () => string): string;
}

export function executeModelIntent(intent: ModelIntent, context: IntentContext) {
  const { tasks, allTasks, confirmDeletion } = context;
  if (intent.action === "create" && intent.title) {
    const duplicate = allTasks.find(
      (task) => !task.done && normalize(task.title) === normalize(intent.title!),
    );
    if (duplicate) return `待办「${duplicate.title}」已经在清单里了。`;
    const created = tasks.create({
      title: intent.title,
      deadline: intent.deadline,
      priority: intent.priority,
    });
    return `已添加待办「${created.title}」${created.deadline ? `，截止 ${created.deadline}` : ""}。`;
  }
  if (intent.action === "create_many" && intent.items) {
    const seen = new Set(
      allTasks.filter((task) => !task.done).map((task) => normalize(task.title)),
    );
    const created: Task[] = [];
    const skipped: string[] = [];
    for (const item of intent.items) {
      const key = normalize(item.title);
      if (seen.has(key)) skipped.push(item.title);
      else {
        seen.add(key);
        created.push(tasks.create(item));
      }
    }
    if (!created.length)
      return `这些待办都已存在：${skipped.map((title) => `「${title}」`).join("、")}。`;
    return `已批量添加 ${created.length} 条待办：${created.map((task) => `「${task.title}」`).join("、")}${skipped.length ? `；跳过已存在的 ${skipped.map((title) => `「${title}」`).join("、")}` : ""}。`;
  }
  if (intent.action === "list")
    return formatList(allTasks, context.showCompleted, intent.sortByDeadline ?? false);
  if (intent.action === "list_completed") {
    const completed = allTasks.filter((task) => task.done);
    return completed.length
      ? `已完成的任务：\n${formatList(completed, true, intent.sortByDeadline ?? false)}`
      : "目前没有已完成的任务。";
  }
  if (intent.action === "list_due" && intent.deadline)
    return formatDueList(
      allTasks,
      intent.deadline,
      intent.dueMode ?? "through",
      context.showCompleted,
    );
  if (intent.action === "hide_completed") {
    context.setShowCompleted(false);
    return `已隐藏所有完成项。\n${formatList(allTasks, false, false)}`;
  }
  if (intent.action === "show_all") {
    context.setShowCompleted(true);
    return `已显示全部任务。\n${formatList(allTasks, true, false)}`;
  }
  if (intent.action === "delete_all") {
    if (!allTasks.length) return "待办清单已经是空的。";
    return confirmDeletion(`删除全部 ${allTasks.length} 条任务`, () => {
      for (const task of allTasks) tasks.remove(task.id);
      return `已删除全部 ${allTasks.length} 条任务。`;
    });
  }
  if (intent.action === "delete_completed") {
    const completed = allTasks.filter((task) => task.done);
    if (!completed.length) return "没有已完成的任务需要删除。";
    return confirmDeletion(`删除 ${completed.length} 条已完成任务`, () => {
      for (const task of completed) tasks.remove(task.id);
      return `已删除 ${completed.length} 条已完成任务，未完成任务已保留。`;
    });
  }
  if (intent.action === "delete_many" && intent.targets) {
    const resolved = intent.targets.map((target) => ({
      target,
      match: oneMatch(allTasks, target),
    }));
    const invalid = resolved.filter(({ match }) => Array.isArray(match));
    if (invalid.length)
      return `未执行删除，请确认这些任务名称：${invalid.map(({ target }) => `「${target}」`).join("、")}。`;
    const unique = new Map(resolved.map(({ match }) => [(match as Task).id, match as Task]));
    return confirmDeletion(`批量删除 ${unique.size} 条任务`, () => {
      for (const task of unique.values()) tasks.remove(task.id);
      return `已批量删除 ${unique.size} 条任务：${[...unique.values()].map((task) => `「${task.title}」`).join("、")}。`;
    });
  }
  if (intent.action === "create_subtask" && intent.parent && intent.title) {
    const parent = oneMatch(allTasks, intent.parent);
    if (Array.isArray(parent))
      return parent.length ? "找到多条相似的父任务，请说得更具体一些。" : "没有找到父任务。";
    const child = tasks.create({
      title: intent.title,
      parentId: parent.id,
      deadline: intent.deadline,
      priority: intent.priority,
    });
    return `已在「${parent.title}」下添加子任务「${child.title}」${child.deadline ? `，截止 ${child.deadline}` : ""}。`;
  }
  if (intent.action === "create_subtasks" && intent.parent && intent.items) {
    const parent = oneMatch(allTasks, intent.parent);
    if (Array.isArray(parent))
      return parent.length ? "找到多条相似的父任务，请说得更具体一些。" : "没有找到父任务。";
    const seen = new Set(
      allTasks
        .filter((task) => task.parentId === parent.id && !task.done)
        .map((task) => normalize(task.title)),
    );
    const created: Task[] = [];
    const skipped: string[] = [];
    for (const item of intent.items) {
      const key = normalize(item.title);
      if (seen.has(key)) skipped.push(item.title);
      else {
        seen.add(key);
        created.push(tasks.create({ ...item, parentId: parent.id }));
      }
    }
    if (!created.length)
      return `这些子任务都已存在：${skipped.map((title) => `「${title}」`).join("、")}。`;
    return `已在「${parent.title}」下添加 ${created.length} 个子任务：${created.map((task) => `「${task.title}」`).join("、")}${skipped.length ? `；跳过已存在的 ${skipped.map((title) => `「${title}」`).join("、")}` : ""}。`;
  }
  if (intent.action === "chat" && intent.reply) return intent.reply;
  if (
    ["complete", "delete", "set_deadline", "set_priority", "move"].includes(intent.action) &&
    intent.target
  ) {
    const found = oneMatch(allTasks, intent.target);
    if (Array.isArray(found))
      return found.length ? "找到多条相似任务，请说得更具体一些。" : "没有找到对应的任务。";
    if (intent.action === "complete") {
      if (found.done) return `待办「${found.title}」已经是已完成状态。`;
      tasks.update(found.id, { done: true });
      return `做得好！已将「${found.title}」标记为已完成。`;
    }
    if (intent.action === "delete")
      return confirmDeletion(`删除待办「${found.title}」`, () => {
        tasks.remove(found.id);
        return `已删除待办「${found.title}」。`;
      });
    if (intent.action === "set_deadline" && intent.deadline) {
      tasks.update(found.id, { deadline: intent.deadline });
      return `已将「${found.title}」的截止时间设为 ${intent.deadline}。`;
    }
    if (intent.action === "set_priority" && intent.priority) {
      tasks.update(found.id, { priority: intent.priority });
      const label = intent.priority === "high" ? "高" : intent.priority === "medium" ? "中" : "低";
      return `已将「${found.title}」的重要程度设为${label}。`;
    }
    if (intent.action === "move" && intent.position !== undefined) {
      const position = Math.min(intent.position, Math.max(0, allTasks.length - 1));
      tasks.move(found.id, position);
      return `已将「${found.title}」调整到第 ${position + 1} 条。`;
    }
  }
  return undefined;
}
