import type { SVGProps } from "react";

/** The ear mark from the original Selatone Hearing website. */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 46 46" fill="none" aria-hidden="true" {...props}>
      <rect width="46" height="46" rx="7" fill="#3156A3" />
      <path d="M14 29c0-9 4-15 10-15 4 0 7 3 7 7 0 6-6 6-6 11a3.5 3.5 0 0 1-7 0" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M33 14c3 3 4.5 7 3.5 11M37 10c4.5 4.5 6 10.5 4.5 16" stroke="#42B3E5" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="23" r="2.2" fill="#42B3E5" />
    </svg>
  );
}
