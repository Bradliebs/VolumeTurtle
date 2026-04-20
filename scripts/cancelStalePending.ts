import "dotenv/config";
import { prisma } from "@/db/client";

const db = prisma as unknown as {
  pendingOrder: {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
};

(async () => {
  const result = await db.pendingOrder.updateMany({
    where: { id: { in: [66, 67] }, status: "pending" },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: "Manual cancel — past auto-cancel window",
    },
  });
  console.log(`Cancelled ${result.count} pending order(s).`);
  await prisma.$disconnect();
})();
