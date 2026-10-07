// Jeu d'icônes au trait (24 × 24), dessinées pour Mizu.
const P = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>,
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  receipt: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 7.5h6M9 11.5h6M9 15.5h4" /></>,
  pie: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
  shield: <><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M16.5 14.6c2.6.2 4.4 1.9 5 4.9" /></>,
  truck: <><path d="M2.5 6.5h11v10h-11z" /><path d="M13.5 9.5h4l3 3.5v3.5h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  megaphone: <><path d="M3.5 10v4l3 .5L17 19V5L6.5 9.5z" /><path d="M6.5 14.5 8 20h2.5l-1-5" /><path d="M20 9.5v5" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  camera: <><path d="M3 8h4l1.8-2.5h6.4L17 8h4v11H3z" /><circle cx="12" cy="13" r="3.6" /></>,
  tag: <><path d="M3 3h8l10 10-8 8L3 11z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  thermo: <><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" /><path d="M12 9v7.5" /></>,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></>,
  left: <path d="m15 5-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  logout: <><path d="M14 4h5v16h-5" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  download: <><path d="M12 4v11M7 10.5l5 5 5-5" /><path d="M4 19.5h16" /></>,
  alert: <><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>,
  building: <><path d="M4 21V5l8-2v18M12 8h8v13" /><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4.2 3.9-6.5 8-6.5s7.2 2.3 8 6.5" /></>,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  sparkles: <><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8-5.7-1.9L10.2 9z" /><path d="M19 3v3M17.5 4.5h3" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  coffee: <><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3.5v2.5M12 3.5v2.5" /></>,
  door: <><path d="M5 21V3h10v18" /><path d="M15 6h4v15" /><circle cx="12" cy="12.5" r="0.8" /></>,
  upload: <><path d="M12 16V5M7 9.5l5-5 5 5" /><path d="M4 19.5h16" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>,
  send: <><path d="M21 3 3 10.5l7 2.5 2.5 7z" /><path d="m21 3-11 10" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l2.5 2.5M15 8l2 2" /></>,
  broom: <><path d="M15 3 9.5 11" /><path d="M7 11h6l2 10H5z" /><path d="M8.5 15v4M11.5 15v4" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  archive: <><rect x="3" y="4" width="18" height="4.5" rx="1" /><path d="M5 8.5V20h14V8.5M10 12.5h4" /></>,
  wheat: <><path d="M12 21V8" /><path d="M12 12c-3 0-4.5-2-4.5-4.5C10.5 7.5 12 9.5 12 12zM12 12c3 0 4.5-2 4.5-4.5-3 0-4.5 2-4.5 4.5zM12 7.5C10 7.5 9 6 9 4c2 0 3 1.5 3 3.5zM12 7.5c2 0 3-1.5 3-3.5-2 0-3 1.5-3 3.5zM12 16.5c-3 0-4.5-2-4.5-4.5 3 0 4.5 2 4.5 4.5zM12 16.5c3 0 4.5-2 4.5-4.5-3 0-4.5 2-4.5 4.5z" /></>,
  trend: <><path d="M3 17 9 11l4 4 8-8" /><path d="M15 7h6v6" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  drag: <><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>,
};

export function Icon({ name, size = 20, className = '', strokeWidth = 1.8, title }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {P[name] || P.more}
    </svg>
  );
}

export function Logo({ size = 36, wordmark = true, light = false }) {
  return (
    <span className={`logo ${light ? 'logo--light' : ''}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="18" fill={light ? '#ffffff' : '#1f5f7a'} />
        <path d="M32 12c-7 9.5-14 17.4-14 25.2C18 45.4 24.3 52 32 52s14-6.6 14-14.8C46 29.4 39 21.5 32 12z" fill={light ? '#1f5f7a' : '#ffffff'} />
        <path d="M22.5 38.5c3.2 2.4 6.3 2.4 9.5 0s6.3-2.4 9.5 0" fill="none" stroke={light ? '#ffffff' : '#1f5f7a'} strokeWidth="3" strokeLinecap="round" />
      </svg>
      {wordmark && <span className="logo__word" style={{ fontSize: size * 0.62 }}>mizu</span>}
    </span>
  );
}
