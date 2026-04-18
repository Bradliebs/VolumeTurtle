import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const p = new PrismaClient({ adapter }) as unknown as PrismaClient;

async function main() {
  const agg = await (p as unknown as {
    dailyQuote: { aggregate: (a: unknown) => Promise<{ _min: { date: Date | null }; _max: { date: Date | null }; _count: number }> };
  }).dailyQuote.aggregate({ _min: { date: true }, _max: { date: true }, _count: true });

  console.log("Quote rows total:", agg._count);
  console.log("Earliest date   :", agg._min.date);
  console.log("Latest date     :", agg._max.date);

  if (agg._min.date && agg._max.date) {
    const days = (agg._max.date.getTime() - agg._min.date.getTime()) / 86_400_000;
    console.log(`Calendar span   : ${days.toFixed(0)} days (${(days / 365.25).toFixed(2)} years)`);
  }

  // Per-ticker coverage sample
  const sample = await (p as unknown as {
    $queryRawUnsafe: (q: string) => Promise<Array<{ symbol: string; first: Date; last: Date; n: bigint }>>;
  }).$queryRawUnsafe(`
    SELECT t.symbol, MIN(q.date) AS first, MAX(q.date) AS last, COUNT(*)::bigint AS n
    FROM "DailyQuote" q JOIN "Ticker" t ON t.id = q."tickerId"
    GROUP BY t.symbol
    ORDER BY n DESC
    LIMIT 5
  `);
  console.log("\nTop 5 tickers by quote count:");
  for (const r of sample) {
    console.log(`  ${r.symbol.padEnd(10)} ${r.first.toISOString().slice(0,10)} → ${r.last.toISOString().slice(0,10)}  (${r.n} rows)`);
  }

  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
