import type { ChatMessage } from "../shared/chat.ts";
import type { TaskStore } from "./task-store.ts";
import type { ModelInterpreter } from "./model.ts";
import { executeModelIntent } from "./intent-executor.ts";
import {
  COMPLETE_PATTERN,
  CREATE_PREFIXES,
  DELETE_PATTERN,
  LIST_PATTERN,
  extractDeadline,
  findTasks,
  formatDueList,
  formatList,
  normalize,
  oneMatch,
  parseDate,
  splitBatch,
  type Task,
} from "./task-language.ts";

export type { ChatMessage } from "../shared/chat.ts";

export function createAgent(tasks: TaskStore, interpret?: ModelInterpreter) {
  let showCompleted = true;
  let pendingDeletion: { description: string; run: () => string } | undefined;

  function confirmDeletion(description: string, run: () => string) {
    pendingDeletion = { description, run };
    return `即将${description}。请回复“确认删除”执行，或回复“取消”。`;
  }

  return async function reply(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 1) return "你好，欢迎使用小明智能体";
    const message = messages.at(-1)!.content.trim();
    let allTasks = tasks.list();

    if (pendingDeletion) {
      if (/^(确认删除|确认|确定)$/.test(message)) {
        const operation = pendingDeletion;
        pendingDeletion = undefined;
        return operation.run();
      }
      if (/^(取消|取消删除|不删了)$/.test(message)) {
        pendingDeletion = undefined;
        return "已取消删除操作。";
      }
      return `待确认操作：${pendingDeletion.description}。请回复“确认删除”或“取消”。`;
    }

    if (interpret) {
      try {
        const answer = executeModelIntent(await interpret(message, allTasks), {
          tasks,
          allTasks,
          showCompleted,
          setShowCompleted(value) {
            showCompleted = value;
          },
          confirmDeletion,
        });
        if (answer) return answer;
      } catch (error) {
        // 模型不可用或结构化结果无效时，继续使用下面的确定性规则。
        console.error("DeepSeek 解析失败，改用规则：", error);
      }
    }

    if (
      /只(?:看|显示|展示).*(已完成|完成项)|(?:看看|查看).*(完成了哪些|已完成任务)/.test(message)
    ) {
      const completed = allTasks.filter((task) => task.done);
      if (!completed.length) return "目前没有已完成的任务。";
      return `已完成的任务：\n${formatList(completed, true, false)}`;
    }
    if (/(隐藏|不显示).*(已完成|完成项)|只(?:看|显示).*(未完成|待办)/.test(message)) {
      showCompleted = false;
      return `已隐藏所有完成项。\n${formatList(allTasks, false, false)}`;
    }
    if (/(显示|查看|恢复).*(已完成|完成项)|显示全部/.test(message)) {
      showCompleted = true;
      return `已显示全部任务。\n${formatList(allTasks, true, false)}`;
    }

    const dueDateText = message.match(/(今天|明天|后天|\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?)/)?.[1];
    const asksForDueList = /(哪些|什么|看看|查看|列出|有多少)|[？?]$/.test(message);
    if (dueDateText && /(到期|截止)/.test(message) && asksForDueList) {
      const through = parseDate(dueDateText);
      const mode = /(之前|以前|及以前|为止|截至|截止到)/.test(message) ? "through" : "exact";
      if (through) return formatDueList(allTasks, through, mode, showCompleted);
    }

    if (
      /(删除|删掉|移除|清除|清空).*(所有|全部)?.*(已完成|完成项)|(清空|清除).*(已完成|完成项)/.test(
        message,
      )
    ) {
      const completed = allTasks.filter((task) => task.done);
      if (!completed.length) return "没有已完成的任务需要删除。";
      return confirmDeletion(`删除 ${completed.length} 条已完成任务`, () => {
        for (const task of completed) tasks.remove(task.id);
        return `已删除 ${completed.length} 条已完成任务，未完成任务已保留。`;
      });
    }

    if (
      /(删除|删掉|移除|清除).*(所有|全部).*(任务|待办|事项)|(清空|清除).*(清单|列表|待办)/.test(
        message,
      )
    ) {
      if (!allTasks.length) return "待办清单已经是空的。";
      return confirmDeletion(`删除全部 ${allTasks.length} 条任务`, () => {
        for (const task of allTasks) tasks.remove(task.id);
        return `已删除全部 ${allTasks.length} 条任务。`;
      });
    }

    const batchDelete = message.match(
      /^(?:批量)?(?:删除|删掉|移除|清除)(?:这些|以下)?(?:任务|待办)?[：:，,\s]*(.+)$/,
    );
    if (batchDelete) {
      const targets = splitBatch(batchDelete[1]);
      if (targets.length > 1) {
        const resolved = targets.map((target) => ({ target, match: oneMatch(allTasks, target) }));
        const invalid = resolved.filter(({ match }) => Array.isArray(match));
        if (invalid.length)
          return `未执行删除，请确认这些任务名称：${invalid.map(({ target }) => `「${target}」`).join("、")}。`;
        const unique = new Map(resolved.map(({ match }) => [(match as Task).id, match as Task]));
        return confirmDeletion(`批量删除 ${unique.size} 条任务`, () => {
          for (const task of unique.values()) tasks.remove(task.id);
          return `已批量删除 ${unique.size} 条任务：${[...unique.values()].map((task) => `「${task.title}」`).join("、")}。`;
        });
      }
    }

    const subtask = message.match(
      /^给[「“]?(.+?)[」”]?(?:添加|新增|加)(?:一个|一条)?子任务[：:，,\s]*(.+)$/,
    );
    if (subtask) {
      const parent = oneMatch(allTasks, subtask[1]);
      if (Array.isArray(parent))
        return parent.length ? "找到多条相似的父任务，请说得更具体一些。" : "没有找到父任务。";
      const details = extractDeadline(subtask[2].replace(/[。！!]+$/, "").trim());
      if (!details.text) return "请告诉我子任务的具体内容。";
      const child = tasks.create({
        title: details.text,
        parentId: parent.id,
        deadline: details.deadline,
      });
      return `已在「${parent.title}」下添加子任务「${child.title}」${child.deadline ? `，截止 ${child.deadline}` : ""}。`;
    }

    const move = message.match(
      /^(?:把|将)?[「“]?(.+?)[」”]?(?:移到|放到|调到)(第(\d+)(?:条|位)?|最前面|最后面)$/,
    );
    if (move) {
      const found = oneMatch(allTasks, move[1]);
      if (Array.isArray(found))
        return found.length ? "找到多条相似任务，请说得更具体一些。" : "没有找到要调整的任务。";
      const requested =
        move[2] === "最后面" ? allTasks.length - 1 : move[2] === "最前面" ? 0 : Number(move[3]) - 1;
      const position = Math.max(0, Math.min(requested, allTasks.length - 1));
      tasks.move(found.id, position);
      return `已将「${found.title}」调整到第 ${position + 1} 条。`;
    }

    const priorityChange = message.match(
      /^(?:把|将)?[「“]?(.+?)[」”]?(?:设为|设置为|调为)(高|中|低)(?:优先级|重要程度)?$/,
    );
    if (priorityChange) {
      const found = oneMatch(allTasks, priorityChange[1]);
      if (Array.isArray(found))
        return found.length ? "找到多条相似任务，请说得更具体一些。" : "没有找到对应的任务。";
      const priority =
        priorityChange[2] === "高" ? "high" : priorityChange[2] === "中" ? "medium" : "low";
      tasks.update(found.id, { priority });
      return `已将「${found.title}」的重要程度设为${priorityChange[2]}。`;
    }

    const batchCreate = message.match(
      /^(?:批量)?(?:添加|新增|创建|记下)(?:这些|以下)?(?:任务|待办)?[：:，,\s]*(.+)$/,
    );
    if (batchCreate) {
      const parts = splitBatch(batchCreate[1]);
      if (parts.length > 1) {
        const seen = new Set(
          allTasks.filter((task) => !task.done).map((task) => normalize(task.title)),
        );
        const created: Task[] = [];
        const skipped: string[] = [];
        for (const part of parts) {
          const details = extractDeadline(part);
          const title = details.text ?? part;
          const key = normalize(title);
          if (seen.has(key)) {
            skipped.push(title);
            continue;
          }
          seen.add(key);
          created.push(tasks.create({ title, deadline: details.deadline }));
        }
        if (!created.length)
          return `这些待办都已存在：${skipped.map((title) => `「${title}」`).join("、")}。`;
        return `已批量添加 ${created.length} 条待办：${created.map((task) => `「${task.title}」`).join("、")}${skipped.length ? `；跳过已存在的 ${skipped.map((title) => `「${title}」`).join("、")}` : ""}。`;
      }
    }

    const extracted = extractDeadline(message);
    if (
      extracted.deadline &&
      extracted.text &&
      extracted.text !== message &&
      !CREATE_PREFIXES.some((prefix) => prefix.test(message))
    ) {
      const found = oneMatch(allTasks, extracted.text);
      if (Array.isArray(found))
        return found.length
          ? "找到多条相似任务，请说得更具体一些。"
          : "没有找到要设置截止时间的任务。";
      tasks.update(found.id, { deadline: extracted.deadline });
      return `已将「${found.title}」的截止时间设为 ${extracted.deadline}。`;
    }

    if (DELETE_PATTERN.test(message)) {
      const matches = findTasks(allTasks, message);
      if (!matches.length) return "没有找到要删除的任务，请说出更完整的任务名称。";
      if (matches.length > 1)
        return `找到多条相似任务：${matches.map((task) => `「${task.title}」`).join("、")}。请说得更具体一些。`;
      return confirmDeletion(`删除待办「${matches[0].title}」`, () => {
        tasks.remove(matches[0].id);
        return `已删除待办「${matches[0].title}」。`;
      });
    }

    if (COMPLETE_PATTERN.test(message)) {
      const matches = findTasks(allTasks, message);
      if (!matches.length) return "没有找到要完成的任务，请说出更完整的任务名称。";
      if (matches.length > 1)
        return `找到多条相似任务：${matches.map((task) => `「${task.title}」`).join("、")}。请说得更具体一些。`;
      if (matches[0].done) return `待办「${matches[0].title}」已经是已完成状态。`;
      tasks.update(matches[0].id, { done: true });
      return `做得好！已将「${matches[0].title}」标记为已完成。`;
    }

    for (const prefix of CREATE_PREFIXES) {
      if (!prefix.test(message)) continue;
      const raw = message
        .replace(prefix, "")
        .replace(/[。！!]+$/, "")
        .trim();
      const details = extractDeadline(raw);
      const title = details.text ?? raw;
      if (!title) return "请告诉我要记录的具体事情，例如“帮我记一下买牛奶”。";
      if (title.length > 200) return "任务名称太长了，请控制在 200 个字符以内。";
      const duplicate = allTasks.find(
        (task) => !task.done && normalize(task.title) === normalize(title),
      );
      if (duplicate) return `待办「${duplicate.title}」已经在清单里了。`;
      tasks.create({ title, deadline: details.deadline });
      return `已添加待办「${title}」${details.deadline ? `，截止 ${details.deadline}` : ""}。`;
    }

    if (LIST_PATTERN.test(message)) {
      const byDeadline =
        /(按|根据).*(截止|到期|deadline).*(排序|顺序)|(截止|到期|deadline).*(从近到远|排序)/i.test(
          message,
        );
      allTasks = tasks.list();
      return formatList(allTasks, showCompleted, byDeadline);
    }

    return "我可以帮你添加、查看、完成、删除、排序任务，也能管理子任务和截止时间。";
  };
}
