export interface PermissionActor {
  role: string;
  userType: string;
  region: string | null;
  isVerified?: boolean;
}

export interface RegionalResource {
  region: string | null | undefined;
}

export function normalizeRegion(region: string | null | undefined): string | null {
  const normalized = region?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function isAdministrator(actor: PermissionActor | undefined): boolean {
  return actor?.role === "admin";
}

export function isRegionalSupervisor(actor: PermissionActor | undefined): boolean {
  return actor?.userType === "Regional Supervisor" && actor.isVerified === true;
}

export function canManageRegion(
  actor: PermissionActor | undefined,
  targetRegion: string | null | undefined,
): boolean {
  if (isAdministrator(actor)) {
    return true;
  }

  if (!isRegionalSupervisor(actor)) {
    return false;
  }

  const actorRegion = normalizeRegion(actor?.region);
  const resourceRegion = normalizeRegion(targetRegion);
  return actorRegion !== null && resourceRegion !== null && actorRegion === resourceRegion;
}

export function filterToAuthorizedRegion<T extends RegionalResource>(
  actor: PermissionActor | undefined,
  resources: T[],
): T[] {
  return isAdministrator(actor)
    ? resources
    : resources.filter((resource) => canManageRegion(actor, resource.region));
}