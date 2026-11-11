/** 空态组件：统一空态引导（PRD Gate3 空状态项） */
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {description && <p className="empty__desc">{description}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}
