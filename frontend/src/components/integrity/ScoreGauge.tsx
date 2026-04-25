// ScoreGauge — circular arc gauge for a 0–100 score.
// Uses an inline SVG arc; no D3 dependency.

import type { FC } from "react";

interface Props {
  score: number;    // 0–100
  label: string;
  size?: number;    // px diameter (default 100)
  invertColor?: boolean; // true = lower score means RED (e.g. plagiarism risk %)
}

function scoreColor(score: number, invert: boolean): string {
  const effective = invert ? 100 - score : score;
  if (effective >= 80) return "#22c55e";   // green-500
  if (effective >= 55) return "#f59e0b";   // amber-500
  return "#ef4444";                         // red-500
}

const ScoreGauge: FC<Props> = ({ score, label, size = 100, invertColor = false }) => {
  const clampedScore = Math.max(0, Math.min(100, score));
  const radius = (size - 12) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (clampedScore / 100) * circumference;
  const color = scoreColor(clampedScore, invertColor);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={8}
        />
        {/* Progress arc — starts at top (−90°) */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${circumference}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        {/* Score label */}
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.22}
          fontWeight="700"
          fill={color}
        >
          {Math.round(clampedScore)}
        </text>
      </svg>
      <span className="text-center text-xs font-medium text-slate-600">{label}</span>
    </div>
  );
};

export default ScoreGauge;
