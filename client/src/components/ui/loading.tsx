
import React from 'react';

interface LoadingProps {
  className?: string;
  text?: string;
}

export const Loading: React.FC<LoadingProps> = ({ className = "", text = "Loading..." }) => {
  return (
    <div className={`flex flex-col items-center justify-center space-y-4 ${className}`}>
      <div className="relative flex items-center justify-center">
        {/* White circle background */}
        <div className="w-16 h-16 bg-white rounded-full animate-pulse"></div>
        {/* Wrestlers silhouette image */}
        <img 
          src="/uploads/wrestlers-silhouette.png" 
          alt="Loading" 
          className="absolute w-12 h-12 object-contain animate-pulse"
        />
      </div>
      <p className="text-white text-lg font-medium drop-shadow-lg animate-pulse">{text}</p>
    </div>
  );
};
