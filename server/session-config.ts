export function requireSessionSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }
  return secret;
}

export function sessionCookieOptions(isProduction: boolean) {
  return {
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: "lax" as const,
    httpOnly: true,
  };
}

export function debugRoutesEnabled(isProduction: boolean): boolean {
  return !isProduction;
}