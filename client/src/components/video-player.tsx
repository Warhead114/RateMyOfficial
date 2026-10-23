
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Video } from 'lucide-react';

interface VideoPlayerProps {
  videoUrl: string;
  className?: string;
}

export default function VideoPlayer({ videoUrl, className }: VideoPlayerProps) {
  // Normalize video URL to handle Object Storage paths
  let normalizedUrl = videoUrl;
  if (videoUrl && (videoUrl.startsWith('reviews/') || videoUrl.startsWith('coaches/'))) {
    normalizedUrl = `/storage/${videoUrl}`;
  } else if (videoUrl && !videoUrl.startsWith('/') && !videoUrl.startsWith('http')) {
    normalizedUrl = `/${videoUrl}`;
  }

  return (
    <Card className={`bg-black/20 border-white/10 ${className}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Video className="h-4 w-4 text-white/70" />
          <span className="text-sm text-white/70">Video Review</span>
        </div>
        <video
          src={normalizedUrl}
          controls
          className="w-full max-h-64 rounded-lg bg-black"
          preload="metadata"
          playsInline
          crossOrigin="anonymous"
        />
      </CardContent>
    </Card>
  );
}
