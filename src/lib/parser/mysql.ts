import type { PlanNode, ParsedPlan, PlanSummary } from "@/types";

/**
 * MySQL EXPLAIN parser.
 * Handles MySQL's tabular EXPLAIN and EXPLAIN ANALYZE (FORMAT=TREE) output.
 */

let nodeIdCounter = 0;

function generateNodeId(): string {
  return `node-${nodeIdCounter++}`;
}

export function parseMysqlExplain(explainOutput: string): ParsedPlan {
  const trimmed = explainOutput.trim();

  // Try JSON format (EXPLAIN FORMAT=JSON)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      return parseMysqlJson(json);
    } catch {
      // Fall through
    }
  }

  // Try tree format (EXPLAIN ANALYZE)
  if (trimmed.includes("->")) {
    return parseMysqlTree(trimmed);
  }

  // Parse tabular format
  return parseMysqlTabular(trimmed);
}

function parseMysqlJson(json: any): ParsedPlan {
  nodeIdCounter = 0;
  const nodes: PlanNode[] = [];
  const queryBlock = json.query_block || json;
  const root = convertMysqlJsonNode(queryBlock, 0, null, nodes);

  const maxCost = nodes.reduce((m, n) => Math.max(m, n.totalCost ?? 0), 0);
  const maxRows = nodes.reduce((m, n) => Math.max(m, n.planRows ?? 0), 0);

  return {
    root,
    nodes,
    maxCost,
    maxRows,
    maxTime: 0,
    totalTime: 0,
    totalCost: root.totalCost ?? 0,
    nodeCount: nodes.length,
    summary: buildMysqlSummary(nodes, root.totalCost ?? 0),
  };
}

function convertMysqlJsonNode(raw: any, level: number, parentId: string | null, allNodes: PlanNode[]): PlanNode {
  const node: PlanNode = {
    id: generateNodeId(),
    nodeType: mapMysqlAccessType(raw.access_type || raw.nested_loop?.join_type || "Unknown"),
    relationName: raw.table_name || raw.table,
    alias: raw.alias,
    startupCost: 0,
    totalCost: raw.cost_info?.query_cost ? parseFloat(raw.cost_info.query_cost) : 0,
    planRows: raw.rows_examined_per_scan || raw.rows_produced_per_join || raw.rows || 0,
    planWidth: 0,
    actualRows: raw.rows_produced_per_join,
    actualLoops: 1,
    parent: parentId,
    subplans: [],
    children: [],
    level,
    filter: raw.using_where ? "WHERE" : undefined,
    indexName: raw.key,
    indexCond: raw.used_key_parts ? raw.used_key_parts.join(", ") : undefined,
  };

  allNodes.push(node);

  // Nested loop children
  if (raw.nested_loop) {
    for (const child of raw.nested_loop) {
      const childNode = convertMysqlJsonNode(child, level + 1, node.id, allNodes);
      node.children!.push(childNode);
      node.subplans!.push(childNode);
    }
  }

  // Ordering operation
  if (raw.ordering_operation) {
    const orderNode: PlanNode = {
      id: generateNodeId(),
      nodeType: "Sort",
      parent: node.id,
      subplans: [],
      children: [],
      level: level + 1,
    };
    allNodes.push(orderNode);
    node.children!.push(orderNode);
    node.subplans!.push(orderNode);
  }

  // Grouping operation
  if (raw.grouping_operation) {
    const groupNode: PlanNode = {
      id: generateNodeId(),
      nodeType: "GroupAggregate",
      parent: node.id,
      subplans: [],
      children: [],
      level: level + 1,
    };
    allNodes.push(groupNode);
    node.children!.push(groupNode);
    node.subplans!.push(groupNode);
  }

  return node;
}

function parseMysqlTree(text: string): ParsedPlan {
  nodeIdCounter = 0;
  const lines = text.split("\n").filter((l) => l.trim());
  const nodes: PlanNode[] = [];
  const root = parseTreeLines(lines, nodes);

  return {
    root,
    nodes,
    maxCost: nodes.reduce((m, n) => Math.max(m, n.totalCost ?? 0), 0),
    maxRows: nodes.reduce((m, n) => Math.max(m, n.planRows ?? 0), 0),
    maxTime: nodes.reduce((m, n) => Math.max(m, n.actualTotalTime ?? 0), 0),
    totalTime: root.actualTotalTime ?? 0,
    totalCost: root.totalCost ?? 0,
    nodeCount: nodes.length,
    summary: buildMysqlSummary(nodes, root.totalCost ?? 0),
  };
}

function parseTreeLines(lines: string[], allNodes: PlanNode[]): PlanNode {
  const stack: { node: PlanNode; level: number }[] = [];
  let root: PlanNode | null = null;

  for (const line of lines) {
    const indent = (line.match(/^\s*/) || [""])[0].length;
    const level = Math.floor(indent / 2);
    const content = line.trim();

    // Extract node type
    const typeMatch = content.match(/->\s*(\w+(?:\s+\w+)?)/);
    const nodeType = typeMatch ? mapMysqlAccessType(typeMatch[1]) : "Unknown";

    // Extract cost
    const costMatch = content.match(/\(cost=([\d.]+)\s+rows=(\d+)\)/);
    const actualMatch = content.match(/\(actual\s+time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\)/);

    const node: PlanNode = {
      id: generateNodeId(),
      nodeType,
      startupCost: 0,
      totalCost: costMatch ? parseFloat(costMatch[1]) : 0,
      planRows: costMatch ? parseInt(costMatch[2]) : 0,
      actualStartupTime: actualMatch ? parseFloat(actualMatch[1]) : undefined,
      actualTotalTime: actualMatch ? parseFloat(actualMatch[2]) : undefined,
      actualRows: actualMatch ? parseInt(actualMatch[3]) : undefined,
      actualLoops: 1,
      parent: null,
      subplans: [],
      children: [],
      level,
    };

    // Extract table name
    const tableMatch = content.match(/on\s+(\w+)/);
    if (tableMatch) {
      node.relationName = tableMatch[1];
    }

    allNodes.push(node);

    if (stack.length === 0) {
      root = node;
      stack.push({ node, level });
    } else {
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      if (stack.length > 0) {
        const parent = stack[stack.length - 1].node;
        node.parent = parent.id;
        parent.children!.push(node);
        parent.subplans!.push(node);
      }
      stack.push({ node, level });
    }
  }

  return root!;
}

function parseMysqlTabular(text: string): ParsedPlan {
  nodeIdCounter = 0;
  const lines = text.split("\n").filter((l) => l.trim());
  const nodes: PlanNode[] = [];

  // Skip header line
  const dataLines = lines.filter((l) => !l.toLowerCase().includes("id") || !l.includes("\t"));

  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(/\t|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;

    const node: PlanNode = {
      id: generateNodeId(),
      nodeType: mapMysqlAccessType(parts[1] || "ALL"),
      relationName: parts[0],
      alias: parts[0],
      startupCost: 0,
      totalCost: 0,
      planRows: parseInt(parts[4] || "0") || 0,
      planWidth: 0,
      actualLoops: 1,
      parent: null,
      subplans: [],
      children: [],
      level: i,
      indexName: parts[3] && parts[3] !== "NULL" ? parts[3] : undefined,
    };

    nodes.push(node);
  }

  // Build linear chain
  for (let i = 1; i < nodes.length; i++) {
    nodes[i].parent = nodes[i - 1].id;
    nodes[i - 1].children!.push(nodes[i]);
    nodes[i - 1].subplans!.push(nodes[i]);
  }

  const root = nodes[0] || {
    id: "empty",
    nodeType: "Result",
    parent: null,
    subplans: [],
    children: [],
    level: 0,
  };

  return {
    root,
    nodes,
    maxCost: 0,
    maxRows: nodes.reduce((m, n) => Math.max(m, n.planRows ?? 0), 0),
    maxTime: 0,
    totalTime: 0,
    totalCost: 0,
    nodeCount: nodes.length,
    summary: buildMysqlSummary(nodes, 0),
  };
}

function mapMysqlAccessType(accessType: string): string {
  const mapping: Record<string, string> = {
    ALL: "Seq Scan",
    index: "Index Scan",
    range: "Index Scan",
    ref: "Index Scan",
    eq_ref: "Index Scan",
    const: "Index Only Scan",
    system: "Index Only Scan",
    NULL: "Result",
  };
  return mapping[accessType] || accessType;
}

function buildMysqlSummary(nodes: PlanNode[], totalCost: number): PlanSummary {
  const scanTypes: Record<string, number> = {};
  const joinTypes: Record<string, number> = {};
  let hasSeqScan = false;
  let hasSort = false;

  for (const node of nodes) {
    if (node.nodeType.includes("Scan")) {
      scanTypes[node.nodeType] = (scanTypes[node.nodeType] || 0) + 1;
    }
    if (node.nodeType.includes("Join") || node.nodeType.includes("Loop")) {
      joinTypes[node.nodeType] = (joinTypes[node.nodeType] || 0) + 1;
    }
    if (node.nodeType === "Seq Scan") hasSeqScan = true;
    if (node.nodeType === "Sort") hasSort = true;
  }

  return {
    totalCost,
    totalRows: nodes[0]?.planRows ?? 0,
    totalTime: 0,
    nodeCount: nodes.length,
    scanTypes,
    joinTypes,
    hasSeqScan,
    hasSort,
    estimatedComplexity: totalCost > 10000 ? "high" : totalCost > 1000 ? "medium" : "low",
  };
}
