import { useQuery } from "@tanstack/react-query";

export function useRatingsAccess() {
  const { data: user } = useQuery<{
    id?: number;
    firstName?: string;
    lastName?: string;
    role?: string;
    userType?: string;
  }>({
    queryKey: ["/api/auth/me"]
  });
  
  // Only Admin and Regional Supervisor users can view ratings and reviews
  const canViewRatings = Boolean(
    user?.userType === "Regional Supervisor" || user?.role === "admin"
  );
  
  return {
    canViewRatings,
    userType: user?.userType,
    role: user?.role,
    isLoggedIn: Boolean(user?.id)
  };
}