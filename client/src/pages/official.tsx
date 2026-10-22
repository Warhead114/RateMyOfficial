import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Official, Review, Event, Settings } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import RatingDisplay from "@/components/rating-display";
import { MapPin, Calendar, ShieldAlert, Star, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRatingsAccess } from "@/hooks/use-ratings-access";
import { Loading } from "@/components/ui/loading";
import VideoPlayer from "@/components/video-player";

interface CategoryAverages {
  mechanics: number;
  professionalism: number;
  positioning: number;
  stalling: number;
  consistency: number;
  appearance: number;
  overall: number;
  approvedReviewCount: number;
}

export default function OfficialPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { canViewRatings, isLoggedIn, role } = useRatingsAccess();
  const [photoUrl, setPhotoUrl] = React.useState<string | undefined>(undefined);

  const { data: official, isLoading: isLoadingOfficial } = useQuery<Official>({
    queryKey: [`/api/officials/slug/${slug}`],
    queryFn: async () => {
      const response = await fetch(`/api/officials/slug/${slug}`);
      if (!response.ok) {
        throw new Error("Failed to fetch official");
      }
      return response.json();
    }
  });

  const { data: reviews, isLoading: isLoadingReviews } = useQuery<Review[]>({
    queryKey: [`/api/officials/slug/${slug}/reviews`],
    queryFn: async () => {
      const response = await fetch(`/api/officials/slug/${slug}/reviews`);
      if (!response.ok) {
        throw new Error("Failed to fetch reviews");
      }
      return response.json();
    },
    // Only fetch reviews if user has access to view them
    enabled: canViewRatings
  });

  const { data: categoryAverages } = useQuery<CategoryAverages>({
    queryKey: [`/api/officials/slug/${slug}/rating-breakdown`],
    queryFn: async () => {
      const response = await fetch(`/api/officials/slug/${slug}/rating-breakdown`);
      if (!response.ok) {
        throw new Error("Failed to fetch rating breakdown");
      }
      return response.json();
    },
    enabled: canViewRatings
  });

  const { data: events } = useQuery<Event[]>({
    queryKey: [`/api/officials/slug/${slug}/events`],
    queryFn: async () => {
      const response = await fetch(`/api/officials/slug/${slug}/events`);
      if (!response.ok) {
        throw new Error("Failed to fetch events");
      }
      return response.json();
    }
  });

  const { data: siteSettings } = useQuery<Settings[]>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const response = await fetch("/api/settings");
      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }
      return response.json();
    }
  });

  // Load versioned image URL when official data changes
  React.useEffect(() => {
    const loadImageUrl = async () => {
      if (official?.photoUrl) {
        const { getVersionedImageUrl } = await import('@/lib/utils');
        const versionedUrl = await getVersionedImageUrl(official.photoUrl);
        setPhotoUrl(versionedUrl);
      }
    };
    loadImageUrl();
  }, [official?.photoUrl]);



  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!official?.id) throw new Error("Official ID not found");
      await apiRequest("DELETE", `/api/officials/${official.id}`);
    },
    onSuccess: () => {
      toast({
        title: "Official deleted",
        description: "The official has been removed from the system"
      });
      setLocation("/");
    }
  });

  const reportMutation = useMutation({
    mutationFn: async (reviewId: number) => {
      await apiRequest("POST", `/api/reviews/${reviewId}/report`);
    },
    onSuccess: () => {
      toast({
        title: "Review reported",
        description: "Thank you for helping maintain quality reviews"
      });
      queryClient.invalidateQueries({ queryKey: [`/api/officials/slug/${slug}/reviews`] });
    }
  });

  // Always use the golden/yellow officials silhouette for individual official pages
  const backgroundImage = "/uploads/OfficialsSilhouette.png";

  // Define the background style once at the component level
  const backgroundStyle = {
    backgroundImage: `url(${backgroundImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundAttachment: 'fixed'
  };

  // Handle loading state
  if (isLoadingOfficial) {
    return (
      <div
        className="min-h-screen"
        style={backgroundStyle}
      >
        <div className="container mx-auto px-4 py-8 space-y-8">
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Loading />
          </div>
        </div>
      </div>
    );
  }

  // Handle not found
  if (!official) {
    return (
      <div
        className="min-h-screen"
        style={backgroundStyle}
      >
        <div className="container mx-auto px-4 py-8 space-y-8">
          <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
            <CardContent className="pt-6 text-center">
              <div className="text-white text-lg">Official not found</div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const isAdmin = role === "admin";
  const fullName = `${official.firstName} ${official.lastName}`;
  return (
    <div
      className="min-h-screen"
      style={backgroundStyle}
    >
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Quote above official */}
        <div className="text-center pt-4">
          <div className="p-6 max-w-3xl mx-auto">
            <blockquote className="text-lg italic text-white mb-2 drop-shadow-lg">
              "There is nothing noble in being superior to your fellow man; true nobility is being superior to your former self."
            </blockquote>
            <cite className="text-sm text-gray-200 drop-shadow-lg">-Ernest Hemingway</cite>
          </div>
        </div>

        <Card className="bg-transparent border-white/20 shadow-xl">
          <CardContent className="pt-4 sm:pt-6">
            <div className="flex flex-col items-center gap-4 sm:gap-6 text-center">
              <Avatar className="h-32 w-32 sm:h-40 sm:w-40 border-4 border-white/30">
                <AvatarImage 
                  src={photoUrl} 
                  alt={fullName}
                  loading="eager"
                  crossOrigin="anonymous"
                />
                <AvatarFallback className="bg-white/20 text-white text-2xl font-semibold">{official.firstName[0]}</AvatarFallback>
              </Avatar>
              <div className="space-y-3 sm:space-y-4 w-full">
                <div>
                  <h1 className="athletic-text text-2xl sm:text-3xl md:text-4xl font-bold text-white drop-shadow-lg">{fullName}</h1>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-white/90">
                  <div className="bg-black/40 p-3 rounded-lg border border-white/20">
                    <div className="text-sm font-medium text-white/70">Age</div>
                    <div className="text-lg font-semibold">{official.age}</div>
                  </div>

                  <div className="bg-black/40 p-3 rounded-lg border border-white/20">
                    <div className="text-sm font-medium text-white/70 flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Location
                    </div>
                    <div className="text-lg font-semibold">{official.location}</div>
                  </div>

                  <div className="bg-black/40 p-3 rounded-lg border border-white/20">
                    <div className="text-sm font-medium text-white/70 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Experience
                    </div>
                    <div className="text-lg font-semibold">{official.yearsExperience} years</div>
                  </div>

                  <div className="bg-black/40 p-3 rounded-lg border border-white/20">
                    <div className="text-sm font-medium text-white/70">Association</div>
                    <div className="text-lg font-semibold">{official.association}</div>
                  </div>
                </div>

                <div className="flex justify-center">
                  <RatingDisplay
                    rating={official.averageRating || 0}
                    total={official.totalReviews || 0}
                    size="lg"
                  />
                </div>

                {!canViewRatings && (
                  <div className="flex items-center text-muted-foreground gap-2 text-xs sm:text-sm justify-center md:justify-start flex-wrap">
                    <Lock className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span>Individual reviews are restricted to administrators and supervisors</span>
                  </div>
                )}

                {isAdmin && (
                  <div className="flex gap-2 justify-center md:justify-start">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs sm:text-sm"
                      onClick={() => setLocation(`/admin/officials/${official.id}/edit`)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="text-xs sm:text-sm"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this official?")) {
                          deleteMutation.mutate();
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {canViewRatings && categoryAverages && (
          <Card className="bg-transparent border-white/20 shadow-xl">
            <CardHeader>
              <CardTitle className="text-white drop-shadow-lg">Rating Averages by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <div className="bg-black/40 p-3 rounded-md border border-white/20">
                  <p className="font-medium text-white drop-shadow-lg text-sm sm:text-base">Mechanics</p>
                  <RatingDisplay rating={categoryAverages.mechanics} showTotal={false} size="sm" />
                </div>
                <div className="bg-black/40 p-3 rounded-md border border-white/20">
                  <p className="font-medium text-white drop-shadow-lg text-sm sm:text-base">Professionalism</p>
                  <RatingDisplay rating={categoryAverages.professionalism} showTotal={false} size="sm" />
                </div>
                <div className="bg-black/40 p-3 rounded-md border border-white/20">
                  <p className="font-medium text-white drop-shadow-lg text-sm sm:text-base">Positioning</p>
                  <RatingDisplay rating={categoryAverages.positioning} showTotal={false} size="sm" />
                </div>
                <div className="bg-black/40 p-3 rounded-md border border-white/20">
                  <p className="font-medium text-white drop-shadow-lg text-sm sm:text-base">Stalling</p>
                  <RatingDisplay rating={categoryAverages.stalling} showTotal={false} size="sm" />
                </div>
                <div className="bg-black/40 p-3 rounded-md border border-white/20">
                  <p className="font-medium text-white drop-shadow-lg text-sm sm:text-base">Consistency</p>
                  <RatingDisplay rating={categoryAverages.consistency} showTotal={false} size="sm" />
                </div>
                <div className="bg-black/40 p-3 rounded-md border border-white/20">
                  <p className="font-medium text-white drop-shadow-lg text-sm sm:text-base">Appearance</p>
                  <RatingDisplay rating={categoryAverages.appearance} showTotal={false} size="sm" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoggedIn && (
          <Card className="bg-transparent border-white/20 shadow-xl">
            <CardContent className="py-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-4 text-white drop-shadow-lg">Want to evaluate this official?</h2>
                <Button
                  className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => setLocation(`/officials/${slug}/review`)}
                >
                  Evaluate Official
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!canViewRatings ? (
          <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
            <CardHeader>
              <CardTitle className="text-white drop-shadow-lg">Reviews</CardTitle>
            </CardHeader>
            <CardContent className="text-center py-8">
              <ShieldAlert className="h-16 w-16 mx-auto text-white/70 mb-4" />
              <h3 className="text-lg font-medium mb-2 text-white drop-shadow-lg">Restricted Access</h3>
              <p className="text-white/80 max-w-md mx-auto">
                Individual reviews are only accessible to Regional Supervisors and Administrators.
                This ensures fair and objective evaluation of officials.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
            <CardHeader>
              <CardTitle className="text-white drop-shadow-lg">Reviews</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoadingReviews ? (
                <Loading />
              ) : !reviews?.length ? (
                <div className="text-white/70">No reviews yet</div>
              ) : (
                reviews?.map((review) => {
                  const event = events?.find(e => e.id === review.eventId);
                  return (
                    <Card key={review.id} className="bg-black/40 border-white/30 backdrop-blur-sm">
                      <CardContent className="pt-6">
                        <div className="space-y-4">
                          {event && (
                            <div className="font-medium text-white/80 drop-shadow-lg">
                              Event: {event.name} ({event.date instanceof Date ? event.date.toLocaleDateString() :
                                                    typeof event.date === 'string' ? new Date(event.date).toLocaleDateString() :
                                                    'Date unavailable'})
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                            <div className="bg-black/50 p-2 rounded-md border border-white/20">
                              <p className="font-medium text-white drop-shadow-lg text-xs sm:text-sm">Mechanics</p>
                              <RatingDisplay rating={review.mechanics} showTotal={false} size="sm" />
                            </div>
                            <div className="bg-black/50 p-2 rounded-md border border-white/20">
                              <p className="font-medium text-white drop-shadow-lg text-xs sm:text-sm">Professionalism</p>
                              <RatingDisplay rating={review.professionalism} showTotal={false} size="sm" />
                            </div>
                            <div className="bg-black/50 p-2 rounded-md border border-white/20">
                              <p className="font-medium text-white drop-shadow-lg text-xs sm:text-sm">Positioning</p>
                              <RatingDisplay rating={review.positioning} showTotal={false} size="sm" />
                            </div>
                            <div className="bg-black/50 p-2 rounded-md border border-white/20">
                              <p className="font-medium text-white drop-shadow-lg text-xs sm:text-sm">Stalling</p>
                              <RatingDisplay rating={review.stalling} showTotal={false} size="sm" />
                            </div>
                            <div className="bg-black/50 p-2 rounded-md border border-white/20">
                              <p className="font-medium text-white drop-shadow-lg text-xs sm:text-sm">Consistency</p>
                              <RatingDisplay rating={review.consistency} showTotal={false} size="sm" />
                            </div>
                            <div className="bg-black/50 p-2 rounded-md border border-white/20">
                              <p className="font-medium text-white drop-shadow-lg text-xs sm:text-sm">Appearance</p>
                              <RatingDisplay rating={review.appearance} showTotal={false} size="sm" />
                            </div>
                          </div>
                          {review.comment && (
                            <p className="mt-4 text-white/80">{review.comment}</p>
                          )}

                          {review.videoUrl && (
                            <div className="mt-4">
                              <VideoPlayer videoUrl={review.videoUrl} />
                            </div>
                          )}
                          <div className="mt-4 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              {review.isAnonymous ? (
                                <div className="flex items-center gap-3">
                                  <Avatar className="h-10 w-10 border-2 border-white/30">
                                    <AvatarFallback className="bg-white/20 text-white">A</AvatarFallback>
                                  </Avatar>
                                  <div className="text-sm">
                                    <p className="font-medium text-white drop-shadow-lg">
                                      Anonymous Review
                                    </p>
                                    <p className="text-white/70">
                                      {review.date ? new Date(review.date).toLocaleDateString('en-US', {
                                        month: '2-digit',
                                        day: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        hour12: false
                                      }) : ''}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <Avatar className="h-10 w-10 border-2 border-white/30">
                                    <AvatarImage src={review.user?.photoUrl || undefined} alt={`${review.user?.firstName} ${review.user?.lastName}`} />
                                    <AvatarFallback className="bg-white/20 text-white">{review.user?.firstName[0]}</AvatarFallback>
                                  </Avatar>
                                  <div className="text-sm">
                                    <p className="font-medium text-white drop-shadow-lg">
                                      {review.user?.firstName} {review.user?.lastName} ({review.user?.userType})
                                    </p>
                                    <p className="text-white/70">
                                      {review.date ? new Date(review.date).toLocaleDateString('en-US', {
                                        month: '2-digit',
                                        day: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        hour12: false
                                      }) : ''}
                                    </p>
                                  </div>
                                </>
                              )}
                            </div>
                            {!review.isReported && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-white/80 hover:text-white hover:bg-white/20"
                                onClick={() => reportMutation.mutate(review.id)}
                              >
                                Report
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}