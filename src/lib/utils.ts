import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

export function sanitizeInput(input: string): string {
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function getColorForCost(cost: number, maxCost: number): string {
  const ratio = maxCost > 0 ? cost / maxCost : 0;
  if (ratio > 0.7) return "#ef4444";
  if (ratio > 0.4) return "#f59e0b";
  if (ratio > 0.2) return "#eab308";
  return "#22c55e";
}

export function getNodeColor(nodeType: string): string {
  const colors: Record<string, string> = {
    "Seq Scan": "#ef4444",
    "Index Scan": "#22c55e",
    "Index Only Scan": "#16a34a",
    "Bitmap Index Scan": "#84cc16",
    "Bitmap Heap Scan": "#a3e635",
    "Nested Loop": "#3b82f6",
    "Hash Join": "#8b5cf6",
    "Merge Join": "#a855f7",
    "Hash": "#d946ef",
    "Sort": "#f59e0b",
    "Aggregate": "#06b6d4",
    "GroupAggregate": "#0891b2",
    "Limit": "#64748b",
    "Append": "#6366f1",
    "Subquery Scan": "#ec4899",
    "CTE Scan": "#f43f5e",
    "Materialize": "#14b8a6",
    "Gather": "#f97316",
    "WindowAgg": "#adfa1d",
    "Unique": "#7c3aed",
    "SetOp": "#9333ea",
    "Recursive Union": "#c026d3",
    "Result": "#94a3b8",
  };
  return colors[nodeType] || "#6b7280";
}
