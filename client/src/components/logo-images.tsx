import React from 'react';

export const RefereeIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={`${className} bg-background border-r border-l border-t-0 border-b-0 border-background`}>
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 512 512" 
        width="100%" 
        height="100%" 
        fill="white"
        style={{ filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.5))' }}
      >
        <path d="M256 0c-17.7 0-32 14.3-32 32V96c0 17.7 14.3 32 32 32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32h-96V32c0-17.7-14.3-32-32-32zm0 128H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H256V128zM192 352H96c-17.7 0-32-14.3-32-32V288c0-17.7-14.3-32-32-32s-32 14.3-32 32v32c0 53 43 96 96 96h96c17.7 0 32-14.3 32-32s-14.3-32-32-32zm320-32v32c0 53-43 96-96 96H336c-17.7 0-32-14.3-32-32s14.3-32 32-32h80c17.7 0 32-14.3 32-32V288c0-17.7 14.3-32 32-32s32 14.3 32 32zM416 96c0-17.7-14.3-32-32-32H160c-17.7 0-32 14.3-32 32v64c0 17.7 14.3 32 32 32H384c17.7 0 32-14.3 32-32V96zM160 256H384c17.7 0 32-14.3 32-32s-14.3-32-32-32H160c-17.7 0-32 14.3-32 32s14.3 32 32 32z" />
      </svg>
    </div>
  );
};

export const WrestlersIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={`${className} relative`}>
      <div className="absolute inset-0 bg-white rounded-full"></div>
      <img 
        src="/uploads/wrestlers-silhouette.png" 
        alt="Wrestlers Silhouette" 
        className="relative z-10 w-full h-full object-contain p-1"
        style={{ filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.5))' }}
      />
    </div>
  );
};