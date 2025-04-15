import { useQuery } from "@tanstack/react-query";
import { Official } from "@shared/schema";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useRatingsAccess } from "@/hooks/use-ratings-access";
import OfficialCard from "@/components/official-card";

export default function Home() {
  const { data: officialsResponse, isLoading } = useQuery<{data: Official[], total: number}>({ 
    queryKey: ["/api/officials"]
  });
  const officials = officialsResponse?.data;
  
  const { canViewRatings } = useRatingsAccess();

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="bg-image-content p-3 sm:p-4 rounded-md inline-block mx-auto mb-2 max-w-full">
          <h1 className="responsive-heading athletic-text tracking-tight bg-image-contrast px-2">
            Find and Rate Wrestling Officials
          </h1>
          <p className="responsive-text bg-image-contrast-muted mt-2 px-2">
            Help the wrestling community by sharing your experiences
          </p>
        </div>
        {!canViewRatings && (
          <p className="bg-image-content p-2 sm:p-3 rounded-md mx-auto max-w-full sm:max-w-lg text-xs sm:text-sm bg-image-contrast">
            Note: While ratings are publicly visible, individual reviews are only accessible to Regional Supervisors and Administrators.
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="bg-image-content p-3 sm:p-4 rounded-md inline-block mb-2">
          <h2 className="text-lg sm:text-xl athletic-text tracking-tight bg-image-contrast">
            Featured Officials
          </h2>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {isLoading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-40 sm:h-48 bg-muted animate-pulse rounded-lg" />
            ))
          ) : officials?.length === 0 ? (
            <p className="text-center text-muted-foreground">No officials found</p>
          ) : (
            officials?.map((official) => (
              <OfficialCard key={official.id} official={official} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}