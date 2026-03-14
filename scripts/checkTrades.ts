import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

async function main() {
  const del = await prisma.trade.deleteMany({ where: { ticker: "HBR.L" } });
  console.log(`Deleted ${del.count} HBR.L trade(s)`);
}

main().catch(console.error);
