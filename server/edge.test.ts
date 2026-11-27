import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createAgent, type ChatMessage } from "./agent.ts";
import { createJsonTaskStore } from "./task-store.ts";

async function setup(t: TestContext, interpret?: Parameters<typeof createAgent>[1]) {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-edge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  const reply = createAgent(tasks, interpret);
  const history: ChatMessage[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，欢迎使用小明智能体" },
  ];
  const say = (content: string) => reply([...history, { role: "user", content }]);
  return { tasks, say };
}

test("过短的模糊目标不会意外匹配全部任务", async (t) => {
  const { tasks, say } = await setup(t, async () => ({ action: "complete", target: "的" }));
  tasks.create("买牛奶");
  tasks.create("写报告");
  assert.match(await say("把这个完成了"), /没有找到/);
  assert.equal(tasks.list().filter((task) => task.done).length, 0);
});

test("等待删除确认时不会执行插入的其他指令", async (t) => {
  let modelCalls = 0;
  const { tasks, say } = await setup(t, async () => {
    modelCalls += 1;
    return { action: "delete_all" };
  });
  tasks.create("保留任务");
  assert.match(await say("清空清单"), /确认删除/);
  assert.match(await say("再添加一条新任务"), /待确认操作/);
  assert.equal(modelCalls, 1);
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["保留任务"],
  );
  assert.match(await say("取消"), /已取消/);
});

test("删除父任务时级联删除多层子任务但保留无关任务", async (t) => {
  const { tasks } = await setup(t);
  const parent = tasks.create("父任务");
  const child = tasks.create({ title: "子任务", parentId: parent.id });
  tasks.create({ title: "孙任务", parentId: child.id });
  tasks.create("无关任务");
  assert.equal(tasks.remove(parent.id), true);
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["无关任务"],
  );
});

test("同一次批量创建中的重复项只创建一次", async (t) => {
  const { tasks, say } = await setup(t, async () => ({
    action: "create_many",
    items: [{ title: "读书" }, { title: "读书" }, { title: "跑步" }],
  }));
  assert.match(await say("添加读书、读书、跑步"), /批量添加 2 条.*跳过已存在/);
  assert.deepEqual(
    tasks.list().map((task) => task.title),
    ["读书", "跑步"],
  );
});

test("隐藏完成项后到期查询不会泄露已完成任务", async (t) => {
  let action: "hide" | "due" = "hide";
  const { tasks, say } = await setup(t, async () =>
    action === "hide"
      ? { action: "hide_completed" }
      : { action: "list_due", deadline: "2026-12-01", dueMode: "through" },
  );
  const done = tasks.create({ title: "已完成且到期", deadline: "2026-12-01" });
  tasks.update(done.id, { done: true });
  tasks.create({ title: "未完成且到期", deadline: "2026-12-01" });
  await say("隐藏完成项");
  action = "due";
  const answer = await say("截至12月1日有哪些任务到期");
  assert.match(answer, /未完成且到期/);
  assert.doesNotMatch(answer, /已完成且到期/);
});

test("相同日期和重要程度的任务保持原有顺序", async (t) => {
  const { tasks, say } = await setup(t, async () => ({ action: "list", sortByDeadline: true }));
  tasks.create({ title: "第一条", deadline: "2026-12-01", priority: "high" });
  tasks.create({ title: "第二条", deadline: "2026-12-01", priority: "high" });
  const answer = await say("排序");
  assert.ok(answer.indexOf("第一条") < answer.indexOf("第二条"));
});
