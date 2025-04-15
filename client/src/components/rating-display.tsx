import { Star, StarHalf } from "lucide-react";

interface RatingDisplayProps {
  rating: number;
  total?: number;
  showTotal?: boolean;
  size?: "sm" | "md" | "lg";
}

export default function RatingDisplay({ rating, total, showTotal = true, size = "md" }: RatingDisplayProps) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;

  const starSizes = {
    sm: "h-3 w-3 sm:h-4 sm:w-4",
    md: "h-4 w-4 sm:h-5 sm:w-5",
    lg: "h-5 w-5 sm:h-6 sm:w-6"
  };

  const textSizes = {
    sm: "text-xs sm:text-sm",
    md: "text-sm sm:text-base",
    lg: "text-base sm:text-lg"
  };

  const starSize = starSizes[size];
  const textSize = textSizes[size];

  return (
    <div className="flex items-center gap-1 sm:gap-2 bg-image-contrast">
      <div className="flex text-yellow-500">
        {[...Array(5)].map((_, i) => {
          if (i < fullStars) {
            return <Star key={i} className={`${starSize} fill-current`} />;
          } else if (i === fullStars && hasHalfStar) {
            return <StarHalf key={i} className={`${starSize} fill-current`} />;
          }
          return <Star key={i} className={`${starSize} text-gray-300`} />;
        })}
      </div>
      <span className={`font-medium ${textSize}`}>{rating.toFixed(1)}</span>
      {showTotal && total !== undefined && (
        <span className={`text-muted-foreground ${textSize}`}>({total} reviews)</span>
      )}
    </div>
  );
}