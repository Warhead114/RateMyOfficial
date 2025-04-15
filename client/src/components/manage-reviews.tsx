import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Review, Official } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";

export default function ManageReviews() {
  const { toast } = useToast();
  const [selectedOfficial, setSelectedOfficial] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Fetch all officials
  const { data: officialsResponse, isLoading: isLoadingOfficials } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
  });
  const officials = officialsResponse?.data || [];

  // Fetch reviews for selected official
  const { data: reviews, isLoading: isLoadingReviews } = useQuery<Review[]>({
    queryKey: [`/api/officials/${selectedOfficial}/reviews`],
    enabled: !!selectedOfficial,
  });

  // Delete review mutation
  const deleteMutation = useMutation({
    mutationFn: async (reviewId: number) => {
      await apiRequest("DELETE", `/api/reviews/${reviewId}`);
    },
    onSuccess: () => {
      toast({
        title: "Review deleted",
        description: "The review has been permanently deleted",
      });
      if (selectedOfficial) {
        queryClient.invalidateQueries({ queryKey: [`/api/officials/${selectedOfficial}/reviews`] });
        queryClient.invalidateQueries({ queryKey: ["/api/officials"] });
      }
      setDeleteConfirm(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete review. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (reviewId: number) => {
    setDeleteConfirm(reviewId);
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      deleteMutation.mutate(deleteConfirm);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Manage Reviews</h3>
        <p className="text-sm text-muted-foreground">
          Review and moderate user feedback for wrestling officials. You can delete reviews that violate community guidelines or contain inappropriate content.
        </p>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="official-select">Select Official</Label>
            <Select
              value={selectedOfficial?.toString() || ""}
              onValueChange={(value) => setSelectedOfficial(parseInt(value))}
            >
              <SelectTrigger id="official-select" className="mt-1">
                <SelectValue placeholder="Select an official" />
              </SelectTrigger>
              <SelectContent>
                {officials.map((official) => (
                  <SelectItem key={official.id} value={official.id.toString()}>
                    {official.firstName} {official.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {isLoadingOfficials ? (
        <div>Loading officials...</div>
      ) : selectedOfficial ? (
        isLoadingReviews ? (
          <div>Loading reviews...</div>
        ) : !reviews?.length ? (
          <div className="text-center p-8 text-muted-foreground">
            No reviews found for this official
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <Card key={review.id} className={review.isReported ? "border-red-300" : ""}>
                <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-4 sm:pb-6">
                  <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={review.user?.photoUrl || undefined} alt="User" />
                          <AvatarFallback>{review.user?.firstName?.[0] || 'U'}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {review.isAnonymous 
                                ? "Anonymous" 
                                : `${review.user?.firstName || 'Unknown'} ${review.user?.lastName || 'User'}`}
                            </p>
                            <Badge variant="outline" className="text-xs">
                              {review.user?.userType || 'Unknown'}
                            </Badge>
                            {review.isReported && (
                              <Badge variant="destructive" className="text-xs">
                                Reported
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {review.date ? formatDistanceToNow(new Date(review.date), { addSuffix: true }) : 'Unknown date'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Event: {review.event?.name || 'Unknown event'}
                          </p>
                        </div>
                      </div>
                      <div className="text-sm">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm mb-2">
                          <div>Mechanics: {review.mechanics}/5</div>
                          <div>Professionalism: {review.professionalism}/5</div>
                          <div>Positioning: {review.positioning}/5</div>
                          <div>Stalling: {review.stalling}/5</div>
                          <div>Consistency: {review.consistency}/5</div>
                          <div>Appearance: {review.appearance}/5</div>
                        </div>
                        <p className="mt-2">{review.comment}</p>
                      </div>
                    </div>
                    <div className="flex sm:flex-col gap-2 justify-end sm:justify-start mt-2 sm:mt-0">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex gap-1 items-center"
                        onClick={() => handleDeleteClick(review.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <div className="text-center p-8 text-muted-foreground">
          Select an official to view and manage their reviews
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the review from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}