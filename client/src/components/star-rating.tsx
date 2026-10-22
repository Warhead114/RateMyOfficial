
import { useState } from "react";
import { Star } from "lucide-react";

interface StarRatingProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  disabled?: boolean;
}

export default function StarRating({ value, onChange, label, disabled = false }: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const handleStarClick = (starValue: number) => {
    if (!disabled) {
      onChange(starValue);
    }
  };

  const handleStarHover = (starValue: number) => {
    if (!disabled) {
      setHoverValue(starValue);
    }
  };

  const handleMouseLeave = () => {
    setHoverValue(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-sm font-medium">{label}</span>}
      <div className="flex gap-1" onMouseLeave={handleMouseLeave}>
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= (hoverValue ?? value);
          return (
            <button
              key={star}
              type="button"
              onClick={() => handleStarClick(star)}
              onMouseEnter={() => handleStarHover(star)}
              disabled={disabled}
              className={`p-1 transition-all duration-200 ${
                disabled 
                  ? 'cursor-not-allowed opacity-50' 
                  : 'hover:scale-110 cursor-pointer'
              }`}
              aria-label={`Rate ${star} star${star !== 1 ? 's' : ''}`}
            >
              <Star 
                className={`h-5 w-5 sm:h-6 sm:w-6 transition-colors ${
                  isFilled 
                    ? 'fill-yellow-500 text-yellow-500' 
                    : 'text-gray-300 hover:text-yellow-500'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
