const labels: Record<string, string> = {
  waiting_approval: "等待确认", pending_submit: "等待提交", provider_queued: "排队中",
  running: "生成中", downloading: "正在保存", saved: "已完成", failed: "失败", unknown: "结果待确认",
};

export function TaskStatus({ state, message }: { state: string; message?: string }) {
  return <div className={`avs-task-status avs-task-status--${state}`} role="status"><span className="avs-task-status__dot" />
    <strong>{labels[state] ?? state}</strong>{message && <span>{message}</span>}</div>;
}
