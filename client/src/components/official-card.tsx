import React from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import RatingDisplay from "./rating-display";
import { MapPin, Star } from "lucide-react";
import type { Official } from "@shared/schema";
import { useRatingsAccess } from "@/hooks/use-ratings-access";

interface OfficialCardProps {
  official: Official;
}

export default function OfficialCard({ official }: OfficialCardProps) {
  const { canViewRatings } = useRatingsAccess();
  const fullName = `${official.firstName} ${official.lastName}`;
  const rating = official.averageRating ?? 0;
  const reviews = official.totalReviews ?? 0;

  // Create slug from first and last name
  const slug = `${official.firstName}${official.lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Load versioned image URL
  const [photoUrl, setPhotoUrl] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const loadImageUrl = async () => {
      if (official.photoUrl) {
        const { getVersionedImageUrl } = await import('@/lib/utils');
        const versionedUrl = await getVersionedImageUrl(official.photoUrl);
        setPhotoUrl(versionedUrl);
      }
    };
    loadImageUrl();
  }, [official.photoUrl]);

  return (
    <Link href={`/officials/${slug}`}>
      <Card className="hover:bg-black/40 transition-colors cursor-pointer bg-black/30 backdrop-blur-sm border-white/20 shadow-xl h-full relative z-20">
        <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6">
          <div className="flex flex-col items-center gap-3 sm:gap-4 text-center">
            <Avatar className="h-16 w-16 sm:h-20 sm:w-20 border-2 border-white/30">
              <AvatarImage 
                src={photoUrl} 
                alt={fullName}
                loading="eager"
                crossOrigin="anonymous"
              />
              <AvatarFallback className="bg-white/20 text-white text-lg font-semibold">{official.firstName[0]}</AvatarFallback>
            </Avatar>
            <div className="space-y-2 w-full">
              <h3 className="athletic-text text-lg sm:text-xl text-white font-bold drop-shadow-lg">{fullName}</h3>

              <div className="space-y-1 text-sm sm:text-base text-white/90">
                <div className="flex items-center justify-center gap-2">
                  <span className="font-medium">Age:</span>
                  <span>{official.age}</span>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>{official.location}</span>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <span className="font-medium">Experience:</span>
                  <span>{official.yearsExperience} years</span>
                </div>
              </div>

              <div className="flex justify-center pt-2">
                <RatingDisplay 
                  rating={rating}
                  total={reviews}
                  size="sm"
                />
              </div>

              {!canViewRatings && (
                <div className="text-xs text-white/70 font-medium pt-1">
                  <span>Individual reviews restricted</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}