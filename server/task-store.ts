import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const storedTask = z.looseObject({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  deadline: z.string().date().nullable().optional(),
  parentId: z.string().nullable().optional(),
  priority: z
    .union([z.enum(["high", "medium", "low"]), z.number()])
    .nullable()
    .optional(),
});
const taskList = z.array(storedTask);
type Task = z.infer<typeof storedTask>;
type Priority = "high" | "medium" | "low";
type TaskChanges = Partial<Pick<Task, "title" | "done" | "deadline" | "parentId">> & {
  priority?: Priority | null;
};
type NewTask = Pick<Task, "title"> &
  Partial<Pick<Task, "deadline" | "parentId">> & {
    priority?: Priority | null;
  };

export interface TaskStore {
  list(): Task[];
  create(input: string | NewTask): Task;
  update(id: string, changes: TaskChanges): Task | undefined;
  remove(id: string): boolean;
  move(id: string, position: number): Task[] | undefined;
}

export function createJsonTaskStore(filename: string): TaskStore {
  function list(): Task[] {
    if (!existsSync(filename)) return [];
    return taskList.parse(JSON.parse(readFileSync(filename, "utf8")));
  }

  // 同一服务进程内同步完成读写；替换文件前，原清单始终完整可读。
  function save(tasks: Task[]) {
    mkdirSync(dirname(filename), { recursive: true });
    const temporary = filename + ".tmp";
    writeFileSync(temporary, JSON.stringify(tasks, null, 2) + "\n");
    renameSync(temporary, filename);
  }

  return {
    list,

    create(input) {
      const details = typeof input === "string" ? { title: input } : input;
      const task: Task = { id: randomUUID(), ...details, done: false };
      save([...list(), task]);
      return task;
    },

    update(id, changes) {
      const tasks = list();
      const task = tasks.find((item) => item.id === id);
      if (!task) return undefined;

      Object.assign(task, changes);
      save(tasks);
      return task;
    },

    remove(id) {
      const tasks = list();
      const removed = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of tasks) {
          if (task.parentId && removed.has(task.parentId) && !removed.has(task.id)) {
            removed.add(task.id);
            changed = true;
          }
        }
      }
      const remaining = tasks.filter((task) => !removed.has(task.id));
      if (remaining.length === tasks.length) return false;

      save(remaining);
      return true;
    },

    move(id, position) {
      const tasks = list();
      const current = tasks.findIndex((task) => task.id === id);
      if (current < 0) return undefined;
      const [task] = tasks.splice(current, 1);
      const target = Math.max(0, Math.min(position, tasks.length));
      tasks.splice(target, 0, task);
      save(tasks);
      return tasks;
    },
  };
}
