/** 导航图标集：统一 18px 线性图标，stroke 继承 currentColor */
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export type IconProps = { size?: number }

export function IconHome({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.8V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8" />
    </svg>
  )
}

export function IconSparkles({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 3.5 13.7 9l5.3 1.8-5.3 1.9L12 18l-1.7-5.3L5 10.8 10.3 9z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  )
}

export function IconImage({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="M4.5 17.5 9.6 13l3 2.6L15.8 12l3.7 5.5" />
    </svg>
  )
}

export function IconFilm({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M8 4.5v15M16 4.5v15M3.5 9.5h4.5M3.5 14.5h4.5M16 9.5h4.5M16 14.5h4.5" />
    </svg>
  )
}

export function IconLayers({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <path d="m12 3.5 8 4.2-8 4.3-8-4.3z" />
      <path d="m4 12.2 8 4.3 8-4.3" />
      <path d="m4 16.3 8 4.2 8-4.2" />
    </svg>
  )
}

export function IconDownload({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </svg>
  )
}

export function IconActivity({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M3.5 12.5h3.2l2.3-6 3.4 11 2.4-5h5.7" />
    </svg>
  )
}

export function IconWallet({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="6" width="17" height="12.5" rx="2.5" />
      <path d="M3.5 10h17" />
      <circle cx="16.5" cy="14" r="1.2" />
    </svg>
  )
}

export function IconLogout({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M14 5.5H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7" />
      <path d="M17.5 12H10" />
      <path d="m15 8.8 3.2 3.2L15 15.2" />
    </svg>
  )
}

export function IconRefresh({ size = 15 }: IconProps): React.ReactElement {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" />
      <path d="M19.5 4.5V9H15" />
    </svg>
  )
}
