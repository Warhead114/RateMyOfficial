import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { refreshUtils } from "@/lib/refreshUtils";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Pencil, Trash2 } from "lucide-react";

interface Coach {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  school?: string;
  yearsCoaching?: number;
  photoUrl?: string;
  region?: string;
}

// Schema for coach edits
const coachEditSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  school: z.string().optional(),
  yearsCoaching: z.coerce.number().int().nonnegative().optional(),
  region: z.string().optional(),
});

type CoachEditValues = z.infer<typeof coachEditSchema>;

export default function ManageCoaches() {
  const { toast } = useToast();
  const [selectedCoach, setSelectedCoach] = useState<Coach | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Get all coaches (same as admin for feature parity)
  const { data: coaches, isLoading } = useQuery({
    queryKey: ["/api/supervisor/coaches"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Form for editing coach
  const form = useForm<CoachEditValues>({
    resolver: zodResolver(coachEditSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      school: "",
      yearsCoaching: 0,
      region: "",
    },
  });

  // Delete coach mutation
  const deleteCoachMutation = useMutation({
    mutationFn: async (coachId: number) => {
      const response = await apiRequest("DELETE", `/api/supervisor/coaches/${coachId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to delete coach" }));
        throw new Error(error.message || "Failed to delete coach");
      }
      return response.json();
    },
    onSuccess: async () => {
      console.log('Coach delete successful, refreshing caches');
      
      try {
        // Use standardized refresh utility for coach deletion
        await refreshUtils.coaches.afterDelete();
        
        toast({
          title: "Coach deleted",
          description: "The coach has been successfully deleted",
        });
      } catch (error) {
        console.error('RefreshUtils error in supervisor manage-coaches delete:', error);
        // Fallback to manual refresh if utility fails
        queryClient.removeQueries({ queryKey: ["/api/supervisor/coaches"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/supervisor/coaches"] });
        await queryClient.refetchQueries({ queryKey: ["/api/supervisor/coaches"], type: 'active' });
        
        toast({
          title: "Coach deleted",
          description: "The coach has been successfully deleted",
        });
      }
    },
    onError: (error: any) => {
      console.error("Delete coach error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete coach",
        variant: "destructive",
      });
    },
  });

  // Edit coach mutation
  const editCoachMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CoachEditValues }) => {
      const response = await apiRequest("PATCH", `/api/supervisor/coaches/${id}`, data);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to update coach" }));
        throw new Error(error.message || "Failed to update coach");
      }
      return response.json();
    },
    onSuccess: async () => {
      console.log('Coach edit successful, refreshing caches');
      
      try {
        // Use standardized refresh utility for coach edit
        await refreshUtils.coaches.afterEdit(selectedCoach?.id.toString() || '');
        
        toast({
          title: "Coach updated",
          description: "The coach profile has been successfully updated",
        });
        setEditDialogOpen(false);
      } catch (error) {
        console.error('RefreshUtils error in supervisor manage-coaches edit:', error);
        // Fallback to manual refresh if utility fails
        queryClient.removeQueries({ queryKey: ["/api/supervisor/coaches"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/supervisor/coaches"] });
        await queryClient.refetchQueries({ queryKey: ["/api/supervisor/coaches"], type: 'active' });
        
        toast({
          title: "Coach updated",
          description: "The coach profile has been successfully updated",
        });
        setEditDialogOpen(false);
      }
    },
    onError: (error: any) => {
      console.error("Edit coach error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update coach",
        variant: "destructive",
      });
    },
  });

  const handleDeleteCoach = (coach: Coach) => {
    if (window.confirm(`Are you sure you want to delete ${coach.firstName} ${coach.lastName}?`)) {
      deleteCoachMutation.mutate(coach.id);
    }
  };

  const handleEditCoach = (coach: Coach) => {
    setSelectedCoach(coach);
    form.reset({
      firstName: coach.firstName,
      lastName: coach.lastName,
      email: coach.email,
      school: coach.school || "",
      yearsCoaching: coach.yearsCoaching || 0,
    });
    setEditDialogOpen(true);
  };

  const onSubmit = (data: CoachEditValues) => {
    if (selectedCoach) {
      editCoachMutation.mutate({ id: selectedCoach.id, data });
    }
  };

  return (
    <Card className="bg-transparent border-white/20">
      <CardHeader>
        <CardTitle className="text-white">Manage Coaches</CardTitle>
        <CardDescription className="text-white/70">
          View, edit, and delete coaches in the system
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="relative animate-pulse">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
                <img
                  src="/uploads/wrestlers-silhouette.png"
                  alt="Loading..."
                  className="w-12 h-12 opacity-70"
                />
              </div>
            </div>
            <p className="text-white font-semibold text-shadow-md">Loading coaches...</p>
          </div>
        ) : coaches && coaches.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {coaches.map((coach: Coach) => (
              <Card key={coach.id} className="bg-transparent border-white/30 shadow-xl">
                <CardContent className="pt-6">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <h3 className="font-semibold text-white text-shadow-lg">
                        {coach.firstName} {coach.lastName}
                      </h3>
                      <div className="text-sm text-white font-medium text-shadow-md space-y-1">
                        <p><span className="font-semibold">Email:</span> {coach.email}</p>
                        <p><span className="font-semibold">School:</span> {coach.school || 'Not specified'}</p>
                        <p><span className="font-semibold">Years Coaching:</span> {coach.yearsCoaching || 'Not specified'}</p>
                        <p><span className="font-semibold">Region:</span> {coach.region || 'Not specified'}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
                        onClick={() => handleEditCoach(coach)}
                        disabled={deleteCoachMutation.isPending || editCoachMutation.isPending}
                      >
                        {editCoachMutation.isPending ? (
                          <div className="flex items-center justify-center">
                            <div className="relative mr-2">
                              <div className="w-4 h-4 bg-white rounded-full animate-pulse"></div>
                              <img
                                src="/uploads/wrestlers-silhouette.png"
                                alt=""
                                className="absolute inset-0 w-3 h-3 m-auto object-contain animate-pulse"
                              />
                            </div>
                            Updating...
                          </div>
                        ) : (
                          "Edit"
                        )}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="bg-red-600/80 backdrop-blur-md border-red-500/50 text-white hover:bg-red-700/90 hover:text-white shadow-lg"
                        onClick={() => handleDeleteCoach(coach)}
                        disabled={deleteCoachMutation.isPending || editCoachMutation.isPending}
                      >
                        {deleteCoachMutation.isPending ? (
                          <div className="flex items-center justify-center">
                            <div className="relative mr-2">
                              <div className="w-4 h-4 bg-white rounded-full animate-pulse"></div>
                              <img
                                src="/uploads/wrestlers-silhouette.png"
                                alt=""
                                className="absolute inset-0 w-3 h-3 m-auto object-contain animate-pulse"
                              />
                            </div>
                            Deleting...
                          </div>
                        ) : (
                          "Delete"
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center p-4">
            <p className="text-white font-semibold text-shadow-md">No coaches found in the system.</p>
          </div>
        )}

        {/* Edit Coach Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Edit Coach Profile</DialogTitle>
              <DialogDescription>
                Update the coach's information below.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="school"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>School</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="yearsCoaching"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Years Coaching</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Region</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., West Region" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditDialogOpen(false)}
                    disabled={editCoachMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={editCoachMutation.isPending}
                  >
                    {editCoachMutation.isPending ? (
                      <div className="flex items-center justify-center">
                        <div className="relative mr-2">
                          <div className="w-4 h-4 bg-white rounded-full animate-pulse"></div>
                          <img
                            src="/uploads/wrestlers-silhouette.png"
                            alt=""
                            className="absolute inset-0 w-3 h-3 m-auto object-contain animate-pulse"
                          />
                        </div>
                        Saving...
                      </div>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function getQueryFn({ on401 }: { on401: "throw" | "returnNull" }) {
  return async () => {
    const response = await apiRequest("GET", "/api/supervisor/coaches");

    if (response.status === 401) {
      if (on401 === "throw") {
        throw new Error("Unauthorized");
      }
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  };
}