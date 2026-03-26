import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: { service: "volume-turtle" },
});

/**
 * Create a child logger scoped to a module.
 */
export function createLogger(module: string) {
  return logger.child({ module });
}
