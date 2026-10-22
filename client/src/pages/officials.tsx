import { useQuery } from "@tanstack/react-query";
import { Official } from "@shared/schema";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useRatingsAccess } from "@/hooks/use-ratings-access";
import OfficialCard from "@/components/official-card";
import { Loading } from "@/components/ui/loading";

export default function Officials() {
  const { data: officialsResponse, isLoading } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
    queryFn: async () => {
      const response = await fetch("/api/officials");
      if (!response.ok) {
        throw new Error("Failed to fetch officials");
      }
      return response.json();
    }
  });
  const officialsData = officialsResponse?.data;
  const officials = officialsData ? [...officialsData].sort((a, b) => a.lastName.localeCompare(b.lastName)) : [];

  // Fetch officials page background settings
  const { data: settings } = useQuery<Array<{ key: string; value: string }>>({
    queryKey: ["/api/settings"],
    retry: false,
  });

  const { canViewRatings } = useRatingsAccess();

  // Use the officials silhouette image as the background
  const backgroundImage = "/uploads/OfficialsSilhouette.png";

  const backgroundStyle = {
    backgroundImage: `url(${backgroundImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundAttachment: 'fixed'
  };

  return (
    <div 
      className="min-h-screen"
      style={backgroundStyle}
    >
      <div className="container mx-auto px-4 py-8 space-y-8">
        <div className="text-center space-y-6">
          <div className="p-3 sm:p-4 rounded-md inline-block mx-auto">
            <h1 className="text-xl sm:text-2xl athletic-text tracking-tight text-white drop-shadow-lg">
              Featured Officials
            </h1>
          </div>
          <div className="p-3 sm:p-4 rounded-md mx-auto max-w-full sm:max-w-2xl">
            <blockquote className="text-sm sm:text-base italic text-center text-white drop-shadow-lg">
              "The natural response to evaluation is to feel judged. We have to mature to a place where we respond to it with gratitude, and love feedback."
            </blockquote>
            <p className="text-xs sm:text-sm text-center mt-2 text-gray-200 drop-shadow-lg font-medium">
              -Henry Cloud
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mt-8 relative z-10">
          {isLoading ? (
            <div className="col-span-full flex flex-col items-center justify-center py-16 space-y-4">
              <Loading text="Loading officials..." />
            </div>
          ) : !officials || officials.length === 0 ? (
            <div className="col-span-full text-center text-white bg-black/50 backdrop-blur-sm rounded-lg p-4">
              No officials found
            </div>
          ) : (
            officials.map((official) => (
              <OfficialCard key={official.id} official={official} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}