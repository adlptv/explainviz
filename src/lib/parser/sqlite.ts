import type { PlanNode, ParsedPlan, PlanSummary } from "@/types";

/**
 * SQLite EXPLAIN QUERY PLAN parser.
 * SQLite outputs a simple 4-column format: id | parent | notused | detail
 */

let nodeIdCounter = 0;

function generateNodeId(): string {
  return `node-${nodeIdCounter++}`;
}

export function parseSqliteExplain(explainOutput: string): ParsedPlan {
  nodeIdCounter = 0;
  const lines = explainOutput.trim().split("\n").filter((l) => l.trim());
  const nodes: PlanNode[] = [];

  // Check if it's QUERY PLAN format or extended format
  if (lines.some((l) => l.includes("QUERY PLAN"))) {
    return parseSqliteQueryPlan(lines);
  }

  // Try JSON format
  if (explainOutput.trim().startsWith("[")) {
    try {
      const json = JSON.parse(explainOutput);
      return parseSqliteJson(json);
    } catch {
      // Fall through
    }
  }

  return parseSqliteQueryPlan(lines);
}

function parseSqliteQueryPlan(lines: string[]): ParsedPlan {
  const rawRows: { id: number; parent: number; detail: string }[] = [];

  for (const line of lines) {
    // Skip header lines
    if (line.includes("QUERY PLAN") || line.includes("---") || line.match(/^id\s+parent/i)) {
      continue;
    }

    // Parse: id | parent | notused | detail
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length >= 4) {
      rawRows.push({
        id: parseInt(parts[0]) || 0,
        parent: parseInt(parts[1]) || 0,
        detail: parts[3],
      });
    } else if (parts.length >= 1 && parts[0].match(/^\d+$/)) {
      // Tab-separated
      const tabs = line.split("\t").map((s) => s.trim());
      if (tabs.length >= 4) {
        rawRows.push({
          id: parseInt(tabs[0]) || 0,
          parent: parseInt(tabs[1]) || 0,
          detail: tabs[3],
        });
      }
    }
  }

  // Build nodes
  const nodeMap = new Map<number, PlanNode>();

  for (const row of rawRows) {
    const { nodeType, relationName, indexName, isSearch } = parseSqliteDetail(row.detail);
    const node: PlanNode = {
      id: generateNodeId(),
      nodeType,
      relationName,
      indexName,
      startupCost: 0,
      totalCost: 0,
      planRows: 0,
      planWidth: 0,
      actualLoops: 1,
      parent: null,
      subplans: [],
      children: [],
      level: 0,
    };
    nodeMap.set(row.id, node);
    nodes.push(node);
  }

  // Build tree from parent relationships
  let root: PlanNode | null = null;
  for (const row of rawRows) {
    const node = nodeMap.get(row.id);
    if (!node) continue;

    if (row.parent === 0 || row.parent === -1) {
      root = node;
      node.level = 0;
    } else {
      const parent = nodeMap.get(row.parent);
      if (parent) {
        node.parent = parent.id;
        node.level = parent.level + 1;
        parent.children!.push(node);
        parent.subplans!.push(node);
      } else {
        root = root || node;
      }
    }
  }

  if (!root) {
    root = nodes[0] || {
      id: "empty",
      nodeType: "Result",
      parent: null,
      subplans: [],
      children: [],
      level: 0,
    };
  }

  const totalCost = 0;
  const maxCost = 0;
  const maxRows = 0;

  return {
    root,
    nodes,
    maxCost,
    maxRows,
    maxTime: 0,
    totalTime: 0,
    totalCost,
    nodeCount: nodes.length,
    summary: buildSqliteSummary(nodes),
  };
}

function parseSqliteDetail(detail: string): {
  nodeType: string;
  relationName?: string;
  indexName?: string;
  isSearch: boolean;
} {
  // "SCAN table_name" → Seq Scan
  if (/^SCAN\s+/i.test(detail)) {
    const match = detail.match(/^SCAN\s+(\w+)/i);
    return { nodeType: "Seq Scan", relationName: match?.[1], isSearch: false };
  }

  // "SEARCH table_name USING INDEX idx_name (col)" → Index Scan
  if (/^SEARCH\s+/i.test(detail)) {
    const match = detail.match(/^SEARCH\s+(\w+)\s+USING\s+(?:COVERING\s+)?INDEX\s+(\w+)/i);
    if (match) {
      const isCovering = /COVERING/i.test(detail);
      return {
        nodeType: isCovering ? "Index Only Scan" : "Index Scan",
        relationName: match[1],
        indexName: match[2],
        isSearch: true,
      };
    }
    return { nodeType: "Index Scan", isSearch: true };
  }

  // "USE TEMP B-TREE FOR ORDER BY" → Sort
  if (/TEMP B-TREE FOR ORDER BY/i.test(detail)) {
    return { nodeType: "Sort", isSearch: false };
  }

  // "USE TEMP B-TREE FOR GROUP BY" → GroupAggregate
  if (/TEMP B-TREE FOR GROUP BY/i.test(detail)) {
    return { nodeType: "GroupAggregate", isSearch: false };
  }

  // "COMPOUND QUERY" → Append
  if (/COMPOUND QUERY/i.test(detail)) {
    return { nodeType: "Append", isSearch: false };
  }

  // "CORRELATED SCALAR SUBQUERY" → Subquery Scan
  if (/SCALAR SUBQUERY/i.test(detail)) {
    return { nodeType: "Subquery Scan", isSearch: false };
  }

  // "CO-ROUTINE" → Materialize
  if (/CO-ROUTINE/i.test(detail)) {
    return { nodeType: "Materialize", isSearch: false };
  }

  // "MATERIALIZE" → Materialize
  if (/MATERIALIZE/i.test(detail)) {
    return { nodeType: "Materialize", isSearch: false };
  }

  // Default
  return { nodeType: "Result", isSearch: false };
}

function parseSqliteJson(json: any[]): ParsedPlan {
  const nodes: PlanNode[] = [];
  nodeIdCounter = 0;

  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    const { nodeType, relationName, indexName } = parseSqliteDetail(row.detail || "");
    const node: PlanNode = {
      id: generateNodeId(),
      nodeType,
      relationName,
      indexName,
      startupCost: 0,
      totalCost: 0,
      planRows: 0,
      planWidth: 0,
      actualLoops: 1,
      parent: null,
      subplans: [],
      children: [],
      level: 0,
    };
    nodes.push(node);
  }

  // Build tree from parent IDs
  const nodeMap = new Map<number, PlanNode>();
  nodes.forEach((n, i) => nodeMap.set(i, n));

  let root: PlanNode | null = null;
  for (let i = 0; i < json.length; i++) {
    const node = nodeMap.get(i)!;
    const parentId = json[i].parent_id ?? 0;
    if (parentId === 0 || parentId === -1) {
      root = node;
    } else {
      const parent = nodeMap.get(parentId);
      if (parent) {
        node.parent = parent.id;
        node.level = parent.level + 1;
        parent.children!.push(node);
        parent.subplans!.push(node);
      }
    }
  }

  if (!root) root = nodes[0] || { id: "empty", nodeType: "Result", parent: null, subplans: [], children: [], level: 0 };

  return {
    root,
    nodes,
    maxCost: 0,
    maxRows: 0,
    maxTime: 0,
    totalTime: 0,
    totalCost: 0,
    nodeCount: nodes.length,
    summary: buildSqliteSummary(nodes),
  };
}

function buildSqliteSummary(nodes: PlanNode[]): PlanSummary {
  const scanTypes: Record<string, number> = {};
  let hasSeqScan = false;
  let hasSort = false;

  for (const node of nodes) {
    if (node.nodeType.includes("Scan")) {
      scanTypes[node.nodeType] = (scanTypes[node.nodeType] || 0) + 1;
    }
    if (node.nodeType === "Seq Scan") hasSeqScan = true;
    if (node.nodeType === "Sort") hasSort = true;
  }

  return {
    totalCost: 0,
    totalRows: 0,
    totalTime: 0,
    nodeCount: nodes.length,
    scanTypes,
    joinTypes: {},
    hasSeqScan,
    hasSort,
    estimatedComplexity: hasSeqScan ? "medium" : "low",
  };
}
