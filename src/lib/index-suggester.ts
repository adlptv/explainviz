import type { IndexSuggestion } from "@/types";

/**
 * Index Suggestion Engine
 * Analyzes SQL queries and suggests indexes with estimated impact.
 */

interface ParsedQuery {
  tables: Set<string>;
  whereColumns: Map<string, Set<string>>;
  joinColumns: Map<string, Set<string>>;
  orderByColumns: string[];
  groupByColumns: string[];
  tableAliases: Map<string, string>;
}

/**
 * Parse SQL to extract table names, WHERE/JOIN/ORDER BY/GROUP BY columns.
 */
function parseSqlQuery(sql: string): ParsedQuery {
  const tables = new Set<string>();
  const whereColumns = new Map<string, Set<string>>();
  const joinColumns = new Map<string, Set<string>>();
  const orderByColumns: string[] = [];
  const groupByColumns: string[] = [];
  const tableAliases = new Map<string, string>();

  // Normalize SQL
  const normalized = sql.replace(/\s+/g, " ").replace(/;\s*$/, "").trim();

  // Extract tables and aliases from FROM/JOIN clauses
  const fromMatch = normalized.match(/\bFROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
  if (fromMatch) {
    tables.add(fromMatch[1]);
    if (fromMatch[2] && fromMatch[2].toUpperCase() !== "WHERE" && fromMatch[2].toUpperCase() !== "ON") {
      tableAliases.set(fromMatch[2].toLowerCase(), fromMatch[1]);
    }
  }

  const joinMatches = normalized.matchAll(/\b(?:INNER\s+|LEFT\s+|RIGHT\s+|FULL\s+|CROSS\s+)?JOIN\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?\s+ON\s+([\w.\s=<>!(),'"]+)/gi);
  for (const match of joinMatches) {
    const tableName = match[1];
    const alias = match[2];
    const onClause = match[3];

    tables.add(tableName);
    if (alias && alias.toUpperCase() !== "WHERE") {
      tableAliases.set(alias.toLowerCase(), tableName);
    }

    // Extract join columns from ON clause
    const columnMatches = onClause.matchAll(/(\w+)\.(\w+)/g);
    for (const cm of columnMatches) {
      const aliasOrTable = cm[1].toLowerCase();
      const columnName = cm[2];
      const actualTable = tableAliases.get(aliasOrTable) || cm[1];
      if (!joinColumns.has(actualTable)) {
        joinColumns.set(actualTable, new Set());
      }
      joinColumns.get(actualTable)!.add(columnName);
    }
  }

  // Extract WHERE clause columns
  const whereMatch = normalized.match(/\bWHERE\s+(.+?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|\bHAVING\b|$)/i);
  if (whereMatch) {
    const whereClause = whereMatch[1];
    const columnMatches = whereClause.matchAll(/(\w+)\.(\w+)/g);
    for (const cm of columnMatches) {
      const aliasOrTable = cm[1].toLowerCase();
      const columnName = cm[2];
      const actualTable = tableAliases.get(aliasOrTable) || cm[1];
      if (!whereColumns.has(actualTable)) {
        whereColumns.set(actualTable, new Set());
      }
      whereColumns.get(actualTable)!.add(columnName);
    }

    // Also match bare column names (no table prefix)
    const bareColumns = whereClause.match(/\b(\w+)\s*(?:=|!=|<>|>|<|>=|<=|LIKE|IN|BETWEEN|IS)/gi);
    if (bareColumns) {
      for (const bc of bareColumns) {
        const colName = bc.match(/(\w+)/)?.[1];
        if (colName && !["AND", "OR", "NOT", "NULL", "TRUE", "FALSE"].includes(colName.toUpperCase())) {
          // Assign to the first table if no prefix
          for (const table of tables) {
            if (!whereColumns.has(table)) {
              whereColumns.set(table, new Set());
            }
            whereColumns.get(table)!.add(colName);
          }
        }
      }
    }
  }

  // Extract ORDER BY columns
  const orderMatch = normalized.match(/\bORDER\s+BY\s+(.+?)(?:\bLIMIT\b|\bOFFSET\b|$)/i);
  if (orderMatch) {
    const orderClause = orderMatch[1];
    const cols = orderClause.split(",").map((c) => c.trim().replace(/\s+(ASC|DESC)$/i, "").trim());
    for (const col of cols) {
      const colMatch = col.match(/(\w+)\.(\w+)/);
      if (colMatch) {
        orderByColumns.push(`${colMatch[1]}.${colMatch[2]}`);
      } else {
        orderByColumns.push(col);
      }
    }
  }

  // Extract GROUP BY columns
  const groupMatch = normalized.match(/\bGROUP\s+BY\s+(.+?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i);
  if (groupMatch) {
    const groupClause = groupMatch[1];
    const cols = groupClause.split(",").map((c) => c.trim());
    for (const col of cols) {
      groupByColumns.push(col);
    }
  }

  return { tables, whereColumns, joinColumns, orderByColumns, groupByColumns, tableAliases };
}

/**
 * Suggest indexes for a SQL query.
 */
export function suggestIndexes(sql: string, _databaseType: string = "postgresql"): IndexSuggestion[] {
  const parsed = parseSqlQuery(sql);
  const suggestions: IndexSuggestion[] = [];

  // Suggest indexes for WHERE clause columns
  for (const [tableName, columns] of parsed.whereColumns) {
    for (const column of columns) {
      // Skip if this is likely a primary key column
      if (column.toLowerCase() === "id") continue;

      const existing = suggestions.find((s) => s.tableName === tableName && s.columnName === column);
      if (existing) continue;

      suggestions.push({
        tableName,
        columnName: column,
        indexType: "btree",
        estimatedImpact: "high",
        reasoning: `Column "${column}" is used in a WHERE clause filter. Adding a B-tree index on ${tableName}(${column}) can significantly reduce scan time by avoiding full table scans.`,
        suggestedSql: `CREATE INDEX idx_${tableName}_${column} ON ${tableName} (${column});`,
      });
    }
  }

  // Suggest indexes for JOIN columns
  for (const [tableName, columns] of parsed.joinColumns) {
    for (const column of columns) {
      const existing = suggestions.find((s) => s.tableName === tableName && s.columnName === column);
      if (existing) {
        existing.reasoning += ` Also used in JOIN conditions, making this index even more critical.`;
        continue;
      }

      suggestions.push({
        tableName,
        columnName: column,
        indexType: "btree",
        estimatedImpact: "high",
        reasoning: `Column "${column}" is used in a JOIN condition. Indexing ${tableName}(${column}) will speed up join operations by enabling index lookups instead of full table scans.`,
        suggestedSql: `CREATE INDEX idx_${tableName}_${column} ON ${tableName} (${column});`,
      });
    }
  }

  // Suggest composite index for ORDER BY
  if (parsed.orderByColumns.length > 0) {
    // Group ORDER BY columns by table
    const orderByByTable = new Map<string, string[]>();
    for (const col of parsed.orderByColumns) {
      const parts = col.split(".");
      let table = "unknown";
      let column = col;
      if (parts.length === 2) {
        const aliasOrTable = parts[0].toLowerCase();
        table = parsed.tableAliases.get(aliasOrTable) || parts[0];
        column = parts[1];
      }

      if (!orderByByTable.has(table)) {
        orderByByTable.set(table, []);
      }
      orderByByTable.get(table)!.push(column);
    }

    for (const [tableName, columns] of orderByByTable) {
      if (columns.length < 2) {
        // Single column ORDER BY — suggest index only if not already suggested
        const col = columns[0];
        const existing = suggestions.find((s) => s.tableName === tableName && s.columnName === col);
        if (!existing) {
          suggestions.push({
            tableName,
            columnName: col,
            indexType: "btree",
            estimatedImpact: "medium",
            reasoning: `Column "${col}" is used in ORDER BY. An index on ${tableName}(${col}) can help avoid a Sort node in the query plan.`,
            suggestedSql: `CREATE INDEX idx_${tableName}_${col} ON ${tableName} (${col});`,
          });
        }
      } else {
        // Composite index for multi-column ORDER BY
        const colNames = columns.join(", ");
        suggestions.push({
          tableName,
          columnName: colNames,
          indexType: "btree",
          estimatedImpact: "high",
          reasoning: `Columns [${colNames}] are used together in ORDER BY. A composite index on ${tableName}(${colNames}) can eliminate the Sort node entirely.`,
          suggestedSql: `CREATE INDEX idx_${tableName}_${columns.join("_")} ON ${tableName} (${colNames});`,
        });
      }
    }
  }

  // Suggest indexes for GROUP BY
  for (const col of parsed.groupByColumns) {
    const parts = col.split(".");
    let tableName = "unknown";
    let columnName = col;
    if (parts.length === 2) {
      const aliasOrTable = parts[0].toLowerCase();
      tableName = parsed.tableAliases.get(aliasOrTable) || parts[0];
      columnName = parts[1];
    }

    const existing = suggestions.find((s) => s.tableName === tableName && s.columnName === columnName);
    if (!existing) {
      suggestions.push({
        tableName,
        columnName,
        indexType: "btree",
        estimatedImpact: "medium",
        reasoning: `Column "${columnName}" is used in GROUP BY. An index on ${tableName}(${columnName}) can speed up grouping operations.`,
        suggestedSql: `CREATE INDEX idx_${tableName}_${columnName} ON ${tableName} (${columnName});`,
      });
    }
  }

  // Sort by impact
  const impactOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => impactOrder[a.estimatedImpact] - impactOrder[b.estimatedImpact]);

  return suggestions;
}
