import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id: params.id },
      include: { indexSuggestions: true },
    });

    if (!analysis) {
      return NextResponse.json(
        { success: false, error: "Analysis not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.analysis.delete({
      where: { id: params.id },
    });

    return NextResponse.json({
      success: true,
      message: "Analysis deleted successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
