import { NextResponse } from "next/server";
import { analyzeSchema } from "@/lib/validators";
import { parseExplain } from "@/lib/parser";
import { suggestIndexes } from "@/lib/index-suggester";
import { prisma } from "@/lib/db";
import { sanitizeInput } from "@/lib/utils";
import { RateLimiterMemory } from "rate-limiter-flexible";

const rateLimiter = new RateLimiterMemory({
  points: parseInt(process.env.RATE_LIMIT_MAX || "20"),
  duration: Math.floor(parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000") / 1000),
});

export async function POST(req: Request) {
  try {
    // Rate limiting
    const clientIp = req.headers.get("x-forwarded-for") || "unknown";
    try {
      await rateLimiter.consume(clientIp);
    } catch {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded. Please try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();

    // Validate input
    const validated = analyzeSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { sql, explainOutput, title, databaseType, save } = validated.data;

    // Sanitize inputs
    const cleanTitle = sanitizeInput(title);
    const cleanSql = sanitizeInput(sql);

    // Parse the EXPLAIN output
    const parsedPlan = parseExplain(explainOutput, databaseType);

    // Generate index suggestions
    const indexSuggestions = suggestIndexes(cleanSql, databaseType);

    // Save to database if requested
    let analysisId: string | null = null;
    if (save) {
      const analysis = await prisma.analysis.create({
        data: {
          title: cleanTitle,
          sql: cleanSql,
          explainOutput,
          parsedPlan: JSON.stringify(parsedPlan),
          databaseType,
          indexSuggestions: {
            create: indexSuggestions.map((s) => ({
              tableName: s.tableName,
              columnName: s.columnName,
              indexType: s.indexType,
              estimatedImpact: s.estimatedImpact,
              reasoning: s.reasoning,
            })),
          },
        },
      });
      analysisId = analysis.id;
    }

    return NextResponse.json({
      success: true,
      data: {
        id: analysisId,
        parsedPlan,
        indexSuggestions,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
