import type { CSSProperties } from "react";

// Decorative signal field for login / research empty states.
// Keep this cheap: no SVG filters, few stroked paths, CSS owns any motion.
export function EvidenceWaves({ variant = "light" }: { variant?: "light" | "dark" }) {
  const paths = [
    "M-80 750 C 190 705, 350 875, 610 745 S 925 390, 1170 430 S 1445 695, 1740 440",
    "M-80 800 C 220 755, 390 910, 660 765 S 970 335, 1210 380 S 1470 635, 1740 380",
    "M-80 850 C 250 815, 445 938, 720 785 S 1025 295, 1260 330 S 1495 565, 1740 320",
    "M-80 900 C 290 875, 505 955, 790 805 S 1090 270, 1310 280 S 1525 495, 1740 260",
    "M-80 950 C 335 935, 575 965, 865 825 S 1160 255, 1360 230 S 1555 420, 1740 200"
  ];

  return (
    <div className={`evidence-waves is-${variant}`} aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`evidence-stroke-${variant}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.38" stopColor="currentColor" stopOpacity="0.08" />
            <stop offset="0.67" stopColor="currentColor" stopOpacity="0.74" />
            <stop offset="0.85" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`evidence-glow-${variant}`} cx="62%" cy="54%" r="38%">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="0.42" stopColor="currentColor" stopOpacity="0.07" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className="evidence-wave-glow" cx="1010" cy="500" rx="580" ry="330" fill={`url(#evidence-glow-${variant})`} />
        <g className="evidence-wave-lines" fill="none" stroke={`url(#evidence-stroke-${variant})`} strokeWidth="1">
          {paths.map((path, index) => (
            <path d={path} pathLength="1" style={{ "--wave-index": index } as CSSProperties} key={path} />
          ))}
        </g>
        <path
          className="evidence-wave-core"
          d="M-100 825 C 220 760, 450 930, 730 778 S 1030 300, 1260 342 S 1490 590, 1720 330"
          fill="none"
          stroke={`url(#evidence-stroke-${variant})`}
          strokeWidth="2"
          pathLength="1"
        />
      </svg>
    </div>
  );
}
