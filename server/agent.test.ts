import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createAgent, type ChatMessage } from "./agent.ts";
import { createJsonTaskStore } from "./task-store.ts";

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-chat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  const reply = createAgent(tasks);
  const messages: ChatMessage[] = [];
  async function say(content: string) {
    messages.push({ role: "user", content });
    const answer = await reply(messages);
    messages.push({ role: "assistant", content: answer });
    return answer;
  }
  return { tasks, say };
}

test("首轮固定欢迎，随后完成验收对话", async (t) => {
  const { tasks, say } = await setup(t);
  assert.equal(await say("你好"), "你好，欢迎使用小明智能体");
  assert.match(await say("帮我记一下买牛奶"), /已添加.*买牛奶/);
  assert.match(await say("再记一条取快递"), /已添加.*取快递/);
  const list = await say("我有哪些任务？");
  assert.match(list, /⬜ 买牛奶/);
  assert.match(list, /⬜ 取快递/);
  assert.match(await say("牛奶买好了"), /已完成/);
  assert.equal(tasks.list()[0].done, true);
  assert.match(await say("取快递这条删掉吧"), /确认删除/);
  assert.match(await say("确认删除"), /已删除/);
  assert.deepEqual(
    tasks.list().map(({ title, done }) => ({ title, done })),
    [{ title: "买牛奶", done: true }],
  );
});

test("防止重复创建，并拒绝模糊修改多条任务", async (t) => {
  const { tasks, say } = await setup(t);
  await say("你好");
  await say("记一下买牛奶");
  assert.match(await say("再记一条买牛奶"), /已经在清单里/);
  await say("再记一条买牛奶和面包");
  assert.match(await say("买完成了"), /多条相似任务/);
  assert.equal(tasks.list().filter((task) => task.done).length, 0);
});

test("把提醒说法识别为新增待办", async (t) => {
  const { tasks, say } = await setup(t);
  await say("你好");
  assert.match(await say("提醒我学雅思"), /已添加.*学雅思/);
  assert.match(await say("提醒我买牛奶 截止明天"), /已添加.*买牛奶.*截止/);
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["学雅思", "买牛奶"],
  );
});

test("支持调整顺序、子任务、截止时间排序和隐藏完成项", async (t) => {
  const { tasks, say } = await setup(t);
  await say("你好");
  await say("记一下写报告 截止2026-12-10");
  await say("再记一条交水费 截止2026-12-01");
  assert.match(await say("给写报告添加子任务：整理数据 截止2026-12-05"), /已在.*写报告.*整理数据/);

  const sorted = await say("按deadline时间从近到远看看任务");
  assert.ok(sorted.indexOf("交水费") < sorted.indexOf("整理数据"));
  assert.ok(sorted.indexOf("整理数据") < sorted.indexOf("写报告"));
  assert.match(sorted, /↳ .*整理数据/);

  assert.match(await say("把交水费移到最后面"), /第 3 条/);
  assert.equal(tasks.list().at(-1)?.title, "交水费");
  await say("交水费完成了");
  const hidden = await say("隐藏所有已完成的任务");
  assert.doesNotMatch(hidden, /⬜ 交水费|✅ 交水费/);
  assert.match(await say("再给我看看清单"), /已隐藏完成项/);
  assert.doesNotMatch(await say("再给我看看清单"), /交水费/);
  assert.match(await say("显示全部任务"), /✅ 交水费/);
});

test("模型一次创建多个子任务且不会重复创建", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-subtasks-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  const parent = tasks.create("交报告");
  const reply = createAgent(tasks, async () => ({
    action: "create_subtasks",
    parent: "报告",
    items: [{ title: "查资料" }, { title: "整理数据" }],
  }));
  const history: ChatMessage[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
  ];

  assert.match(
    await reply([...history, { role: "user", content: "报告还要先查资料，再加个子任务整理数据" }]),
    /添加 2 个子任务.*查资料.*整理数据/,
  );
  assert.equal(tasks.list().filter((task) => task.parentId === parent.id).length, 2);
  assert.match(
    await reply([...history, { role: "user", content: "报告还要先查资料，再加个子任务整理数据" }]),
    /都已存在/,
  );
  assert.equal(tasks.list().filter((task) => task.parentId === parent.id).length, 2);
});

test("模糊完成‘买的’并支持只读闲聊", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-fuzzy-chat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  const milk = tasks.create("买两瓶牛奶");
  let chatting = false;
  const reply = createAgent(tasks, async () =>
    chatting
      ? { action: "chat", reply: "我今天状态不错，也很乐意帮你理清待办。" }
      : { action: "complete", target: "买的" },
  );
  const history: ChatMessage[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
  ];

  assert.match(await reply([...history, { role: "user", content: "把买的完成了" }]), /已完成/);
  assert.equal(tasks.list().find((task) => task.id === milk.id)?.done, true);
  chatting = true;
  const before = tasks.list();
  assert.match(
    await reply([...history, { role: "user", content: "你觉得今天心情怎么样？" }]),
    /状态不错/,
  );
  assert.deepEqual(tasks.list(), before);
});

test("规则无法识别时使用模型返回的结构化操作", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-model-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  const received: string[] = [];
  const reply = createAgent(tasks, async (message) => {
    received.push(message);
    return { action: "create", title: "买一瓶牛奶", deadline: "2026-11-28" };
  });

  await reply([{ role: "user", content: "你好" }]);
  const answer = await reply([
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
    { role: "user", content: "家里牛奶快没了，明天下班顺路带一瓶" },
  ]);
  assert.match(answer, /已添加.*买一瓶牛奶.*2026-11-28/);
  assert.deepEqual(received, ["家里牛奶快没了，明天下班顺路带一瓶"]);
  assert.equal(tasks.list()[0].title, "买一瓶牛奶");
});

test("模型优先处理，模型未知或失败时由规则兜底", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-priority-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  let behavior: "model" | "unknown" | "error" = "model";
  const reply = createAgent(tasks, async () => {
    if (behavior === "error") throw new Error("模拟网络错误");
    if (behavior === "unknown") return { action: "unknown" };
    return { action: "create", title: "由模型创建" };
  });
  const history: ChatMessage[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
  ];

  assert.match(
    await reply([...history, { role: "user", content: "帮我记一下规则任务" }]),
    /由模型创建/,
  );
  behavior = "unknown";
  assert.match(
    await reply([...history, { role: "user", content: "帮我记一下未知兜底" }]),
    /未知兜底/,
  );
  behavior = "error";
  assert.match(
    await reply([...history, { role: "user", content: "帮我记一下异常兜底" }]),
    /异常兜底/,
  );
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["由模型创建", "未知兜底", "异常兜底"],
  );
});

test("支持通过模型或规则一键删除所有待办", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-delete-all-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  tasks.create("任务一");
  tasks.create("任务二");
  const modelReply = createAgent(tasks, async () => ({ action: "delete_all" }));
  assert.match(
    await modelReply([
      { role: "user", content: "你好" },
      { role: "user", content: "这些都不用了" },
    ]),
    /确认删除/,
  );
  assert.equal(tasks.list().length, 2);
  assert.match(
    await modelReply([
      { role: "user", content: "你好" },
      { role: "user", content: "确认删除" },
    ]),
    /已删除全部 2 条任务/,
  );
  assert.deepEqual(tasks.list(), []);

  tasks.create("任务三");
  tasks.create("任务四");
  const ruleReply = createAgent(tasks, async () => ({ action: "unknown" }));
  assert.match(
    await ruleReply([
      { role: "user", content: "你好" },
      { role: "user", content: "清空待办清单" },
    ]),
    /确认删除/,
  );
  assert.match(
    await ruleReply([
      { role: "user", content: "你好" },
      { role: "user", content: "确认删除" },
    ]),
    /已删除全部 2 条任务/,
  );
  assert.deepEqual(tasks.list(), []);
});

test("删除操作可以取消且不会修改清单", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-cancel-delete-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  tasks.create("保留我");
  const reply = createAgent(tasks, async () => ({ action: "delete_all" }));
  const history: ChatMessage[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
  ];
  assert.match(await reply([...history, { role: "user", content: "清空清单" }]), /确认删除/);
  assert.match(await reply([...history, { role: "user", content: "取消" }]), /已取消/);
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["保留我"],
  );
});

test("删除所有已完成待办时保留未完成任务", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-delete-completed-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  const completed = tasks.create("已完成事项");
  tasks.update(completed.id, { done: true });
  tasks.create("仍需处理");
  const reply = createAgent(tasks, async () => ({ action: "delete_completed" }));

  assert.match(
    await reply([
      { role: "user", content: "你好" },
      { role: "user", content: "删除所有已完成待办" },
    ]),
    /确认删除/,
  );
  assert.match(
    await reply([
      { role: "user", content: "你好" },
      { role: "user", content: "确认删除" },
    ]),
    /已删除 1 条已完成任务.*未完成任务已保留/,
  );
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["仍需处理"],
  );
});

test("只展示已完成任务时隐藏未完成项", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-list-completed-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  const completed = tasks.create("已经完成");
  tasks.update(completed.id, { done: true });
  tasks.create("尚未完成");
  const reply = createAgent(tasks, async () => ({ action: "list_completed" }));

  const answer = await reply([
    { role: "user", content: "你好" },
    { role: "user", content: "只展示已完成的任务" },
  ]);
  assert.match(answer, /✅ 已经完成/);
  assert.doesNotMatch(answer, /尚未完成/);
  assert.equal(tasks.list().length, 2);
});

test("按指定日期查询此前及当天到期的任务", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-list-due-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  tasks.create({ title: "此前到期", deadline: "2026-11-27" });
  tasks.create({ title: "当天到期", deadline: "2026-11-28" });
  tasks.create({ title: "以后到期", deadline: "2026-11-29" });
  tasks.create("没有日期");
  const reply = createAgent(tasks, async () => ({
    action: "list_due",
    deadline: "2026-11-28",
    dueMode: "through",
  }));

  const answer = await reply([
    { role: "user", content: "你好" },
    { role: "user", content: "今天之前有哪些任务到期？" },
  ]);
  assert.match(answer, /截至 2026-11-28.*含当天/);
  assert.match(answer, /此前到期/);
  assert.match(answer, /当天到期/);
  assert.doesNotMatch(answer, /以后到期|没有日期/);
  assert.ok(answer.indexOf("此前到期") < answer.indexOf("当天到期"));
});

test("没有‘之前’时只查询指定日期当天到期的任务", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-list-due-exact-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  tasks.create({ title: "昨天到期", deadline: "2026-11-27" });
  tasks.create({ title: "今天到期", deadline: "2026-11-28" });
  const reply = createAgent(tasks, async () => ({
    action: "list_due",
    deadline: "2026-11-28",
    dueMode: "exact",
  }));

  const answer = await reply([
    { role: "user", content: "你好" },
    { role: "user", content: "今天有哪些任务到期？" },
  ]);
  assert.match(answer, /2026-11-28到期的任务/);
  assert.match(answer, /今天到期/);
  assert.doesNotMatch(answer, /昨天到期/);
});

test("按截止日期排序时无日期任务排在最后", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-deadline-order-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  tasks.create("没有日期甲");
  tasks.create({ title: "较晚", deadline: "2026-12-10" });
  tasks.create({ title: "最近", deadline: "2026-12-01" });
  tasks.create("没有日期乙");
  const reply = createAgent(tasks, async () => ({ action: "list", sortByDeadline: true }));

  const answer = await reply([
    { role: "user", content: "你好" },
    { role: "user", content: "按照ddl先后排序" },
  ]);
  assert.ok(answer.indexOf("最近") < answer.indexOf("较晚"));
  assert.ok(answer.indexOf("较晚") < answer.indexOf("没有日期甲"));
  assert.ok(answer.indexOf("没有日期甲") < answer.indexOf("没有日期乙"));
});

test("日期相同或都无日期时按重要程度排序", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-priority-order-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  tasks.create({ title: "同日低", deadline: "2026-12-01", priority: "low" });
  tasks.create({ title: "无日期低", priority: "low" });
  tasks.create({ title: "同日高", deadline: "2026-12-01", priority: "high" });
  tasks.create("无日期未设置");
  tasks.create({ title: "无日期高", priority: "high" });
  const reply = createAgent(tasks, async () => ({ action: "list", sortByDeadline: true }));
  const history: ChatMessage[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
  ];

  const answer = await reply([...history, { role: "user", content: "按ddl和重要程度排序" }]);
  assert.ok(answer.indexOf("同日高") < answer.indexOf("同日低"));
  assert.ok(answer.indexOf("同日低") < answer.indexOf("无日期高"));
  assert.ok(answer.indexOf("无日期高") < answer.indexOf("无日期低"));
  assert.ok(answer.indexOf("无日期低") < answer.indexOf("无日期未设置"));
  assert.match(answer, /同日高（高优先级）/);

  const setPriority = createAgent(tasks, async () => ({
    action: "set_priority",
    target: "无日期未设置",
    priority: "medium",
  }));
  assert.match(
    await setPriority([...history, { role: "user", content: "把无日期未设置设为中优先级" }]),
    /重要程度设为中/,
  );
  assert.equal(tasks.list().find((task) => task.title === "无日期未设置")?.priority, "medium");
});

test("支持批量创建和原子批量删除", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-batch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  let operation: "create" | "delete" | "invalid-delete" = "create";
  const reply = createAgent(tasks, async () => {
    if (operation === "create")
      return {
        action: "create_many",
        items: [
          { title: "买牛奶", deadline: "2026-12-01" },
          { title: "取快递" },
          { title: "交水费" },
        ],
      };
    if (operation === "delete") return { action: "delete_many", targets: ["买牛奶", "取快递"] };
    return { action: "delete_many", targets: ["交水费", "不存在"] };
  });
  const history: ChatMessage[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
  ];

  assert.match(await reply([...history, { role: "user", content: "添加三件事" }]), /批量添加 3 条/);
  operation = "invalid-delete";
  assert.match(await reply([...history, { role: "user", content: "删除两件事" }]), /未执行删除/);
  assert.equal(tasks.list().length, 3);
  operation = "delete";
  assert.match(await reply([...history, { role: "user", content: "删除两件事" }]), /确认删除/);
  assert.match(await reply([...history, { role: "user", content: "确认删除" }]), /批量删除 2 条/);
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["交水费"],
  );

  const ruleReply = createAgent(tasks, async () => ({ action: "unknown" }));
  assert.match(
    await ruleReply([...history, { role: "user", content: "批量添加跑步、读书" }]),
    /批量添加 2 条/,
  );
  assert.match(
    await ruleReply([...history, { role: "user", content: "批量删除跑步、读书" }]),
    /确认删除/,
  );
  assert.match(
    await ruleReply([...history, { role: "user", content: "确认删除" }]),
    /批量删除 2 条/,
  );
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["交水费"],
  );
});
