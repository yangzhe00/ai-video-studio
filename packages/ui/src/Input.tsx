import { forwardRef } from 'react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

/** 通用输入框，带标签与错误提示（样式来自 .field / .input 组件类） */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className = '', id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name
  return (
    <div className="field">
      {label && (
        <label htmlFor={inputId} className="field__label">
          {label}
        </label>
      )}
      <input ref={ref} id={inputId} className={`input${error ? ' has-error' : ''} ${className}`.trim()} {...rest} />
      {error && <span className="field__error">{error}</span>}
    </div>
  )
})
