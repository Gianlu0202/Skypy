export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="skypy-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f9cff" />
          <stop offset="1" stopColor="#7c6cff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#skypy-g)" />
      <g fill="#fff">
        <rect x="10" y="14" width="10" height="8" rx="2.5" opacity=".9" />
        <rect x="10" y="26" width="10" height="8" rx="2.5" opacity=".9" />
        <rect x="10" y="38" width="10" height="8" rx="2.5" opacity=".9" />
        <rect x="44" y="14" width="10" height="8" rx="2.5" opacity=".9" />
        <rect x="44" y="26" width="10" height="8" rx="2.5" opacity=".9" />
        <rect x="44" y="38" width="10" height="8" rx="2.5" opacity=".9" />
        <rect x="23" y="18" width="18" height="24" rx="3" />
      </g>
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">Skypy</span>
    </span>
  );
}
