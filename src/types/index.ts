// Type definitions for ExplainViz

export type DatabaseType = "postgresql" | "mysql" | "sqlite";

export interface PlanNode {
  id: string;
  nodeType: string;
  relationName?: string;
  alias?: string;
  schema?: string;
  startupCost?: number;
  totalCost?: number;
  planRows?: number;
  planWidth?: number;
  actualStartupTime?: number;
  actualTotalTime?: number;
  actualRows?: number;
  actualLoops?: number;
  output?: string[];
  filter?: string;
  hashCond?: string;
  mergeCond?: string;
  joinType?: string;
  sortKey?: string[];
  sortMethod?: string;
  groupKey?: string[];
  strategy?: string;
  indexName?: string;
  indexCond?: string;
  hashBuckets?: number;
  hashBatches?: number;
  peakMemory?: number;
  sharedHitBlocks?: number;
  sharedReadBlocks?: number;
  sharedDirtiedBlocks?: number;
  sharedWrittenBlocks?: number;
  tempReadBlocks?: number;
  tempWrittenBlocks?: number;
  parent?: string | null;
  subplans?: PlanNode[];
  children?: PlanNode[];
  level: number;
  startTime?: number;
  endTime?: number;
  exclusiveTime?: number;
  inclusiveTime?: number;
  exclusiveCost?: number;
  percent?: number;
}

export interface ParsedPlan {
  root: PlanNode;
  nodes: PlanNode[];
  maxCost: number;
  maxRows: number;
  maxTime: number;
  totalTime: number;
  totalCost: number;
  nodeCount: number;
  summary: PlanSummary;
}

export interface PlanSummary {
  totalCost: number;
  totalRows: number;
  totalTime: number;
  nodeCount: number;
  scanTypes: Record<string, number>;
  joinTypes: Record<string, number>;
  hasSeqScan: boolean;
  hasSort: boolean;
  estimatedComplexity: "low" | "medium" | "high" | "critical";
}

export interface DiffResult {
  added: PlanNode[];
  removed: PlanNode[];
  modified: PlanNodeDiff[];
  unchanged: PlanNode[];
  summary: {
    planA: PlanSummary;
    planB: PlanSummary;
    costDelta: number;
    timeDelta: number;
    rowDelta: number;
    improvement: "better" | "worse" | "neutral";
  };
}

export interface PlanNodeDiff {
  nodeType: string;
  field: string;
  oldValue: string | number;
  newValue: string | number;
  severity: "info" | "warning" | "critical";
}

export interface IndexSuggestion {
  tableName: string;
  columnName: string;
  indexType: "btree" | "hash" | "gin" | "gist" | "brin";
  estimatedImpact: "high" | "medium" | "low";
  reasoning: string;
  suggestedSql: string;
}

export interface FlameGraphDatum {
  name: string;
  value: number;
  nodeType: string;
  children?: FlameGraphDatum[];
  node?: PlanNode;
}

export interface TreeNode {
  name: string;
  nodeType: string;
  cost: number;
  rows: number;
  time: number;
  children: TreeNode[];
  node?: PlanNode;
}

export interface AnalysisRecord {
  id: string;
  title: string;
  sql: string;
  explainOutput: string;
  parsedPlan: string;
  databaseType: string;
  createdAt: string;
  indexSuggestions?: IndexSuggestionRecord[];
}

export interface IndexSuggestionRecord {
  id: string;
  analysisId: string;
  tableName: string;
  columnName: string;
  indexType: string;
  estimatedImpact: string;
  reasoning: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
