import React, { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AlertCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loading } from "@/components/ui/loading";
import { useToast } from "@/hooks/use-toast";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Review {
  id: number;
  officialId: number;
  userId: number;
  eventId: number;
  mechanics: number;
  professionalism: number;
  positioning: number;
  stalling: number;
  consistency: number;
  appearance: number;
  comment: string;
  date: string;
  isReported: boolean;
  isAnonymous: boolean;
  user: {
    firstName: string;
    lastName: string;
    userType: string;
    photoUrl?: string;
  };
  event: {
    name: string;
    date: string;
  };
}

interface Official {
  id: number;
  firstName: string;
  lastName: string;
  age: number;
  location: string;
  association: string;
  yearsExperience: number;
  photoUrl?: string;
  averageRating: number;
  totalReviews: number;
}

export default function ManageReviews() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOfficialId, setSelectedOfficialId] = useState<string>("");

  // Query to get all officials
  const { data: officialsResponse, isLoading: isLoadingOfficials } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/officials");
      return response.json();
    },
  });

  const officials = officialsResponse?.data || [];

  // Query to get reviews for selected official
  const { data: reviews = [], isLoading: isLoadingReviews, error } = useQuery<Review[]>({
    queryKey: ["/api/officials", selectedOfficialId, "reviews"],
    queryFn: async () => {
      if (!selectedOfficialId) return [];
      const response = await apiRequest("GET", `/api/officials/${selectedOfficialId}/reviews`);
      return response.json();
    },
    enabled: !!selectedOfficialId,
  });

  // Delete review mutation
  const deleteReviewMutation = useMutation({
    mutationFn: async (reviewId: number) => {
      const response = await apiRequest("DELETE", `/api/reviews/${reviewId}`);
      if (!response.ok) {
        throw new Error("Failed to delete review");
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch ALL related caches to ensure immediate refresh
      queryClient.invalidateQueries({
        queryKey: ["/api/officials", selectedOfficialId, "reviews"],
      });

      // Invalidate the specific official's data cache (by ID)
      queryClient.invalidateQueries({
        queryKey: [`/api/officials/${selectedOfficialId}`],
      });

      // Invalidate the official's slug-based cache
      queryClient.invalidateQueries({
        predicate: (query) => {
          return query.queryKey[0] === "/api/officials/slug" && 
                 query.queryKey.includes("reviews");
        },
      });

      // Invalidate individual official slug queries
      queryClient.invalidateQueries({
        predicate: (query) => {
          return typeof query.queryKey[0] === "string" && 
                 query.queryKey[0].startsWith("/api/officials/slug/");
        },
      });

      // Invalidate the main officials list to refresh averageRating/totalReviews
      queryClient.invalidateQueries({
        queryKey: ["/api/officials"],
      });

      toast({
        title: "Success",
        description: "Review deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete review",
        variant: "destructive",
      });
    },
  });

  const handleDeleteReview = (reviewId: number) => {
    if (confirm("Are you sure you want to delete this review? This action cannot be undone.")) {
      deleteReviewMutation.mutate(reviewId);
    }
  };



  // Format date for display
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  // Calculate average rating for a review
  const calculateReviewAverage = (review: Review) => {
    return Math.round(
      (review.mechanics + review.professionalism + review.positioning +
       review.stalling + review.consistency + review.appearance) / 6
    );
  };

  if (isLoadingOfficials) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-64 space-y-4">
        <Loading />
        <p className="text-gray-600 font-semibold">Loading officials...</p>
      </div>
    );
  }

  return (
    <Card className="bg-transparent border-white/20">
      <CardHeader>
        <CardTitle className="text-white">Manage Reviews</CardTitle>
        <CardDescription className="text-white/70">
          Select an official to view and manage their reviews
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Official</label>
          <Select onValueChange={setSelectedOfficialId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an official to view their reviews" />
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

        {selectedOfficialId && (
          <>
            {isLoadingReviews ? (
              <div className="flex items-center justify-center w-full h-32">
                <Loading />
                <span className="ml-2">Loading reviews...</span>
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  Failed to load reviews. Please try again later.
                </AlertDescription>
              </Alert>
            ) : (
              <Table>
                <TableCaption>
                  Reviews for the selected official ({reviews.length} total)
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reviewer</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Ratings</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center">
                        No reviews found for this official
                      </TableCell>
                    </TableRow>
                  ) : (
                    reviews.map((review: Review) => (
                      <TableRow key={review.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {review.user.photoUrl && (
                              <img 
                                src={review.user.photoUrl} 
                                alt={`${review.user.firstName} ${review.user.lastName}`}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            )}
                            <div className="flex flex-col">
                              <span className="font-semibold">{review.user.firstName} {review.user.lastName}</span>
                              <span className="text-xs text-white/70">{review.user.userType}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{review.event.name}</TableCell>
                        <TableCell>{formatDate(review.date)}</TableCell>
                        <TableCell>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between gap-2">
                              <span className="text-white/70">Mechanics:</span>
                              <span className="font-semibold">{review.mechanics}/5</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-white/70">Professionalism:</span>
                              <span className="font-semibold">{review.professionalism}/5</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-white/70">Positioning:</span>
                              <span className="font-semibold">{review.positioning}/5</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-white/70">Stalling:</span>
                              <span className="font-semibold">{review.stalling}/5</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-white/70">Consistency:</span>
                              <span className="font-semibold">{review.consistency}/5</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-white/70">Appearance:</span>
                              <span className="font-semibold">{review.appearance}/5</span>
                            </div>
                            <div className="pt-1 border-t border-white/20">
                              <div className="flex justify-between gap-2">
                                <span className="text-white/90 font-semibold">Average:</span>
                                <span className="font-bold">{calculateReviewAverage(review)}/5</span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <p className="text-sm text-white whitespace-pre-wrap">{review.comment || "No comment"}</p>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteReview(review.id)}
                            disabled={deleteReviewMutation.isPending}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/20 p-2"
                            title="Delete review"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </>
        )}


      </CardContent>
    </Card>
  );
}