type LogContext = Record<string, unknown> | undefined;

const sensitiveKey = /(password|token|secret|session|cookie|authorization|email|filepath|path|body|user)/i;

export function sanitizeLogContext(context: LogContext): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : sanitizeValue(value),
    ]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return sanitizeLogContext(value as Record<string, unknown>);
  }
  return value;
}

function write(level: "debug" | "info" | "warn" | "error", message: string, context?: LogContext) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const safeContext = sanitizeLogContext(context);
  const output = safeContext ? { message, ...safeContext } : { message };
  console[level](output);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};