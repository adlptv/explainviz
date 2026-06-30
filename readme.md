# ExplainViz — Database Query Plan Visualizer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)

Turns PostgreSQL, MySQL, and SQLite EXPLAIN output into interactive flame-graphs. Compares query plans side by side and suggests indexes with estimated performance impact.

## Screenshots

| Landing Page | Analysis View (Index Suggestions) |
|:---:|:---:|
| ![Analysis view: index suggestion panel with estimated performance improvement](screenshots/dashboard.png) |

## Features

- Parses EXPLAIN output in JSON and text formats across PostgreSQL, MySQL, and SQLite
- Flame-graph and collapsible tree views of query plan nodes with cost, timing, and row counts
- Visual diff: compare two plans side by side with highlighted differences
- Index suggestion engine that reads WHERE, JOIN, and ORDER BY patterns
- Monaco Editor for SQL input
- Embed mode for iframes in wikis and dashboards
- Saves past analyses locally in SQLite

## Quick Start

```bash
git clone https://github.com/adlptv/explainviz.git
cd explainviz
pnpm install
pnpm dev
```

Or:
```bash
docker-compose up
```

## Architecture

```
apps/explainviz/
├── src/app/          # Pages: landing, analyze, diff, history, embed, settings
│   └── api/          # analyze, diff, suggest-indexes, history, embed, health
├── src/components/   # FlameGraph, PlanTree, PlanDiff, NodeDetail, SqlEditor, UI primitives
├── src/lib/parser/   # PostgreSQL, MySQL, SQLite plan parsers
├── src/lib/          # index-suggester, diff-engine, validators (Zod)
├── prisma/           # SQLite: Analysis, IndexSuggestion
└── tests/            # Vitest + Playwright
```

## Supported Plan Node Types (PostgreSQL)

Seq Scan, Index Scan, Index Only Scan, Bitmap Index Scan, Bitmap Heap Scan, Nested Loop, Hash Join, Merge Join, Hash, Sort, Aggregate, GroupAggregate, Limit, Append, Subquery Scan, CTE Scan, Materialize, Gather, WindowAgg, Unique, SetOp, Recursive Union, Result

## API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/analyze | Parse EXPLAIN, return structured plan and visualization data |
| POST | /api/diff | Compare two query plans |
| POST | /api/suggest-indexes | Generate index recommendations from SQL |
| GET | /api/history | List saved analyses |
| GET/DELETE | /api/history/[id] | Get or delete an analysis |
| GET | /api/embed/[id] | Embeddable view data |
| GET | /api/health | Health check |

## Security

- Zod validation on all routes
- Rate limiting
- Helmet.js headers
- No raw SQL execution from user input

## License

MIT