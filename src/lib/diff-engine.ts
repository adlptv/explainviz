import type { ParsedPlan, PlanNode, DiffResult, PlanNodeDiff, PlanSummary } from "@/types";
import { parseExplain } from "./parser";

/**
 * Diff Engine — compares two query plans and identifies differences.
 */

export function diffPlans(
  planA: ParsedPlan,
  planB: ParsedPlan
): DiffResult {
  const nodesA = flattenNodes(planA.root);
  const nodesB = flattenNodes(planB.root);

  const mapA = new Map<string, PlanNode>();
  const mapB = new Map<string, PlanNode>();

  for (const n of nodesA) mapA.set(getNodeKey(n), n);
  for (const n of nodesB) mapB.set(getNodeKey(n), n);

  const added: PlanNode[] = [];
  const removed: PlanNode[] = [];
  const modified: PlanNodeDiff[] = [];
  const unchanged: PlanNode[] = [];

  // Find added and modified nodes
  for (const nodeB of nodesB) {
    const key = getNodeKey(nodeB);
    const nodeA = mapA.get(key);
    if (!nodeA) {
      added.push(nodeB);
    } else {
      // Compare fields
      const diffs = compareNodes(nodeA, nodeB);
      if (diffs.length > 0) {
        modified.push(...diffs);
      } else {
        unchanged.push(nodeB);
      }
    }
  }

  // Find removed nodes
  for (const nodeA of nodesA) {
    const key = getNodeKey(nodeA);
    if (!mapB.has(key)) {
      removed.push(nodeA);
    }
  }

  const costDelta = planB.totalCost - planA.totalCost;
  const timeDelta = (planB.totalTime || 0) - (planA.totalTime || 0);
  const rowDelta = (planB.root.planRows || 0) - (planA.root.planRows || 0);

  let improvement: "better" | "worse" | "neutral" = "neutral";
  if (costDelta < -100 || timeDelta < -10) improvement = "better";
  else if (costDelta > 100 || timeDelta > 10) improvement = "worse";

  return {
    added,
    removed,
    modified,
    unchanged,
    summary: {
      planA: planA.summary,
      planB: planB.summary,
      costDelta,
      timeDelta,
      rowDelta,
      improvement,
    },
  };
}

export function diffFromRaw(
  explainA: string,
  explainB: string,
  databaseType: "postgresql" | "mysql" | "sqlite" = "postgresql"
): DiffResult {
  const planA = parseExplain(explainA, databaseType);
  const planB = parseExplain(explainB, databaseType);
  return diffPlans(planA, planB);
}

function flattenNodes(node: PlanNode, result: PlanNode[] = []): PlanNode[] {
  result.push(node);
  for (const child of node.children || []) {
    flattenNodes(child, result);
  }
  return result;
}

function getNodeKey(node: PlanNode): string {
  // Create a signature based on node type, relation, and level
  const parts = [
    node.nodeType,
    node.relationName || "",
    node.alias || "",
    node.indexName || "",
    String(node.level),
  ];
  return parts.join("|");
}

function compareNodes(a: PlanNode, b: PlanNode): PlanNodeDiff[] {
  const diffs: PlanNodeDiff[] = [];
  const fields: Array<{ key: keyof PlanNode; label: string; severity: "info" | "warning" | "critical" }> = [
    { key: "totalCost", label: "Total Cost", severity: "warning" },
    { key: "planRows", label: "Estimated Rows", severity: "info" },
    { key: "actualTotalTime", label: "Actual Time", severity: "warning" },
    { key: "actualRows", label: "Actual Rows", severity: "info" },
    { key: "actualLoops", label: "Loops", severity: "info" },
    { key: "startupCost", label: "Startup Cost", severity: "info" },
    { key: "filter", label: "Filter", severity: "warning" },
    { key: "indexCond", label: "Index Condition", severity: "info" },
    { key: "sortKey", label: "Sort Key", severity: "info" },
    { key: "joinType", label: "Join Type", severity: "critical" },
    { key: "hashCond", label: "Hash Condition", severity: "info" },
    { key: "strategy", label: "Strategy", severity: "warning" },
  ];

  for (const field of fields) {
    const valA = a[field.key];
    const valB = b[field.key];

    if (valA === undefined && valB === undefined) continue;
    if (valA === undefined || valB === undefined) {
      if (valA !== valB) {
        diffs.push({
          nodeType: a.nodeType,
          field: field.label,
          oldValue: valA ?? "N/A",
          newValue: valB ?? "N/A",
          severity: field.severity,
        });
      }
      continue;
    }

    if (Array.isArray(valA) && Array.isArray(valB)) {
      if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        diffs.push({
          nodeType: a.nodeType,
          field: field.label,
          oldValue: Array.isArray(valA) ? valA.join(", ") : String(valA),
          newValue: Array.isArray(valB) ? valB.join(", ") : String(valB),
          severity: field.severity,
        });
      }
      continue;
    }

    if (typeof valA === "number" && typeof valB === "number") {
      const delta = Math.abs(valB - valA);
      const threshold = Math.max(Math.abs(valA) * 0.05, 1);
      if (delta > threshold) {
        diffs.push({
          nodeType: a.nodeType,
          field: field.label,
          oldValue: valA,
          newValue: valB,
          severity: field.severity,
        });
      }
    } else if (String(valA) !== String(valB)) {
      diffs.push({
        nodeType: a.nodeType,
        field: field.label,
        oldValue: String(valA),
        newValue: String(valB),
        severity: field.severity,
      });
    }
  }

  return diffs;
}
