import type { Urgency } from "@/lib/types";

const URGENCY_RANK: Record<Urgency, number> = {
  none: 0,
  "heads-up": 1,
  "action-needed": 2,
  critical: 3,
};

export function urgencyRank(u: Urgency): number {
  return URGENCY_RANK[u] ?? 0;
}

export interface UrgencyStyle {
  label: string;
  /** Tailwind classes using §11 desaturated state tokens — NEVER red/alarming. */
  className: string;
}

export const URGENCY_STYLE: Record<Urgency, UrgencyStyle> = {
  critical: { label: "Critical", className: "border-overdue/30 bg-overdue/10 text-overdue" },
  "action-needed": {
    label: "Due soon",
    className: "border-due-soon/30 bg-due-soon/10 text-due-soon",
  },
  "heads-up": {
    label: "Heads-up",
    className: "border-due-soon/25 bg-due-soon/[0.06] text-due-soon",
  },
  none: { label: "On track", className: "border-on-track/30 bg-on-track/10 text-on-track" },
};
