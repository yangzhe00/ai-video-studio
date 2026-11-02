/** Copy for interactive Web/Desktop dialogs. Keep contextual form and task status beside their controls. */
export type FeedbackKind = "warning" | "failure" | "info" | "success";

export interface FeedbackMessage {
  kind: FeedbackKind;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  inputLabel?: string;
}

export const feedbackMessages = {
  warning: {
    deleteNode: {
      kind: "warning", title: "删除这个节点？", description: "删除节点会同时断开相关连接。此操作无法撤销。",
      confirmLabel: "删除节点", cancelLabel: "取消",
    },
    overwriteCloudBrief: {
      kind: "warning", title: "覆盖云端原文？", description: "将用本端草稿覆盖当前云端版本。原始输入仍会保留。",
      confirmLabel: "确认覆盖", cancelLabel: "取消",
    },
    regenerateVideo: {
      kind: "warning", title: "重新生成这个视频节点？", description: "该节点已有视频。再次生成会创建新版本，后续费用仍需按生成流程确认。",
      confirmLabel: "继续生成", cancelLabel: "取消",
    },
  },
  failure: {
    copyShareAddress: {
      kind: "failure", title: "复制失败", description: "无法自动复制地址。请手动选择并复制当前显示的地址。",
      confirmLabel: "知道了",
    },
  },
  info: {
    newEpisode: {
      kind: "info", title: "新建分集", description: "输入新分集的名称，创建后可在画布中继续编排。",
      inputLabel: "分集名称", confirmLabel: "创建分集", cancelLabel: "取消",
    },
  },
  success: {},
} as const satisfies Record<FeedbackKind, Record<string, FeedbackMessage>>;
