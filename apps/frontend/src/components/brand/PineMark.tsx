/** Pine Lodge brand mark: a two-tier pine, drawn to stay crisp at chip sizes. */
export function PineMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <path d="M16 3.5 L22.4 12.8 H19.3 L24.6 20.6 H7.4 L12.7 12.8 H9.6 Z" fill="currentColor" />
      <rect x="14.4" y="20.6" width="3.2" height="6.6" rx="1.6" fill="currentColor" />
    </svg>
  );
}
