import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const updated = await prisma.stopHistory.update({
      where: { id },
      data: { actioned: true, actionedAt: new Date() },
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/stops/:id] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update" },
      { status: 500 },
    );
  }
}
