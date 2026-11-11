/** 页头：标题 + 描述 + 右侧动作区 */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }): React.ReactElement {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__desc">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  )
}
