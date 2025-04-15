import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertReviewSchema, type InsertReview, type Event } from "@shared/schema";
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
import { Star } from "lucide-react";

interface ReviewFormProps {
  officialId: number;
}

export default function ReviewForm({ officialId }: ReviewFormProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Fetch events this official is assigned to
  const { data: events } = useQuery<Event[]>({
    queryKey: [`/api/officials/${officialId}/events`],
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
      isAnonymous: false,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertReview) => {
      await apiRequest("POST", `/api/officials/${officialId}/reviews`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/officials/${officialId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/officials/${officialId}/reviews`] });
      form.reset();

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

  const StarRating = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => {
    return (
      <div className="flex gap-1 sm:gap-2">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            className={`hover:text-yellow-400 ${
              rating <= value ? "text-yellow-400" : "text-gray-300"
            }`}
            onClick={() => onChange(rating)}
          >
            <Star className="h-5 w-5 sm:h-6 sm:w-6" />
          </button>
        ))}
      </div>
    );
  };

  if (!events?.length) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Write a Review</CardTitle>
        <CardDescription>
          Rate the official's performance at a specific event
        </CardDescription>
      </CardHeader>
      <CardContent className="touch-scroll-area styled-scrollbar max-h-[80vh]">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="eventId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Event</FormLabel>
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
                      {events?.map((event) => (
                        <SelectItem key={event.id} value={event.id.toString()}>
                          {event.name} - {new Date(event.date).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <FormField
                control={form.control}
                name="mechanics"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel className="text-sm sm:text-base">Mechanics</FormLabel>
                    <FormDescription className="text-xs sm:text-sm">
                      Did the official utilize proper NFHS signals and apply the rules set forth by the NFHS appropriately and efficiently?
                    </FormDescription>
                    <FormControl>
                      <StarRating value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="professionalism"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel className="text-sm sm:text-base">Professionalism</FormLabel>
                    <FormDescription className="text-xs sm:text-sm">
                      Was the official approachable and did they conduct themselves in a professional manner?
                    </FormDescription>
                    <FormControl>
                      <StarRating value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="positioning"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel className="text-sm sm:text-base">Positioning</FormLabel>
                    <FormDescription className="text-xs sm:text-sm">
                      Was the official consistently anticipating where the action would go and maintaining an advantageous vantage point to make the right calls?
                    </FormDescription>
                    <FormControl>
                      <StarRating value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="stalling"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel className="text-sm sm:text-base">Stalling</FormLabel>
                    <FormDescription className="text-xs sm:text-sm">
                      Did the official appropriately call stalling, regardless of time or score?
                    </FormDescription>
                    <FormControl>
                      <StarRating value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="consistency"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel className="text-sm sm:text-base">Consistency</FormLabel>
                    <FormDescription className="text-xs sm:text-sm">
                      Was the official consistent with their calls throughout the event?
                    </FormDescription>
                    <FormControl>
                      <StarRating value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="appearance"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel className="text-sm sm:text-base">Appearance</FormLabel>
                    <FormDescription className="text-xs sm:text-sm">
                      Was the official well-dressed, well-groomed, and overall hygienic for the event?
                    </FormDescription>
                    <FormControl>
                      <StarRating value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem className="space-y-1 sm:space-y-2">
                  <FormLabel className="text-sm sm:text-base">Additional Comments (Optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} className="min-h-[80px] sm:min-h-[120px]" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isAnonymous"
              render={({ field }) => (
                <FormItem className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-lg border p-3 sm:p-4 gap-3 sm:gap-0">
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm sm:text-base">Submit anonymously?</FormLabel>
                    <FormDescription className="text-xs sm:text-sm">
                      If 'Yes', your name and photo will not appear next to your review.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <div className="flex space-x-4">
                      <div 
                        className={`cursor-pointer px-3 py-1 rounded-md text-sm ${!field.value ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}
                        onClick={() => field.onChange(false)}
                      >
                        No
                      </div>
                      <div 
                        className={`cursor-pointer px-3 py-1 rounded-md text-sm ${field.value ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}
                        onClick={() => field.onChange(true)}
                      >
                        Yes
                      </div>
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Submitting..." : "Submit Review"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}