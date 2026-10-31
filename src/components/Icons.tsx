import type { ReactNode } from 'react';

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const OpenIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5L6 20" />
  </Icon>
);
export const UndoIcon = () => (
  <Icon>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h10a6 6 0 0 1 6 6v1" />
  </Icon>
);
export const RedoIcon = () => (
  <Icon>
    <path d="m15 7 5 5-5 5" />
    <path d="M20 12H10a6 6 0 0 0-6 6v1" />
  </Icon>
);
export const ResetIcon = () => (
  <Icon>
    <path d="M4 4v6h6" />
    <path d="M4.5 15a8 8 0 1 0 1.3-8.3L4 10" />
  </Icon>
);
export const CompareIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 2v20" />
    <path d="M12 4h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7z" fill="currentColor" stroke="none" opacity=".45" />
  </Icon>
);
export const ExportIcon = () => (
  <Icon>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon size={18}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 19h16" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon size={18}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="m6 7 1 13h10l1-13" />
  </Icon>
);
export const ChevronIcon = () => (
  <Icon size={16}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const PresetsIcon = () => (
  <Icon>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </Icon>
);
export const LightIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
  </Icon>
);
export const ColorIcon = () => (
  <Icon>
    <path d="M12 3s7 7.2 7 12a7 7 0 0 1-14 0c0-4.800 7-12 7-12Z" />
  </Icon>
);
export const PresenceIcon = () => (
  <Icon>
    <path d="M3 12h4l2.500-7 5 14 2.500-7h4" />
  </Icon>
);
export const CurveIcon = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M6 18c5 0 3-12 12-12" />
  </Icon>
);
export const MixerIcon = () => (
  <Icon>
    <circle cx="9" cy="9" r="5.500" />
    <circle cx="15" cy="9" r="5.500" />
    <circle cx="12" cy="15" r="5.500" />
  </Icon>
);
export const GradingIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v9l7.800 4.500M12 12l-7.800 4.500" />
  </Icon>
);
export const EffectsIcon = () => (
  <Icon>
    <path d="m12 3 1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800Z" />
    <path d="M19 16v4M17 18h4" />
  </Icon>
);
