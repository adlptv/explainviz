import type { ParsedPlan, DatabaseType } from "@/types";
import { parsePostgresExplain, getSupportedNodeTypes } from "./postgresql";
import { parseMysqlExplain } from "./mysql";
import { parseSqliteExplain } from "./sqlite";

export { parsePostgresExplain, parseMysqlExplain, parseSqliteExplain, getSupportedNodeTypes };

export function parseExplain(explainOutput: string, databaseType: DatabaseType = "postgresql"): ParsedPlan {
  switch (databaseType) {
    case "postgresql":
      return parsePostgresExplain(explainOutput);
    case "mysql":
      return parseMysqlExplain(explainOutput);
    case "sqlite":
      return parseSqliteExplain(explainOutput);
    default:
      return parsePostgresExplain(explainOutput);
  }
}

export function detectDatabaseType(explainOutput: string): DatabaseType {
  const trimmed = explainOutput.trim().toLowerCase();

  // PostgreSQL indicators
  if (trimmed.includes("seq scan") || trimmed.includes("nested loop") || trimmed.includes('"Node Type"')) {
    return "postgresql";
  }

  // MySQL indicators
  if (trimmed.includes("access_type") || trimmed.includes("using_where") || trimmed.includes("->")) {
    return "mysql";
  }

  // SQLite indicators
  if (trimmed.includes("query plan") || trimmed.includes("scan ") || trimmed.includes("search ")) {
    return "sqlite";
  }

  return "postgresql";
}
