import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertReviewSchema, type InsertReview, type Official, type Event } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Star, Upload, Video } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loading } from "@/components/ui/loading";
import { Input } from "@/components/ui/input";
import StarRating from "@/components/star-rating";
import React, { useEffect, useState, useRef } from "react";
import { formatInEastern } from "@/lib/utils";

interface ReviewFormProps {
  officialId: number;
}

const MAX_VIDEO_DURATION_SECONDS = 30;

function cleanupVideoElement(video: HTMLVideoElement | null) {
  if (!video) return;

  video.pause();
  video.removeAttribute("src");
  video.load();
}

export default function ReviewForm({ officialId }: ReviewFormProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [isVideoValidating, setIsVideoValidating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoPreviewUrlRef = useRef<string | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const pendingMetadataRef = useRef<{
    video: HTMLVideoElement;
    cancel: () => void;
  } | null>(null);
  const videoSelectionIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const isVideoValidatingRef = useRef(false);

  // Fetch official data for dynamic header
  const { data: official } = useQuery<Official>({
    queryKey: [`/api/officials/${officialId}`],
  });

  // Fetch events this official is assigned to
  const { data: allEvents, isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: [`/api/officials/${officialId}/events`],
  });

  // Filter to only show past and current events (not future events)
  // Parse dates in Eastern timezone to avoid timezone offset issues
  const events = allEvents?.filter(event => {
    // Parse the date string as YYYY-MM-DD in Eastern timezone
    const eventDateValue = event.date as Date | string;
    const dateStr = typeof eventDateValue === 'string' ? eventDateValue.split('T')[0] : eventDateValue;
    const [year, month, day] = dateStr.toString().split('-').map(Number);
    
    // Create date object in Eastern timezone
    const eventDate = new Date(year, month - 1, day);
    const today = new Date();
    
    // Set both to midnight for comparison
    today.setHours(0, 0, 0, 0);
    eventDate.setHours(0, 0, 0, 0);
    
    return eventDate <= today;
  });

  const form = useForm<InsertReview>({
    resolver: zodResolver(insertReviewSchema),
    defaultValues: {
      officialId,
      mechanics: 1,
      professionalism: 1,
      positioning: 1,
      stalling: 1,
      consistency: 1,
      appearance: 1,
      comment: "",
      eventId: 0,
    },
  });

  const cleanupVideoPreview = (clearState = true) => {
    cleanupVideoElement(videoPreviewRef.current);

    if (videoPreviewUrlRef.current) {
      URL.revokeObjectURL(videoPreviewUrlRef.current);
      videoPreviewUrlRef.current = null;
    }

    if (clearState) {
      setVideoPreview(null);
    }
  };

  const cancelPendingMetadata = () => {
    pendingMetadataRef.current?.cancel();
    pendingMetadataRef.current = null;
  };

  const setVideoValidationPending = (isPending: boolean) => {
    isVideoValidatingRef.current = isPending;
    if (isMountedRef.current) {
      setIsVideoValidating(isPending);
    }
  };

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      videoSelectionIdRef.current += 1;
      setVideoValidationPending(false);
      cancelPendingMetadata();
      cleanupVideoPreview(false);
    };
  }, []);

  const handleVideoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;

    // A new selection replaces any existing or still-loading clip.
    videoSelectionIdRef.current += 1;
    const selectionId = videoSelectionIdRef.current;
    cancelPendingMetadata();
    setVideoValidationPending(false);
    cleanupVideoPreview();
    setVideoFile(null);
    form.setValue("video", undefined);

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/avi'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please upload MP4, WebM, QuickTime, or AVI video files only.",
        variant: "destructive",
      });
      input.value = '';
      return;
    }

    // Validate file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Video file must be under 50MB. Please ensure your video is no longer than 30 seconds.",
        variant: "destructive",
      });
      input.value = '';
      return;
    }

    const url = URL.createObjectURL(file);
    const metadataVideo = document.createElement("video");
    metadataVideo.preload = "metadata";
    let removeMetadataListeners = () => {};
    setVideoValidationPending(true);

    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const onLoadedMetadata = () => resolve(metadataVideo.duration);
        const onMetadataError = () => reject(new Error("Unable to read video duration."));

        metadataVideo.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
        metadataVideo.addEventListener("error", onMetadataError, { once: true });
        removeMetadataListeners = () => {
          metadataVideo.removeEventListener("loadedmetadata", onLoadedMetadata);
          metadataVideo.removeEventListener("error", onMetadataError);
        };
        pendingMetadataRef.current = {
          video: metadataVideo,
          cancel: () => reject(new Error("Video selection was replaced.")),
        };
        metadataVideo.src = url;
        metadataVideo.load();
      });

      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("Unable to read video duration.");
      }

      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        URL.revokeObjectURL(url);
        if (isMountedRef.current && videoSelectionIdRef.current === selectionId) {
          toast({
            title: "Video Too Long",
            description: "Video clips must be 30 seconds or shorter. Please choose a shorter clip.",
            variant: "destructive",
          });
          input.value = '';
        }
        return;
      }

      if (!isMountedRef.current || videoSelectionIdRef.current !== selectionId) {
        URL.revokeObjectURL(url);
        return;
      }

      videoPreviewUrlRef.current = url;
      setVideoFile(file);
      form.setValue("video", file);
      setVideoPreview(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      if (
        isMountedRef.current &&
        videoSelectionIdRef.current === selectionId &&
        (error as Error).message !== "Video selection was replaced."
      ) {
        toast({
          title: "Unable to Read Video",
          description: "Please choose a playable video clip that is 30 seconds or shorter.",
          variant: "destructive",
        });
        input.value = '';
      }
    } finally {
      removeMetadataListeners();
      cleanupVideoElement(metadataVideo);
      if (pendingMetadataRef.current?.video === metadataVideo) {
        pendingMetadataRef.current = null;
      }
      if (videoSelectionIdRef.current === selectionId) {
        setVideoValidationPending(false);
      }
    }
  };

  const removeVideo = () => {
    videoSelectionIdRef.current += 1;
    setVideoValidationPending(false);
    cancelPendingMetadata();
    cleanupVideoPreview();
    setVideoFile(null);
    form.setValue("video", undefined);
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
  };

  const mutation = useMutation({
    mutationFn: async (data: InsertReview) => {
      setIsUploading(true);
      try {
        const formData = new FormData();

        // Append all form fields
        Object.entries(data).forEach(([key, value]) => {
          if (key !== 'video' && value !== undefined && value !== null) {
            formData.append(key, value.toString());
          }
        });

        // Append video file if exists
        if (videoFile) {
          formData.append('video', videoFile);
        }

        const response = await fetch(`/api/officials/${officialId}/reviews`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to submit review');
        }

        return await response.json();
      } finally {
        setIsUploading(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/officials/${officialId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/officials/${officialId}/reviews`] });
      form.reset();

      // Reset video state
      removeVideo();

      // Show the success toast
      toast({
        title: "Thank you!",
        description: "Thank you for taking the time to review this official, your feedback is greatly appreciated!",
        duration: 5000, // Show for 5 seconds
      });

      // Redirect to home page after 1 second to ensure toast is visible
      setTimeout(() => {
        setLocation("/");
      }, 1000);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit review. Please try again.",
        variant: "destructive",
      });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue
  } = form;

  if (eventsLoading) {
    return <Loading text="Loading events..." />;
  }

  if (!allEvents || allEvents.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-center text-muted-foreground">
            This official is not assigned to any events yet. Reviews can only be submitted for officials assigned to events.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!events || events.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-center text-muted-foreground">
            This official has no past or current events available for review. Reviews can only be submitted for events that have already occurred or are happening today.
          </p>
          <p className="text-center text-muted-foreground mt-2 text-sm">
            This official is assigned to {allEvents?.length || 0} upcoming event(s).
          </p>
        </CardContent>
      </Card>
    );
  }

  if (mutation.isPending) {
    return <Loading text="Submitting review..." />;
  }


  const ratingCategories = [
    {
      key: "mechanics",
      label: "Mechanics",
      description: "Did the official utilize proper NFHS signals and apply the rules set forth by the NFHS appropriately and efficiently?"
    },
    {
      key: "professionalism",
      label: "Professionalism",
      description: "Did the official demonstrate appropriate conduct, communication, and sportsmanship throughout the match?"
    },
    {
      key: "positioning",
      label: "Positioning",
      description: "Was the official positioned correctly to make accurate calls and maintain optimal viewing angles?"
    },
    {
      key: "stalling",
      label: "Stalling",
      description: "Did the official effectively recognize and address stalling situations according to NFHS guidelines?"
    },
    {
      key: "consistency",
      label: "Consistency",
      description: "Were the official's calls and rule applications consistent throughout the entire match?"
    },
    {
      key: "appearance",
      label: "Appearance",
      description: "Did the official maintain proper uniform, grooming, and professional appearance standards?"
    },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white drop-shadow-lg">
          Evaluate {official?.firstName} {official?.lastName}
        </h2>
        <p className="text-white/90 drop-shadow-md">
          Please provide your evaluation for this official's performance
        </p>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((data) => {
            if (isVideoValidatingRef.current) {
              toast({
                title: "Checking Video",
                description: "Please wait while the selected video's length is checked.",
              });
              return;
            }
            mutation.mutate(data);
          })}
          className="space-y-6 text-white"
        >
            <FormField
              control={form.control}
              name="eventId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm sm:text-base text-white">Select Event</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(parseInt(value))}
                    defaultValue={field.value.toString()}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose an event" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {events?.map((event) => {
                        // Parse date string to avoid timezone issues
                        const eventDate = event.date as Date | string;
                        const dateStr = typeof eventDate === 'string' ? eventDate.split('T')[0] : eventDate;
                        const formattedDate = formatInEastern(dateStr, 'PPP');
                        
                        return (
                          <SelectItem key={event.id} value={event.id.toString()}>
                            {event.name} - {formattedDate}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {ratingCategories.map((category) => (
                <div key={category.key} className="bg-black/40 p-4 rounded-lg border border-white/20">
                  <FormField
                    control={form.control}
                    name={category.key as any}
                    render={({ field }) => (
                      <FormItem>
                        <StarRating
                          value={field.value as number}
                          onChange={field.onChange}
                          label={category.label}
                        />
                        <FormMessage />
                        <div className="text-xs text-white/70 mt-2">
                          {category.description}
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-center">
              <div className="w-full max-w-2xl">
                <FormField
                  control={form.control}
                  name="comment"
                  render={({ field }) => (
                    <FormItem className="space-y-1 sm:space-y-2">
                      <FormLabel className="text-white font-medium text-center block">Additional Comments (Optional)</FormLabel>
                      <FormControl>
                        <Textarea {...field} className="min-h-[80px] sm:min-h-[120px]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Video Upload Section */}
            <div className="flex justify-center">
              <div className="w-full max-w-2xl">
                <div className="bg-black/40 p-4 rounded-lg border border-white/20 space-y-4">
                  <Label className="text-white font-medium text-center block">
                    Upload Video Clip (Optional)
                  </Label>
                  <p className="text-xs text-white/70 text-center">
                    Upload a video clip (max 30 seconds, 50MB) to provide additional context for your review
                  </p>

                  {!videoPreview ? (
                    <div className="border-2 border-dashed border-white/30 rounded-lg p-6 text-center">
                      <Video className="h-12 w-12 mx-auto mb-4 text-white/60" />
                      <div className="space-y-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="relative"
                          onClick={() => videoInputRef.current?.click()}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Choose Video File
                        </Button>
                        <input
                          ref={videoInputRef}
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime,video/avi,video/*"
                          capture="environment"
                          onChange={handleVideoChange}
                          className="hidden"
                        />
                      </div>
                      <p className="text-xs text-white/50 mt-2">
                        Supported formats: MP4, WebM, QuickTime, AVI
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <video
                        ref={videoPreviewRef}
                        src={videoPreview}
                        controls
                        className="w-full max-h-64 rounded-lg bg-black"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-white">
                          {videoFile?.name}
                        </span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={removeVideo}
                        >
                          Remove Video
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending || isUploading || isVideoValidating}
            >
              {isVideoValidating
                ? "Checking video..."
                : isUploading
                  ? "Uploading..."
                  : mutation.isPending
                    ? "Submitting..."
                    : "Submit Review"}
            </Button>
          </form>
      </Form>
    </div>
  );
}