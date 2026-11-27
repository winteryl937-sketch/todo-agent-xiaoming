import { Router } from "express";
import { z } from "zod";
import type { TaskStore } from "./task-store.ts";

const deadlineSchema = z.string().date().nullable();
const createTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  deadline: deadlineSchema.optional(),
  parentId: z.string().nullable().optional(),
  priority: z.enum(["high", "medium", "low"]).nullable().optional(),
});
const updateTaskSchema = createTaskSchema
  .partial()
  .extend({ done: z.boolean().optional() })
  .refine((changes) => Object.keys(changes).length > 0);

const taskNotFound = { error: "找不到这条任务。" };

export function taskRouter(tasks: TaskStore) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(tasks.list());
  });

  router.post("/", (req, res) => {
    const input = createTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供 1 至 200 个字符的任务标题。" });
    }
    if (input.data.parentId && !tasks.list().some((task) => task.id === input.data.parentId)) {
      return res.status(400).json({ error: "父任务不存在。" });
    }
    res.status(201).json(tasks.create(input.data));
  });

  router.post("/:id/move", (req, res) => {
    const input = z.strictObject({ position: z.number().int().nonnegative() }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "position 必须是非负整数。" });
    const reordered = tasks.move(req.params.id, input.data.position);
    if (!reordered) return res.status(404).json(taskNotFound);
    res.json(reordered);
  });

  router.patch("/:id", (req, res) => {
    const input = updateTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res
        .status(400)
        .json({ error: "请提供有效的 title、done、deadline、parentId 或 priority 字段。" });
    }

    const updated = tasks.update(req.params.id, input.data);
    if (!updated) return res.status(404).json(taskNotFound);
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    if (!tasks.remove(req.params.id)) return res.status(404).json(taskNotFound);
    res.sendStatus(204);
  });

  return router;
}
