import { NextResponse } from "next/server";
import { suggestIndexesSchema } from "@/lib/validators";
import { suggestIndexes } from "@/lib/index-suggester";
import { sanitizeInput } from "@/lib/utils";
import { RateLimiterMemory } from "rate-limiter-flexible";

const rateLimiter = new RateLimiterMemory({
  points: parseInt(process.env.RATE_LIMIT_MAX || "20"),
  duration: Math.floor(parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000") / 1000),
});

export async function POST(req: Request) {
  try {
    const clientIp = req.headers.get("x-forwarded-for") || "unknown";
    try {
      await rateLimiter.consume(clientIp);
    } catch {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const validated = suggestIndexesSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { sql, databaseType } = validated.data;
    const cleanSql = sanitizeInput(sql);
    const suggestions = suggestIndexes(cleanSql, databaseType);

    return NextResponse.json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
