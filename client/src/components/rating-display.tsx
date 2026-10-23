
import { Star } from "lucide-react";

interface RatingDisplayProps {
  rating: number;
  total?: number;
  showTotal?: boolean;
  size?: "sm" | "md" | "lg";
}

export default function RatingDisplay({ rating, total, showTotal = true, size = "md" }: RatingDisplayProps) {
  // Round to nearest 0.1
  const roundedRating = Math.round(rating * 10) / 10;

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

  // Calculate fill percentage for each star (0-100%)
  const getStarFillPercentage = (starIndex: number): number => {
    const starValue = starIndex + 1;
    if (roundedRating >= starValue) {
      return 100; // Fully filled
    } else if (roundedRating > starIndex) {
      // Partially filled - calculate percentage
      const fillAmount = (roundedRating - starIndex) * 100;
      return Math.min(100, Math.max(0, fillAmount));
    }
    return 0; // Empty
  };

  return (
    <div className="flex items-center gap-1 sm:gap-2 bg-image-contrast">
      <div className="flex">
        {[0, 1, 2, 3, 4].map((i) => {
          const fillPercentage = getStarFillPercentage(i);
          const uniqueId = `star-gradient-${size}-${i}-${rating}-${Math.random()}`;

          return (
            <div key={i} className="relative inline-block">
              <svg
                className={starSize}
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient id={uniqueId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#eab308" stopOpacity={fillPercentage > 0 ? "1" : "0"} />
                    <stop offset={`${fillPercentage}%`} stopColor="#eab308" stopOpacity="1" />
                    <stop offset={`${fillPercentage}%`} stopColor="#d1d5db" stopOpacity="1" />
                    <stop offset="100%" stopColor="#d1d5db" stopOpacity="1" />
                  </linearGradient>
                </defs>
                <path
                  d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                  fill={`url(#${uniqueId})`}
                  stroke={fillPercentage > 0 ? "#eab308" : "#d1d5db"}
                  strokeWidth="0.5"
                />
              </svg>
            </div>
          );
        })}
      </div>
      <span className={`font-medium ${textSize}`}>{roundedRating.toFixed(1)}</span>
      {showTotal && total !== undefined && (
        <span className={`text-muted-foreground ${textSize}`}>({total} reviews)</span>
      )}
    </div>
  );
}
