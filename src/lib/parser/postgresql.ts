import type { PlanNode, ParsedPlan, PlanSummary } from "@/types";

/**
 * PostgreSQL EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) parser.
 * Handles both JSON format and text format EXPLAIN output.
 */

const NODE_TYPE_PATTERNS: Record<string, RegExp> = {
  "Seq Scan": /^Seq Scan/i,
  "Index Scan": /^Index Scan/i,
  "Index Only Scan": /^Index Only Scan/i,
  "Bitmap Index Scan": /^Bitmap Index Scan/i,
  "Bitmap Heap Scan": /^Bitmap Heap Scan/i,
  "Nested Loop": /^Nested Loop/i,
  "Hash Join": /^Hash Join/i,
  "Merge Join": /^Merge Join/i,
  "Hash": /^Hash$/i,
  "Sort": /^Sort$/i,
  "Aggregate": /^Aggregate$/i,
  "GroupAggregate": /^GroupAggregate$/i,
  "Limit": /^Limit$/i,
  "Append": /^Append$/i,
  "Subquery Scan": /^Subquery Scan/i,
  "CTE Scan": /^CTE Scan/i,
  "Materialize": /^Materialize$/i,
  "Gather": /^Gather$/i,
  "WindowAgg": /^WindowAgg$/i,
  "Unique": /^Unique$/i,
  "SetOp": /^SetOp$/i,
  "Recursive Union": /^Recursive Union/i,
  "Result": /^Result$/i,
};

const SUPPORTED_NODE_TYPES = Object.keys(NODE_TYPE_PATTERNS);

let nodeIdCounter = 0;

function generateNodeId(): string {
  return `node-${nodeIdCounter++}`;
}

/**
 * Parse PostgreSQL EXPLAIN output.
 * Auto-detects JSON vs text format.
 */
export function parsePostgresExplain(explainOutput: string): ParsedPlan {
  const trimmed = explainOutput.trim();

  // Try JSON first
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      return parseJsonPlan(json);
    } catch {
      // Fall through to text parser
    }
  }

  // Parse text format
  return parseTextPlan(trimmed);
}

/**
 * Parse JSON-format EXPLAIN output.
 * Example: EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ...
 */
function parseJsonPlan(json: any[]): ParsedPlan {
  nodeIdCounter = 0;
  const planData = Array.isArray(json) ? json[0]?.Plan : json?.Plan;
  if (!planData) {
    throw new Error("No plan found in JSON EXPLAIN output");
  }

  const nodes: PlanNode[] = [];
  const root = convertJsonNode(planData, 0, null, nodes);

  const maxCost = findMax(nodes, (n) => n.totalCost ?? 0);
  const maxRows = findMax(nodes, (n) => n.planRows ?? 0);
  const maxTime = findMax(nodes, (n) => n.actualTotalTime ?? 0);
  const totalTime = root.actualTotalTime ?? 0;
  const totalCost = root.totalCost ?? 0;

  computeExclusiveTimes(root);

  return {
    root,
    nodes,
    maxCost,
    maxRows,
    maxTime,
    totalTime,
    totalCost,
    nodeCount: nodes.length,
    summary: buildSummary(nodes, totalCost, totalTime),
  };
}

function convertJsonNode(raw: any, level: number, parentId: string | null, allNodes: PlanNode[]): PlanNode {
  const node: PlanNode = {
    id: generateNodeId(),
    nodeType: raw["Node Type"] || "Unknown",
    relationName: raw["Relation Name"],
    alias: raw["Alias"],
    schema: raw["Schema"],
    startupCost: raw["Startup Cost"],
    totalCost: raw["Total Cost"],
    planRows: raw["Plan Rows"],
    planWidth: raw["Plan Width"],
    actualStartupTime: raw["Actual Startup Time"],
    actualTotalTime: raw["Actual Total Time"],
    actualRows: raw["Actual Rows"],
    actualLoops: raw["Actual Loops"],
    output: raw["Output"],
    filter: raw["Filter"],
    hashCond: raw["Hash Cond"],
    mergeCond: raw["Merge Cond"],
    joinType: raw["Join Type"],
    sortKey: raw["Sort Key"],
    sortMethod: raw["Sort Method"],
    groupKey: raw["Group Key"],
    strategy: raw["Strategy"],
    indexName: raw["Index Name"],
    indexCond: raw["Index Cond"],
    hashBuckets: raw["Hash Buckets"],
    hashBatches: raw["Hash Batches"],
    peakMemory: raw["Peak Memory"],
    sharedHitBlocks: raw["Shared Hit Blocks"],
    sharedReadBlocks: raw["Shared Read Blocks"],
    sharedDirtiedBlocks: raw["Shared Dirtied Blocks"],
    sharedWrittenBlocks: raw["Shared Written Blocks"],
    tempReadBlocks: raw["Temp Read Blocks"],
    tempWrittenBlocks: raw["Temp Written Blocks"],
    parent: parentId,
    subplans: [],
    children: [],
    level,
  };

  allNodes.push(node);

  // Process subplans
  const subplans = raw["Plans"] || raw["Child Plans"] || [];
  for (const sub of subplans) {
    const child = convertJsonNode(sub, level + 1, node.id, allNodes);
    node.children!.push(child);
    node.subplans!.push(child);
  }

  return node;
}

/**
 * Parse text-format EXPLAIN output.
 * Example: EXPLAIN ANALYZE SELECT ...
 */
function parseTextPlan(text: string): ParsedPlan {
  nodeIdCounter = 0;
  const lines = text.split("\n").filter((l) => l.trim());
  const nodes: PlanNode[] = [];

  const root = parseTextLines(lines, 0, null, nodes)[0];
  if (!root) {
    throw new Error("Failed to parse text EXPLAIN output — no nodes found");
  }

  const maxCost = findMax(nodes, (n) => n.totalCost ?? 0);
  const maxRows = findMax(nodes, (n) => n.planRows ?? 0);
  const maxTime = findMax(nodes, (n) => n.actualTotalTime ?? 0);
  const totalTime = root.actualTotalTime ?? 0;
  const totalCost = root.totalCost ?? 0;

  computeExclusiveTimes(root);

  return {
    root,
    nodes,
    maxCost,
    maxRows,
    maxTime,
    totalTime,
    totalCost,
    nodeCount: nodes.length,
    summary: buildSummary(nodes, totalCost, totalTime),
  };
}

function parseTextLines(
  lines: string[],
  startIdx: number,
  parentId: string | null,
  allNodes: PlanNode[]
): PlanNode[] {
  const result: PlanNode[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const indent = countLeadingSpaces(line);
    const content = line.trim();

    // Skip non-plan lines
    if (content.startsWith("Planning Time:") || content.startsWith("Execution Time:") || content.startsWith("Trigger") || content.startsWith("JIT:")) {
      i++;
      continue;
    }

    // Check if this line is a node header
    const nodeType = identifyNodeType(content);
    if (nodeType) {
      const node: PlanNode = {
        id: generateNodeId(),
        nodeType,
        parent: parentId,
        subplans: [],
        children: [],
        level: Math.floor(indent / 2),
      };

      // Extract relation name and alias from content
      const onMatch = content.match(/on\s+(\w+)(?:\s+(\w+))?/i);
      if (onMatch) {
        node.relationName = onMatch[1];
        node.alias = onMatch[2] || onMatch[1];
      }

      // Parse cost=(startup..total)
      const costMatch = content.match(/\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)/);
      if (costMatch) {
        node.startupCost = parseFloat(costMatch[1]);
        node.totalCost = parseFloat(costMatch[2]);
        node.planRows = parseInt(costMatch[3]);
        node.planWidth = parseInt(costMatch[4]);
      }

      // Parse actual time=(startup..total) rows= loops=
      const actualMatch = content.match(/\(actual\s+time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\)/);
      if (actualMatch) {
        node.actualStartupTime = parseFloat(actualMatch[1]);
        node.actualTotalTime = parseFloat(actualMatch[2]);
        node.actualRows = parseInt(actualMatch[3]);
        node.actualLoops = parseInt(actualMatch[4]);
      }

      // Parse detail lines (indented further)
      i++;
      while (i < lines.length) {
        const nextLine = lines[i];
        const nextIndent = countLeadingSpaces(nextLine);
        const nextContent = nextLine.trim();

        if (nextIndent <= indent && nextContent.length > 0) {
          break;
        }

        // Parse detail properties
        parseDetailLine(nextContent, node);
        i++;
      }

      allNodes.push(node);
      result.push(node);
    } else {
      i++;
    }
  }

  // Build parent-child relationships from levels
  rebuildTreeFromLevels(allNodes);

  return result;
}

function countLeadingSpaces(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function identifyNodeType(content: string): string | null {
  for (const [type, pattern] of Object.entries(NODE_TYPE_PATTERNS)) {
    if (pattern.test(content)) {
      return type;
    }
  }
  return null;
}

function parseDetailLine(content: string, node: PlanNode): void {
  // Key: value format
  const match = content.match(/^(\w[\w\s]*?):\s*(.*)$/);
  if (!match) return;

  const key = match[1].trim();
  const value = match[2].trim();

  switch (key.toLowerCase()) {
    case "output":
      node.output = value.split(", ").map((s) => s.trim());
      break;
    case "filter":
      node.filter = value;
      break;
    case "hash cond":
      node.hashCond = value;
      break;
    case "merge cond":
      node.mergeCond = value;
      break;
    case "join type":
    case "join filter":
      node.joinType = value;
      break;
    case "sort key":
    case "sort method":
      if (key.toLowerCase().includes("method")) {
        node.sortMethod = value;
      } else {
        node.sortKey = value.split(", ").map((s) => s.trim());
      }
      break;
    case "group key":
      node.groupKey = value.split(", ").map((s) => s.trim());
      break;
    case "strategy":
      node.strategy = value;
      break;
    case "index name":
    case "index cond":
      if (key.toLowerCase().includes("name")) {
        node.indexName = value;
      } else {
        node.indexCond = value;
      }
      break;
    case "hash buckets":
      node.hashBuckets = parseInt(value);
      break;
    case "hash batches":
      node.hashBatches = parseInt(value);
      break;
    case "peak memory":
      node.peakMemory = parseInt(value);
      break;
    case "shared hit blocks":
      node.sharedHitBlocks = parseInt(value);
      break;
    case "shared read blocks":
      node.sharedReadBlocks = parseInt(value);
      break;
    case "shared dirtied blocks":
      node.sharedDirtiedBlocks = parseInt(value);
      break;
    case "shared written blocks":
      node.sharedWrittenBlocks = parseInt(value);
      break;
    case "temp read blocks":
      node.tempReadBlocks = parseInt(value);
      break;
    case "temp written blocks":
      node.tempWrittenBlocks = parseInt(value);
      break;
    case "actual startup time":
      node.actualStartupTime = parseFloat(value);
      break;
    case "actual total time":
      node.actualTotalTime = parseFloat(value);
      break;
    case "actual rows":
      node.actualRows = parseInt(value);
      break;
    case "actual loops":
      node.actualLoops = parseInt(value);
      break;
  }
}

function rebuildTreeFromLevels(nodes: PlanNode[]): void {
  const root = nodes[0];
  if (!root) return;

  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    // Find parent: the closest preceding node with a lower level
    let parent: PlanNode | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (nodes[j].level < node.level) {
        parent = nodes[j];
        break;
      }
    }
    if (parent) {
      node.parent = parent.id;
      parent.children!.push(node);
      parent.subplans!.push(node);
    }
  }
}

function computeExclusiveTimes(node: PlanNode): void {
  const inclusive = node.actualTotalTime ?? 0;
  let childSum = 0;
  for (const child of node.children || []) {
    computeExclusiveTimes(child);
    childSum += child.exclusiveTime ?? 0;
  }
  node.inclusiveTime = inclusive;
  node.exclusiveTime = Math.max(0, inclusive - childSum);
}

function findMax<T>(arr: T[], fn: (item: T) => number): number {
  return arr.reduce((max, item) => Math.max(max, fn(item)), 0);
}

function buildSummary(nodes: PlanNode[], totalCost: number, totalTime: number): PlanSummary {
  const scanTypes: Record<string, number> = {};
  const joinTypes: Record<string, number> = {};
  let hasSeqScan = false;
  let hasSort = false;

  for (const node of nodes) {
    const type = node.nodeType;
    if (type.includes("Scan")) {
      scanTypes[type] = (scanTypes[type] || 0) + 1;
    }
    if (type.includes("Join")) {
      joinTypes[type] = (joinTypes[type] || 0) + 1;
    }
    if (type === "Seq Scan") hasSeqScan = true;
    if (type === "Sort") hasSort = true;
  }

  const estimatedComplexity = getComplexity(totalCost, totalTime, hasSeqScan);

  return {
    totalCost,
    totalRows: nodes[0]?.planRows ?? 0,
    totalTime,
    nodeCount: nodes.length,
    scanTypes,
    joinTypes,
    hasSeqScan,
    hasSort,
    estimatedComplexity,
  };
}

function getComplexity(
  cost: number,
  time: number,
  hasSeqScan: boolean
): "low" | "medium" | "high" | "critical" {
  const score = cost + time;
  if (score > 50000 || (hasSeqScan && score > 10000)) return "critical";
  if (score > 10000) return "high";
  if (score > 1000) return "medium";
  return "low";
}

export function isSupportedNodeType(nodeType: string): boolean {
  return SUPPORTED_NODE_TYPES.includes(nodeType);
}

export function getSupportedNodeTypes(): string[] {
  return [...SUPPORTED_NODE_TYPES];
}
