/** 骨架屏：任务中心等列表 Loading 状态（交互状态覆盖表） */
export function Skeleton({ rows = 3 }: { rows?: number }): React.ReactElement {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton__row" />
      ))}
    </div>
  )
}
