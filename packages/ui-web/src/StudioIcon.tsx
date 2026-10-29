import type { SVGProps } from "react";

type Name =
  | "home" | "sparkles" | "compass" | "folder" | "user" | "clapper" | "settings"
  | "image" | "video" | "audio" | "text" | "plus" | "arrowUp" | "arrowRight"
  | "play" | "bell" | "clock" | "scan" | "box" | "search" | "share"
  | "download" | "chevronDown" | "check" | "upload" | "grid" | "cursor"
  | "hand" | "refresh" | "trash" | "link" | "x" | "more" | "film";

interface Props extends SVGProps<SVGSVGElement> { name: Name; size?: number }

export function StudioIcon({ name, size = 20, ...props }: Props) {
  const paths: Record<Name, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10H3z" /><path d="M9 20v-7h6v7" /></>,
    sparkles: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9z" /></>,
    folder: <path d="M3 6h6l2 2h10v11H3z" />,
    user: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="12" cy="9" r="2.5" /><path d="M7 18c.5-2.5 2.3-4 5-4s4.5 1.5 5 4" /></>,
    clapper: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M3 7 5 3h16v4M7 3l3 4m3-4 3 4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m4 18 6-6 3 3 3-4 5 7" /></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2" /><path d="m16 9 5-3v12l-5-3" /></>,
    audio: <><path d="M4 9v6m4-10v14m4-16v18m4-14v10m4-8v6" /></>,
    text: <><path d="M4 5h16M12 5v15M8 20h8" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    arrowUp: <><path d="M12 20V4m-6 6 6-6 6 6" /></>,
    arrowRight: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    play: <path d="m8 5 11 7-11 7z" />,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10" /><path d="M10 21h4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>,
    scan: <><path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5" /></>,
    box: <><path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10" /></>,
    search: <><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></>,
    share: <><circle cx="18" cy="5" r="2" /><circle cx="5" cy="12" r="2" /><circle cx="18" cy="19" r="2" /><path d="m7 11 9-5M7 13l9 5" /></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5M4 19v2h16v-2" /></>,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    check: <path d="m4 12 5 5L20 6" />,
    upload: <><path d="M12 17V4m-5 5 5-5 5 5M4 17v4h16v-4" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    cursor: <path d="m4 3 14 10-7 1-3 7z" />,
    hand: <><path d="M5 13V9a2 2 0 0 1 4 0v2-6a2 2 0 0 1 4 0v6-5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v5c0 5-3 8-8 8H9c-3 0-5-2-6-5l-1-3a2 2 0 0 1 3-1z" /></>,
    refresh: <><path d="M20 12a8 8 0 0 1-14 5M4 12A8 8 0 0 1 18 7" /><path d="M18 3v4h-4M6 21v-4h4" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7 .2l2-2a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7-.2l-2 2a5 5 0 0 0 7 7l1.5-1.5" /></>,
    x: <path d="M5 5 19 19M19 5 5 19" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16m10-16v16M3 9h4m-4 6h4m10-6h4m-4 6h4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
