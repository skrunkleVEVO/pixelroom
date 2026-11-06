// Line icons on a 24px grid, drawn with currentColor.
import type { ReactNode } from 'react';

function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const Back = (p: P) => <Icon {...p}><path d="M15 5l-7 7 7 7" /></Icon>;
export const Close = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const Check = (p: P) => <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const Undo = (p: P) => <Icon {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></Icon>;
export const Redo = (p: P) => <Icon {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></Icon>;
export const Compare = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
    <path d="M12 4h7a2 2 0 012 2v12a2 2 0 01-2 2h-7z" fill="currentColor" stroke="none" opacity="0.35" />
  </Icon>
);
export const Download = (p: P) => <Icon {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Icon>;
export const Share = (p: P) => (
  <Icon {...p}>
    <path d="M12 15V3.5M7.5 8L12 3.5 16.5 8" />
    <path d="M8 11H6a1 1 0 00-1 1v8a1 1 0 001 1h12a1 1 0 001-1v-8a1 1 0 00-1-1h-2" />
  </Icon>
);
export const Rotate = (p: P) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 0113.7-5.6L20 8.7" />
    <path d="M20 4v4.7h-4.7" />
    <rect x="7" y="12" width="9" height="8" rx="1.5" />
  </Icon>
);
export const Flip = (p: P) => (
  <Icon {...p}>
    <path d="M12 3v18" strokeDasharray="2 2.5" />
    <path d="M9 6L3 18h6z" />
    <path d="M15 6l6 12h-6z" fill="currentColor" opacity="0.35" />
  </Icon>
);
export const Plus = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const Trash = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
  </Icon>
);
export const Duplicate = (p: P) => (
  <Icon {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </Icon>
);
export const Pencil = (p: P) => <Icon {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Icon>;
export const Frame = (p: P) => (
  <Icon {...p}>
    <path d="M6 2v16h16" />
    <path d="M2 6h16v16" />
  </Icon>
);
export const Filters = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="9" r="5.5" />
    <circle cx="15" cy="9" r="5.5" />
    <circle cx="12" cy="15" r="5.5" />
  </Icon>
);
export const Sliders = (p: P) => (
  <Icon {...p}>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Icon>
);
export const TextIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7V5h16v2M12 5v14M9 19h6" />
  </Icon>
);
export const Sparkle = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </Icon>
);
export const ImageIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.8" />
    <path d="M21 16l-5-5-9 9" />
  </Icon>
);
export const Camera = (p: P) => (
  <Icon {...p}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Icon>
);
export const Shrink = (p: P) => (
  <Icon {...p}>
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </Icon>
);
export const AlignLeft = (p: P) => <Icon {...p}><path d="M4 6h16M4 12h10M4 18h13" /></Icon>;
export const AlignCenter = (p: P) => <Icon {...p}><path d="M4 6h16M7 12h10M5.5 18h13" /></Icon>;
export const AlignRight = (p: P) => <Icon {...p}><path d="M4 6h16M10 12h10M7 18h13" /></Icon>;
export const Reset = (p: P) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 108-8 8.5 8.5 0 00-6 2.5L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </Icon>
);
export const Phone = (p: P) => (
  <Icon {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </Icon>
);
export const Grid = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="3" width="8" height="18" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </Icon>
);
export const Swap = (p: P) => <Icon {...p}><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></Icon>;
