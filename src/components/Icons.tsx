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
export const CropIcon = () => (
  <Icon size={18}>
    <path d="M7 2v15h15" />
    <path d="M2 7h15v15" />
  </Icon>
);
export const EyedropperIcon = () => (
  <Icon size={17}>
    <path d="m14 7 3 3" />
    <path d="M12.500 8.500 4 17v3h3l8.500-8.500" />
    <path d="M13 6l1.500-1.500a2.800 2.800 0 0 1 4 0l1 1a2.800 2.800 0 0 1 0 4L18 11z" />
  </Icon>
);
export const RotateLeftIcon = () => (
  <Icon size={17}>
    <path d="M4 4v5h5" />
    <path d="M4.500 9A8 8 0 1 1 4 14" />
  </Icon>
);
export const RotateRightIcon = () => (
  <Icon size={17}>
    <path d="M20 4v5h-5" />
    <path d="M19.500 9A8 8 0 1 0 20 14" />
  </Icon>
);
export const FlipIcon = () => (
  <Icon size={17}>
    <path d="M12 3v18" strokeDasharray="2 3" />
    <path d="M8 7 3 17h5z" />
    <path d="m16 7 5 10h-5z" />
  </Icon>
);
export const GridIcon = () => (
  <Icon size={17}>
    <rect x="3" y="3" width="5" height="5" />
    <rect x="10" y="3" width="5" height="5" />
    <rect x="17" y="3" width="4" height="5" />
    <rect x="3" y="10" width="5" height="5" />
    <rect x="10" y="10" width="5" height="5" />
    <rect x="17" y="10" width="4" height="5" />
    <rect x="3" y="17" width="5" height="4" />
    <rect x="10" y="17" width="5" height="4" />
    <rect x="17" y="17" width="4" height="4" />
  </Icon>
);
export const LoupeIcon = () => (
  <Icon size={17}>
    <rect x="4" y="5" width="16" height="14" />
  </Icon>
);
export const SplitIcon = () => (
  <Icon size={17}>
    <rect x="3" y="5" width="8" height="14" />
    <rect x="13" y="5" width="8" height="14" />
  </Icon>
);
export const FlagIcon = () => (
  <Icon size={15}>
    <path d="M6 21V4h12l-3 4.500L18 13H6" />
  </Icon>
);
export const StarIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="m12 3 2.700 5.900 6.300.8-4.600 4.400 1.200 6.400L12 17.300l-5.600 3.200 1.200-6.400L3 9.700l6.300-.8z" />
  </svg>
);
