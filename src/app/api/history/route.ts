import { NextResponse } from "next/server";
import { historyQuerySchema } from "@/lib/validators";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const params = Object.fromEntries(searchParams.entries());
    const validated = historyQuerySchema.safeParse(params);

    if (!validated.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query parameters", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { page, limit, search } = validated.data;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { title: { contains: search } },
            { sql: { contains: search } },
          ],
        }
      : {};

    const [analyses, total] = await Promise.all([
      prisma.analysis.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          indexSuggestions: true,
        },
      }),
      prisma.analysis.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: analyses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
