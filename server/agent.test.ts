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
  assert.match(await say("取快递这条删掉吧"), /已删除/);
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
