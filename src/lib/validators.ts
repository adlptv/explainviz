import { z } from "zod";

export const analyzeSchema = z.object({
  sql: z.string().min(1, "SQL query is required").max(50000, "SQL query too long"),
  explainOutput: z.string().min(1, "EXPLAIN output is required").max(500000, "EXPLAIN output too long"),
  title: z.string().min(1).max(200).optional().default("Untitled Analysis"),
  databaseType: z.enum(["postgresql", "mysql", "sqlite"]).default("postgresql"),
  save: z.boolean().default(true),
});

export const diffSchema = z.object({
  planA: z.object({
    sql: z.string(),
    explainOutput: z.string().min(1, "Plan A EXPLAIN output is required"),
  }),
  planB: z.object({
    sql: z.string(),
    explainOutput: z.string().min(1, "Plan B EXPLAIN output is required"),
  }),
  databaseType: z.enum(["postgresql", "mysql", "sqlite"]).default("postgresql"),
});

export const suggestIndexesSchema = z.object({
  sql: z.string().min(1, "SQL query is required").max(50000),
  databaseType: z.enum(["postgresql", "mysql", "sqlite"]).default("postgresql"),
});

export const historyQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
});

export const settingsSchema = z.object({
  pgHost: z.string().max(255).optional().or(z.literal("")),
  pgPort: z.coerce.number().min(1).max(65535).optional().or(z.literal("")),
  pgDatabase: z.string().max(255).optional().or(z.literal("")),
  pgUser: z.string().max(255).optional().or(z.literal("")),
  pgPassword: z.string().max(500).optional().or(z.literal("")),
  theme: z.enum(["light", "dark", "system"]).default("system"),
});

export type AnalyzeInput = z.infer<typeof analyzeSchema>;
export type DiffInput = z.infer<typeof diffSchema>;
export type SuggestIndexesInput = z.infer<typeof suggestIndexesSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
