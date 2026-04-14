import { prisma } from "@/db/client";
import { randomBytes } from "crypto";

const db = prisma as unknown as {
  session: {
    create: (args: { data: { id: string; expiresAt: Date } }) => Promise<{ id: string; expiresAt: Date }>;
    findFirst: (args: { where: { id: string; expiresAt: { gt: Date } } }) => Promise<{ id: string } | null>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
    deleteMany: (args: { where: { expiresAt: { lt: Date } } }) => Promise<{ count: number }>;
  };
};

/** Create a new session with a 30-day expiry. Returns the session ID. */
export async function createSession(): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000); // 30 days
  await db.session.create({ data: { id, expiresAt } });
  return id;
}

/** Check whether a session ID is valid and not expired. */
export async function isValidSession(id: string): Promise<boolean> {
  const session = await db.session.findFirst({
    where: { id, expiresAt: { gt: new Date() } },
  });
  return session !== null;
}

/** Delete a specific session (logout). */
export async function deleteSession(id: string): Promise<void> {
  try {
    await db.session.delete({ where: { id } });
  } catch {
    // Session may already be gone — safe to ignore
  }
}

/** Remove all expired sessions. Call periodically (e.g. during scan). */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
