import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { loadTasks, orderedTasks } from "./task-image.ts";

const borders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
};

function headerCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill: "294A78", color: "auto" },
    margins: { top: 140, bottom: 140, left: 140, right: 140 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Microsoft YaHei" })],
      }),
    ],
  });
}

export async function downloadTaskListWord() {
  const tasks = await loadTasks();
  const rows = orderedTasks(tasks);
  const completed = tasks.filter((task) => task.done).length;
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell("状态", 1100),
        headerCell("任务", 4600),
        headerCell("重要程度", 1400),
        headerCell("截止日期", 2000),
      ],
    }),
    ...rows.map(
      ({ task, depth }, index) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 1100, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              shading: index % 2 ? { type: ShadingType.CLEAR, fill: "F4F7FB" } : undefined,
              margins: { top: 140, bottom: 140, left: 140, right: 140 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: task.done ? "已完成" : "待完成",
                      color: task.done ? "25845C" : "3157D5",
                      font: "Microsoft YaHei",
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 4600, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              shading: index % 2 ? { type: ShadingType.CLEAR, fill: "F4F7FB" } : undefined,
              margins: { top: 140, bottom: 140, left: 180 + depth * 280, right: 140 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `${depth ? "↳ " : ""}${task.title}`,
                      strike: task.done,
                      color: task.done ? "777777" : "222222",
                      font: "Microsoft YaHei",
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 1400, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              shading: index % 2 ? { type: ShadingType.CLEAR, fill: "F4F7FB" } : undefined,
              margins: { top: 140, bottom: 140, left: 140, right: 140 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text:
                        typeof task.priority === "string"
                          ? task.priority === "high"
                            ? "高"
                            : task.priority === "medium"
                              ? "中"
                              : "低"
                          : "—",
                      font: "Microsoft YaHei",
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 2000, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              shading: index % 2 ? { type: ShadingType.CLEAR, fill: "F4F7FB" } : undefined,
              margins: { top: 140, bottom: 140, left: 140, right: 140 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: task.deadline ?? "—", font: "Microsoft YaHei" })],
                }),
              ],
            }),
          ],
        }),
    ),
  ];

  if (!rows.length) {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 4,
            margins: { top: 220, bottom: 220, left: 160, right: 160 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "清单还是空的", color: "777777", font: "Microsoft YaHei" }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
  }

  const wordDocument = new Document({
    styles: {
      default: {
        document: { run: { font: "Microsoft YaHei", size: 22, color: "000000" } },
        title: { run: { font: "Microsoft YaHei", size: 36, bold: true, color: "000000" } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children: [
          new Paragraph({ text: "小明智能体待办清单", style: "Title", spacing: { after: 180 } }),
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: `共 ${tasks.length} 条任务，其中 ${tasks.length - completed} 条待完成，${completed} 条已完成。`,
                color: "555555",
                font: "Microsoft YaHei",
              }),
            ],
          }),
          new Table({
            width: { size: 9100, type: WidthType.DXA },
            columnWidths: [1100, 4600, 1400, 2000],
            borders,
            rows: tableRows,
          }),
          new Paragraph({
            spacing: { before: 260 },
            children: [
              new TextRun({
                text: `导出时间 ${new Date().toLocaleString("zh-CN")}`,
                size: 18,
                color: "777777",
                font: "Microsoft YaHei",
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(wordDocument);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `小明待办清单-${new Date().toISOString().slice(0, 10)}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}
