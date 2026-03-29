import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const db = prisma as unknown as {
  watchlistItem: {
    findMany: (args?: unknown) => Promise<Array<{
      id: number;
      ticker: string;
      sector: string;
      addedAt: Date;
      notes: string | null;
      source: string;
    }>>;
    create: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<{ id: number } | null>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const items = await db.watchlistItem.findMany({
    orderBy: { addedAt: "desc" },
  });

  return NextResponse.json({ watchlist: items });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  const body = await req.json();
  const { ticker, sector, notes, source } = body as {
    ticker?: string;
    sector?: string;
    notes?: string;
    source?: string;
  };

  if (!ticker || !sector) {
    return NextResponse.json(
      { error: "ticker and sector are required" },
      { status: 400 },
    );
  }

  const sanitizedTicker = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/.test(sanitizedTicker)) {
    return NextResponse.json({ error: "Invalid ticker format" }, { status: 400 });
  }

  const existing = await db.watchlistItem.findFirst({
    where: { ticker: sanitizedTicker },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ticker already on watchlist" },
      { status: 409 },
    );
  }

  const item = await db.watchlistItem.create({
    data: {
      ticker: sanitizedTicker,
      sector: sector.trim(),
      notes: notes?.trim() || null,
      source: source ?? "manual",
    },
  });

  return NextResponse.json({ item }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  const tickerParam = url.searchParams.get("ticker");

  if (idParam) {
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await db.watchlistItem.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  }

  if (tickerParam) {
    const item = await db.watchlistItem.findFirst({
      where: { ticker: tickerParam.trim().toUpperCase() },
    });
    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await db.watchlistItem.delete({ where: { id: item.id } });
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json(
    { error: "Provide id or ticker query param" },
    { status: 400 },
  );
}
