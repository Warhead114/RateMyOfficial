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

  return (
    <Link href={`/officials/${official.id}`}>
      <Card className="hover:bg-accent/5 transition-colors cursor-pointer bg-image-content h-full">
        <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 sm:gap-4">
            <Avatar className="h-14 w-14 sm:h-16 sm:w-16">
              <AvatarImage src={official.photoUrl || undefined} alt={fullName} />
              <AvatarFallback>{official.firstName[0]}</AvatarFallback>
            </Avatar>
            <div className="space-y-1 sm:space-y-2 text-center sm:text-left">
              <h3 className="athletic-text text-base bg-image-contrast">{fullName}</h3>
              <div className="flex items-center justify-center sm:justify-start text-xs sm:text-sm bg-image-contrast-muted gap-1">
                <MapPin className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>{official.location}</span>
              </div>
              
              <div className="flex justify-center sm:justify-start">
                <RatingDisplay 
                  rating={rating}
                  total={reviews}
                  size="sm"
                />
              </div>
              
              {!canViewRatings && (
                <div className="text-xs bg-image-contrast-muted">
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