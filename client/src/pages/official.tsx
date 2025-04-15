import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Official, Review, Event } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import RatingDisplay from "@/components/rating-display";
import { MapPin, Calendar, ShieldAlert, Star, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRatingsAccess } from "@/hooks/use-ratings-access";

interface CategoryAverages {
  mechanics: number;
  professionalism: number;
  positioning: number;
  stalling: number;
  consistency: number;
  appearance: number;
}

export default function OfficialPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { canViewRatings, isLoggedIn, role } = useRatingsAccess();

  const { data: official, isLoading: isLoadingOfficial } = useQuery<Official>({
    queryKey: [`/api/officials/${id}`]
  });

  const { data: reviews, isLoading: isLoadingReviews } = useQuery<Review[]>({
    queryKey: [`/api/officials/${id}/reviews`],
    // Only fetch reviews if user has access to view them
    enabled: canViewRatings
  });

  const { data: events } = useQuery<Event[]>({
    queryKey: [`/api/officials/${id}/events`]
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/officials/${id}`);
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
      queryClient.invalidateQueries({ queryKey: [`/api/officials/${id}/reviews`] });
    }
  });

  const calculateCategoryAverages = (reviews: Review[]): CategoryAverages => {
    if (!reviews?.length) {
      return {
        mechanics: 0,
        professionalism: 0,
        positioning: 0,
        stalling: 0,
        consistency: 0,
        appearance: 0
      };
    }

    return {
      mechanics: Math.round(reviews.reduce((sum, r) => sum + r.mechanics, 0) / reviews.length),
      professionalism: Math.round(reviews.reduce((sum, r) => sum + r.professionalism, 0) / reviews.length),
      positioning: Math.round(reviews.reduce((sum, r) => sum + r.positioning, 0) / reviews.length),
      stalling: Math.round(reviews.reduce((sum, r) => sum + r.stalling, 0) / reviews.length),
      consistency: Math.round(reviews.reduce((sum, r) => sum + r.consistency, 0) / reviews.length),
      appearance: Math.round(reviews.reduce((sum, r) => sum + r.appearance, 0) / reviews.length)
    };
  };

  if (isLoadingOfficial || !official) {
    return <div>Loading...</div>;
  }

  const isAdmin = role === "admin";
  const fullName = `${official.firstName} ${official.lastName}`;
  const categoryAverages = reviews ? calculateCategoryAverages(reviews) : null;

  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <div className="flex flex-col md:flex-row gap-4 sm:gap-6 items-center md:items-start">
            <Avatar className="h-24 w-24 sm:h-32 sm:w-32">
              <AvatarImage src={official.photoUrl || undefined} alt={fullName} />
              <AvatarFallback>{official.firstName[0]}</AvatarFallback>
            </Avatar>
            <div className="space-y-3 sm:space-y-4 text-center md:text-left">
              <div>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">{fullName}</h1>
                <div className="flex items-center gap-2 text-muted-foreground justify-center md:justify-start">
                  <MapPin className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="text-sm sm:text-base">{official.location}</span>
                </div>
              </div>
              <div className="flex gap-4 justify-center md:justify-start">
                <div className="flex items-center gap-2">
                  <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="text-sm sm:text-base">{official.yearsExperience} years experience</span>
                </div>
              </div>
              
              <div className="flex justify-center md:justify-start">
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
                    onClick={() => setLocation(`/admin/officials/${id}/edit`)}
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
        <Card>
          <CardHeader>
            <CardTitle>Rating Averages by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <div className="bg-image-content p-2 sm:p-3 rounded-md">
                <p className="font-medium text-sm sm:text-base">Mechanics</p>
                <RatingDisplay rating={categoryAverages.mechanics} showTotal={false} size="sm" />
              </div>
              <div className="bg-image-content p-2 sm:p-3 rounded-md">
                <p className="font-medium text-sm sm:text-base">Professionalism</p>
                <RatingDisplay rating={categoryAverages.professionalism} showTotal={false} size="sm" />
              </div>
              <div className="bg-image-content p-2 sm:p-3 rounded-md">
                <p className="font-medium text-sm sm:text-base">Positioning</p>
                <RatingDisplay rating={categoryAverages.positioning} showTotal={false} size="sm" />
              </div>
              <div className="bg-image-content p-2 sm:p-3 rounded-md">
                <p className="font-medium text-sm sm:text-base">Stalling</p>
                <RatingDisplay rating={categoryAverages.stalling} showTotal={false} size="sm" />
              </div>
              <div className="bg-image-content p-2 sm:p-3 rounded-md">
                <p className="font-medium text-sm sm:text-base">Consistency</p>
                <RatingDisplay rating={categoryAverages.consistency} showTotal={false} size="sm" />
              </div>
              <div className="bg-image-content p-2 sm:p-3 rounded-md">
                <p className="font-medium text-sm sm:text-base">Appearance</p>
                <RatingDisplay rating={categoryAverages.appearance} showTotal={false} size="sm" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoggedIn && (
        <Card>
          <CardContent className="py-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-4">Want to evaluate this official?</h2>
              <Button 
                className="w-full md:w-auto"
                onClick={() => setLocation(`/officials/${id}/review`)}
              >
                Evaluate Official
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!canViewRatings ? (
        <Card>
          <CardHeader>
            <CardTitle>Reviews</CardTitle>
          </CardHeader>
          <CardContent className="text-center py-8">
            <ShieldAlert className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Restricted Access</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Individual reviews are only accessible to Regional Supervisors and Administrators. 
              This ensures fair and objective evaluation of officials.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Reviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingReviews ? (
              <div>Loading reviews...</div>
            ) : !reviews?.length ? (
              <div className="text-muted-foreground">No reviews yet</div>
            ) : (
              reviews?.map((review) => {
                const event = events?.find(e => e.id === review.eventId);
                return (
                  <Card key={review.id}>
                    <CardContent className="pt-6">
                      <div className="space-y-4">
                        {event && (
                          <div className="font-medium text-muted-foreground">
                            Event: {event.name} ({event.date instanceof Date ? event.date.toLocaleDateString() : 
                                                typeof event.date === 'string' ? new Date(event.date).toLocaleDateString() : 
                                                'Date unavailable'})
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                          <div className="bg-image-content p-2 rounded-md">
                            <p className="font-medium text-xs sm:text-sm">Mechanics</p>
                            <RatingDisplay rating={review.mechanics} showTotal={false} size="sm" />
                          </div>
                          <div className="bg-image-content p-2 rounded-md">
                            <p className="font-medium text-xs sm:text-sm">Professionalism</p>
                            <RatingDisplay rating={review.professionalism} showTotal={false} size="sm" />
                          </div>
                          <div className="bg-image-content p-2 rounded-md">
                            <p className="font-medium text-xs sm:text-sm">Positioning</p>
                            <RatingDisplay rating={review.positioning} showTotal={false} size="sm" />
                          </div>
                          <div className="bg-image-content p-2 rounded-md">
                            <p className="font-medium text-xs sm:text-sm">Stalling</p>
                            <RatingDisplay rating={review.stalling} showTotal={false} size="sm" />
                          </div>
                          <div className="bg-image-content p-2 rounded-md">
                            <p className="font-medium text-xs sm:text-sm">Consistency</p>
                            <RatingDisplay rating={review.consistency} showTotal={false} size="sm" />
                          </div>
                          <div className="bg-image-content p-2 rounded-md">
                            <p className="font-medium text-xs sm:text-sm">Appearance</p>
                            <RatingDisplay rating={review.appearance} showTotal={false} size="sm" />
                          </div>
                        </div>
                        {review.comment && (
                          <p className="mt-4 text-muted-foreground">{review.comment}</p>
                        )}
                        <div className="mt-4 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            {review.isAnonymous ? (
                              <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                  <AvatarFallback>A</AvatarFallback>
                                </Avatar>
                                <div className="text-sm">
                                  <p className="font-medium">
                                    Anonymous Review
                                  </p>
                                  <p className="text-muted-foreground">
                                    {review.date ? new Date(review.date).toLocaleDateString() : ''}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <>
                                <Avatar className="h-10 w-10">
                                  <AvatarImage src={review.user?.photoUrl || undefined} alt={`${review.user?.firstName} ${review.user?.lastName}`} />
                                  <AvatarFallback>{review.user?.firstName[0]}</AvatarFallback>
                                </Avatar>
                                <div className="text-sm">
                                  <p className="font-medium">
                                    {review.user?.firstName} {review.user?.lastName} ({review.user?.userType})
                                  </p>
                                  <p className="text-muted-foreground">
                                    {review.date ? new Date(review.date).toLocaleDateString() : ''}
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                          {!review.isReported && (
                            <Button
                              variant="ghost"
                              size="sm"
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
  );
}