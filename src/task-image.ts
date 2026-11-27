export interface Task {
  id: string;
  title: string;
  done: boolean;
  deadline?: string | null;
  parentId?: string | null;
  priority?: "high" | "medium" | "low" | number | null;
}

export async function loadTasks(): Promise<Task[]> {
  const response = await fetch("/api/tasks");
  if (!response.ok) throw new Error("无法读取任务清单");
  return response.json() as Promise<Task[]>;
}

export function orderedTasks(tasks: Task[]) {
  const ids = new Set(tasks.map((task) => task.id));
  const result: Array<{ task: Task; depth: number }> = [];
  const append = (task: Task, depth: number) => {
    result.push({ task, depth });
    tasks
      .filter((child) => child.parentId === task.id)
      .forEach((child) => append(child, depth + 1));
  };
  tasks
    .filter((task) => !task.parentId || !ids.has(task.parentId))
    .forEach((task) => append(task, 0));
  return result;
}

export async function downloadTaskListImage() {
  const tasks = await loadTasks();
  const rows = orderedTasks(tasks);
  const width = 1200;
  const padding = 76;
  const rowHeight = 72;
  const headerHeight = 178;
  const footerHeight = 72;
  const height = Math.max(420, headerHeight + Math.max(rows.length, 1) * rowHeight + footerHeight);
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持图片导出");
  context.scale(scale, scale);

  context.fillStyle = "#f7f9fd";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#17243a";
  context.font = '700 42px "Microsoft YaHei", sans-serif';
  context.fillText("小明智能体 · 待办清单", padding, 76);
  const completed = tasks.filter((task) => task.done).length;
  context.fillStyle = "#637086";
  context.font = '24px "Microsoft YaHei", sans-serif';
  context.fillText(
    `共 ${tasks.length} 条 · ${tasks.length - completed} 条待完成 · ${completed} 条已完成`,
    padding,
    124,
  );

  if (!rows.length) {
    context.fillStyle = "#7a8699";
    context.font = '28px "Microsoft YaHei", sans-serif';
    context.fillText("清单还是空的", padding, headerHeight + 46);
  }

  rows.forEach(({ task, depth }, index) => {
    const y = headerHeight + index * rowHeight;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(padding, y, width - padding * 2, 56, 14);
    context.fill();

    const x = padding + 22 + depth * 46;
    context.fillStyle = task.done ? "#1f9d68" : "#3157d5";
    context.font = '28px "Microsoft YaHei", sans-serif';
    context.fillText(task.done ? "✓" : "○", x, y + 38);
    context.fillStyle = task.done ? "#7b8493" : "#233047";
    context.font = `${task.done ? "400" : "600"} 25px "Microsoft YaHei", sans-serif`;
    const priority =
      typeof task.priority === "string"
        ? ` · ${task.priority === "high" ? "高" : task.priority === "medium" ? "中" : "低"}优先级`
        : "";
    context.fillText(`${task.title}${priority}`, x + 42, y + 37);
    if (task.deadline) {
      context.fillStyle = "#7a5b19";
      context.font = '21px "Microsoft YaHei", sans-serif';
      context.textAlign = "right";
      context.fillText(`截止 ${task.deadline}`, width - padding - 22, y + 36);
      context.textAlign = "left";
    }
  });

  context.fillStyle = "#8a94a5";
  context.font = '18px "Microsoft YaHei", sans-serif';
  context.fillText(`导出于 ${new Date().toLocaleString("zh-CN")}`, padding, height - 30);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("图片生成失败"))),
      "image/png",
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `小明待办清单-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
