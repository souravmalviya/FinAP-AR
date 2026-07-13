// The Verity mark: a V that doubles as a checkmark (truth + verification),
// with growth bars inside (finance + upward trend) and an accent dot.
// The same artwork lives in app/icon.svg as the browser favicon.
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Verity logo">
      <defs>
        <linearGradient id="verity-check" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1e40af" />
          <stop offset="0.55" stopColor="#0d9488" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="verity-bars" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2f6fd0" />
          <stop offset="1" stopColor="#12b886" />
        </linearGradient>
      </defs>
      {/* app-icon tile */}
      <rect x="1.5" y="1.5" width="61" height="61" rx="14" fill="#ffffff" stroke="#e6e8ee" strokeWidth="1.2" />
      {/* growth bars */}
      <rect x="29.5" y="31" width="5.2" height="13" rx="1.4" fill="url(#verity-bars)" />
      <rect x="36.5" y="26" width="5.2" height="18" rx="1.4" fill="url(#verity-bars)" />
      <rect x="43.5" y="20" width="5.2" height="24" rx="1.4" fill="url(#verity-bars)" />
      {/* navy left arm of the V */}
      <path d="M 16 15 L 31.5 47.5" fill="none" stroke="#16306b" strokeWidth="7.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* green checkmark tail = the V's right arm */}
      <path d="M 31.5 47.5 L 50.5 13.5" fill="none" stroke="url(#verity-check)" strokeWidth="7.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* accent dot */}
      <circle cx="32.4" cy="54.5" r="2.5" fill="#10b981" />
    </svg>
  );
}
