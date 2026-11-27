import OpenAI from "openai";
import { z } from "zod";
import type { TaskStore } from "./task-store.ts";

export const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";

const modelIntentSchema = z.object({
  action: z.enum([
    "create",
    "create_many",
    "list",
    "list_completed",
    "list_due",
    "complete",
    "delete",
    "delete_many",
    "delete_all",
    "delete_completed",
    "set_deadline",
    "set_priority",
    "move",
    "create_subtask",
    "create_subtasks",
    "hide_completed",
    "show_all",
    "chat",
    "unknown",
  ]),
  title: z.string().trim().min(1).max(200).optional(),
  target: z.string().trim().min(1).max(200).optional(),
  parent: z.string().trim().min(1).max(200).optional(),
  deadline: z.string().date().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  position: z.number().int().nonnegative().optional(),
  sortByDeadline: z.boolean().optional(),
  dueMode: z.enum(["exact", "through"]).optional(),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        deadline: z.string().date().optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
  targets: z.array(z.string().trim().min(1).max(200)).min(1).max(50).optional(),
  reply: z.string().trim().min(1).max(500).optional(),
});

export type ModelIntent = z.infer<typeof modelIntentSchema>;
export type ModelInterpreter = (
  message: string,
  tasks: ReturnType<TaskStore["list"]>,
) => Promise<ModelIntent>;

export function getModelClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("请在 .env 中设置 DEEPSEEK_API_KEY 后重启服务。");
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
}

export function createModelInterpreter(client = getModelClient()): ModelInterpreter {
  return async (message, tasks) => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const taskSummary = tasks.map(({ id, title, done, deadline, parentId, priority }, index) => ({
      index,
      id,
      title,
      done,
      deadline: deadline ?? null,
      parentId: parentId ?? null,
      priority: priority ?? null,
    }));

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `你是待办清单的自然语言解析器。今天（上海时区）是 ${today}。
只输出一个 JSON 对象，不要解释。action 只能是：create、create_many、list、list_completed、list_due、complete、delete、delete_many、delete_all、delete_completed、set_deadline、set_priority、move、create_subtask、create_subtasks、hide_completed、show_all、chat、unknown。
字段约定：create 用 title 和可选 deadline、priority；create_many 用 items 数组，每项包含 title 和可选 deadline、priority；complete/delete/set_deadline/set_priority/move 用 target；delete_many 用 targets 字符串数组；set_deadline 还用 deadline；set_priority 还用 priority；move 用零基 position；create_subtask 用 parent、title 和可选 deadline、priority；create_subtasks 用 parent 和 items；list 可用 sortByDeadline；chat 用 reply。priority 只能是 high、medium、low，分别表示高、中、低重要程度。
用户一次明确要求添加多件不同的事时返回 create_many，例如“添加买牛奶、取快递和交水费”返回 {"action":"create_many","items":[{"title":"买牛奶"},{"title":"取快递"},{"title":"交水费"}]}。每项自己的时间只放在对应 item 的 deadline。
用户一句话中为同一个父任务提出多个步骤时返回 create_subtasks。例如“报告还要先查资料，再加个子任务整理数据”返回 {"action":"create_subtasks","parent":"报告","items":[{"title":"查资料"},{"title":"整理数据"}]}，不得只选其中一项；已经存在的子任务不要重复创建。
用户一次明确要求删除多个指定任务时返回 delete_many，例如“删除买牛奶和取快递”返回 {"action":"delete_many","targets":["买牛奶","取快递"]}。删除所有任务仍使用 delete_all。
用户要求按 deadline、DDL、截止日期先后排序时，list 必须返回 sortByDeadline: true；程序会把日期较近的任务排在前面，没有 deadline 的任务排在最后。
用户说“把论文设为高优先级/重要程度高”时返回 {"action":"set_priority","target":"论文","priority":"high"}。日期相同时按 high、medium、low、未设置排序；都没有日期时也按这个重要程度顺序。
用户要求“只展示已完成任务、看看完成了哪些”时返回 {"action":"list_completed"}，这只是查看，不能删除或修改任务。
用户查询“今天/明天/后天有哪些任务到期”时返回 {"action":"list_due","deadline":"YYYY-MM-DD","dueMode":"exact"}，只展示 deadline 恰好等于指定日期的任务。
用户查询“今天之前、截至明天、某日及以前有哪些任务到期”时返回 {"action":"list_due","deadline":"YYYY-MM-DD","dueMode":"through"}，展示 deadline <= 指定日期的任务并包含当天。必须根据用户措辞选择 exact 或 through。
查询中的 deadline 必须是用户明确提到的日期本身，不能因为“之前”而减去一天。例如今天是 2026-11-28 时，“明天之前有哪些任务到期”必须返回 deadline: "2026-11-29" 和 dueMode: "through"，因为本系统的“之前”包含对应日期当天。
用户明确要求“删除所有任务、删掉全部待办、清空清单”时必须返回 {"action":"delete_all"}；只有出现删除、清空等动作时才能使用 delete_all，不能因为普通句子中出现“所有”就删除。
用户要求“删除所有已完成待办、清空完成项”时必须返回 {"action":"delete_completed"}，不能返回 delete_all，未完成任务必须保留。
当用户说“都做完了”时，不要理解为删除任务。
用户只是闲聊、问候或询问你的看法，并未要求操作或查看任务时，返回 {"action":"chat","reply":"简短自然的中文回复"}。闲聊绝不能创建、修改、完成或删除任务，也不要假装执行过操作。
只要用户的任务表达中出现时间（例如今天、明天、明晚、周五、下周、月底、某月某日），就必须将它换算为 YYYY-MM-DD 并放入 deadline；“明天下班时”“明天路上”等也表示该任务的 deadline 是明天。
例如用户说“家里牛奶快没了，明天下班路上带一瓶”，应输出 {"action":"create","title":"买一瓶牛奶","deadline":"明天对应的 YYYY-MM-DD"}。
没有提到时间时不要编造 deadline。无法可靠判断意图时返回 {"action":"unknown"}，不要编造任务名称。`,
        },
        {
          role: "user",
          content: `当前任务：${JSON.stringify(taskSummary)}\n用户输入：${message}\n请输出 JSON。`,
        },
      ],
    });

    const content = completion.choices[0]?.message.content?.trim();
    if (!content) return { action: "unknown" };
    return modelIntentSchema.parse(JSON.parse(content));
  };
}
