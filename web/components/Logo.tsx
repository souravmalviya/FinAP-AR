// The Verity mark: a V drawn as a checkmark - truth and verification in one
// stroke. Used in the top bar, login, and register pages (favicon lives in
// app/icon.svg with the same artwork).
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Verity logo">
      <defs>
        <linearGradient id="vg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#vg)" />
      <path
        d="M 17 25 L 29 46 L 48 15"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
