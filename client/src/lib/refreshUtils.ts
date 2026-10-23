
import { queryClient } from "@/lib/queryClient";

/**
 * Standardized refresh patterns for consistent cache invalidation
 */
export const refreshUtils = {
  /**
   * Standard refresh pattern: invalidate + refetch
   * Use for most common scenarios
   */
  standard: async (queryKeys: string[]) => {
    console.log('RefreshUtils: Standard refresh for:', queryKeys);
    
    for (const key of queryKeys) {
      await queryClient.invalidateQueries({ queryKey: [key] });
      await queryClient.refetchQueries({ queryKey: [key], type: 'active' });
    }
  },

  /**
   * Aggressive refresh pattern: remove + invalidate + refetch
   * Use for critical updates that must be immediately visible
   */
  aggressive: async (queryKeys: string[]) => {
    console.log('RefreshUtils: Aggressive refresh for:', queryKeys);
    
    for (const key of queryKeys) {
      queryClient.removeQueries({ queryKey: [key] });
      await queryClient.invalidateQueries({ queryKey: [key] });
      await queryClient.refetchQueries({ queryKey: [key], type: 'active' });
    }
  },

  /**
   * Multi-layer refresh pattern: invalidate related caches
   * Use when one change affects multiple related data sources
   */
  multiLayer: async (baseKey: string, relatedKeys: string[] = []) => {
    console.log('RefreshUtils: Multi-layer refresh for base:', baseKey, 'related:', relatedKeys);
    
    // Primary cache
    await queryClient.invalidateQueries({ queryKey: [baseKey] });
    await queryClient.refetchQueries({ queryKey: [baseKey], type: 'active' });
    
    // Related caches
    for (const relatedKey of relatedKeys) {
      await queryClient.invalidateQueries({ queryKey: [relatedKey] });
      await queryClient.refetchQueries({ queryKey: [relatedKey], type: 'active' });
    }
  },

  /**
   * Pattern-based refresh: invalidate all queries matching a pattern
   * Use when you need to refresh all related queries with a common pattern
   */
  pattern: async (pattern: string) => {
    console.log('RefreshUtils: Pattern-based refresh for pattern:', pattern);
    
    queryClient.removeQueries({
      predicate: (query) => {
        const queryKey = Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey;
        return String(queryKey).includes(pattern);
      },
    });

    await queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey;
        return String(queryKey).includes(pattern);
      },
    });

    await queryClient.refetchQueries({
      predicate: (query) => {
        const queryKey = Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey;
        return String(queryKey).includes(pattern);
      },
      type: 'active'
    });
  },

  // Specific domain refresh patterns for common use cases
  teams: {
    afterAdd: () => refreshUtils.aggressive(["/api/teams"]),
    afterEdit: (teamId: string) => refreshUtils.multiLayer("/api/teams", [`/api/teams/${teamId}`]),
    afterDelete: () => refreshUtils.aggressive(["/api/teams"])
  },

  events: {
    afterAdd: () => refreshUtils.aggressive(["/api/events"]),
    afterEdit: (eventId: string) => refreshUtils.multiLayer("/api/events", [
      `/api/events/${eventId}`,
      `/api/events/${eventId}/officials`,
      `/api/events/${eventId}/teams`
    ]),
    afterDelete: () => refreshUtils.pattern("/api/events")
  },

  coaches: {
    afterAdd: () => refreshUtils.aggressive(["/api/admin/coaches"]),
    afterEdit: (coachId: string) => refreshUtils.multiLayer("/api/admin/coaches", [
      `/api/admin/coaches/${coachId}`
    ]),
    afterDelete: () => refreshUtils.aggressive(["/api/admin/coaches"])
  },

  officials: {
    afterAdd: () => refreshUtils.aggressive(["/api/officials"]),
    afterEdit: (officialId: string) => refreshUtils.multiLayer("/api/officials", [
      `/api/officials/${officialId}`
    ]),
    afterDelete: () => refreshUtils.aggressive(["/api/officials"]),
    afterReviewChange: (officialId: string) => refreshUtils.multiLayer(`/api/officials/${officialId}/reviews`, [
      `/api/officials/${officialId}`,
      "/api/officials" // Updates rating calculations in list
    ])
  },

  profiles: {
    afterUpdate: (userType: 'coach' | 'supervisor' | 'official', userId: string) => {
      const baseKey = userType === 'coach' ? '/api/admin/coaches' : 
                     userType === 'supervisor' ? '/api/admin/supervisors' : 
                     '/api/officials';
      
      return refreshUtils.multiLayer(baseKey, [
        `${baseKey}/${userId}`,
        '/api/auth/me' // Update navigation user data
      ]);
    }
  },

  auth: {
    afterLogin: () => refreshUtils.standard(["/api/auth/me"]),
    afterLogout: () => queryClient.clear(), // Clear all cached data
    afterProfileUpdate: () => refreshUtils.standard(["/api/auth/me"])
  }
};
