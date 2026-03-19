import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const args = process.argv.slice(2);
const tickerArg = args.find((a) => a.startsWith("--ticker="))?.split("=")[1];

if (!tickerArg) {
  console.error("Usage: npx tsx scripts/checkTrades.ts --ticker=SYMBOL");
  console.error("Example: npx tsx scripts/checkTrades.ts --ticker=HBR.L");
  process.exit(1);
}

async function main() {
  const del = await prisma.trade.deleteMany({ where: { ticker: tickerArg } });
  if (del.count === 0) {
    console.log(`No trades found for ${tickerArg}`);
  } else {
    console.log(`Deleted ${del.count} ${tickerArg} trade(s)`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
