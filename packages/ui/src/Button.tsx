import { forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** 加载中自动禁用（防重复提交，FR-A-01） */
  loading?: boolean
  /** 占满父容器宽度 */
  block?: boolean
}

/** 通用按钮：样式全部来自原子层组件类，换肤零改动 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, block = false, disabled, className = '', children, ...rest },
  ref,
) {
  const cls = ['btn', `btn--${variant}`, size === 'sm' ? 'btn--sm' : '', block ? 'btn--block' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <button ref={ref} disabled={disabled || loading} className={cls} {...rest}>
      {loading && <span className="btn__spinner" aria-hidden />}
      {children}
    </button>
  )
})
