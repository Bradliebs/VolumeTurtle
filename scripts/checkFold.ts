import "dotenv/config";
import { prisma } from "@/db/client";

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        ticker: string;
        status: string;
        exitDate: Date | null;
        exitPrice: number | null;
        exitReason: string | null;
      }>
    >;
  };
};

(async () => {
  const rows = await db.trade.findMany({
    where: { ticker: "FOLD" },
    select: { id: true, ticker: true, status: true, exitDate: true, exitPrice: true, exitReason: true },
  } as unknown);
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
})();
