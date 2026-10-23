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
  DialogClose,
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
import { Pencil, Trash2 } from "lucide-react";
import { Loading } from "@/components/ui/loading";
import { AdminRegionEditor } from "@/components/admin-region-editor";

interface Coach {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  school?: string;
  region?: string | null;
  eventEmailsApproved?: boolean;
  yearsCoaching?: number;
  photoUrl?: string;
}

// Schema for coach edits
const coachEditSchema = z.object({
  firstName: z.string().min(1, "First name is required").trim(),
  lastName: z.string().min(1, "Last name is required").trim(),
  email: z.string().min(1, "Email is required").trim(),
  school: z.string().min(1, "School is required").trim(),
  yearsCoaching: z.coerce.number().int().nonnegative().optional(),
  photo: z.instanceof(FileList).optional(),
});

type CoachEditValues = z.infer<typeof coachEditSchema>;

export default function ManageCoaches() {
  const { toast } = useToast();
  const [selectedCoach, setSelectedCoach] = useState<Coach | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [coachToDelete, setCoachToDelete] = useState<Coach | null>(null);

  // Get all coaches
  const { data: coaches, isLoading } = useQuery({
    queryKey: ["/api/admin/coaches"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const { data: authUser } = useQuery<{ role?: string; user?: { role?: string } }>({
    queryKey: ["/api/auth/me"],
  });
  const { data: officialsData } = useQuery<{
    data?: Array<{ association?: string | null }>;
  }>({
    queryKey: ["/api/officials"],
  });
  const isAdmin = authUser?.role === "admin" || authUser?.user?.role === "admin";
  const regionSuggestions = Array.from(
    new Set((officialsData?.data ?? []).map((official) => official.association?.trim()).filter(Boolean)),
  ) as string[];

  // Form for editing coach
  const form = useForm<CoachEditValues>({
    resolver: zodResolver(coachEditSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      school: "",
      yearsCoaching: 0,
    },
  });

  // Delete coach mutation
  const deleteCoachMutation = useMutation({
    mutationFn: async (coachId: number) => {
      const response = await apiRequest("DELETE", `/api/admin/coaches/${coachId}`);
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
        console.error('RefreshUtils error in manage-coaches delete:', error);
        // Fallback to manual refresh if utility fails
        queryClient.removeQueries({ queryKey: ["/api/admin/coaches"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/coaches"] });
        await queryClient.refetchQueries({ queryKey: ["/api/admin/coaches"], type: 'active' });

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
      const formData = new FormData();

      // Append all fields except photo
      Object.entries(data).forEach(([key, value]) => {
        if (key !== 'photo' && value !== undefined && value !== null) {
          formData.append(key, value.toString());
        }
      });

      // Append photo if exists
      if (data.photo instanceof FileList && data.photo.length > 0) {
        formData.append('photo', data.photo[0]);
      }

      const response = await fetch(`/api/admin/coaches/${id}`, {
        method: 'PATCH',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
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
        console.error('RefreshUtils error in manage-coaches edit:', error);
        // Fallback to manual refresh if utility fails
        queryClient.removeQueries({ queryKey: ["/api/admin/coaches"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/coaches"] });
        await queryClient.refetchQueries({ queryKey: ["/api/admin/coaches"], type: 'active' });

        toast({
          title: "Coach updated",
          description: "The coach profile has been successfully updated",
        });
        setEditDialogOpen(false);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update coach",
        variant: "destructive",
      });
    },
  });

  const handleDeleteCoach = (coach: Coach) => {
    setCoachToDelete(coach);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (coachToDelete) {
      deleteCoachMutation.mutate(coachToDelete.id);
      setDeleteConfirmOpen(false);
      setCoachToDelete(null);
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
                <CardContent className="pt-6 px-6">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <Avatar className="h-20 w-20 border-2 border-white/30">
                      <AvatarImage 
                        src={coach.photoUrl ? `${coach.photoUrl.replace(/\\/g, '/')}?t=${Date.now()}&r=${Math.random().toString(36).substring(2, 9)}&s=${Math.random().toString(36).substring(2, 7)}&mobile=true` : undefined} 
                        alt={`${coach.firstName} ${coach.lastName}`}
                        loading="eager"
                        crossOrigin="anonymous"
                        key={`coach-${coach.id}-${Date.now()}`}
                      />
                      <AvatarFallback className="bg-white/20 text-white text-lg font-semibold">{coach.firstName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="space-y-2 w-full">
                      <h3 className="athletic-text text-xl text-white font-bold drop-shadow-lg">
                        {coach.firstName} {coach.lastName}
                      </h3>

                      <div className="space-y-1 text-base text-white/90">
                        <div className="flex items-center justify-center gap-2">
                          <span className="font-medium">Email:</span>
                          <span className="text-sm truncate">{coach.email}</span>
                        </div>

                        <div className="flex items-center justify-center gap-2">
                          <span className="font-medium">School:</span>
                          <span>{coach.school || "Not specified"}</span>
                        </div>
                        <p className="text-sm text-center">
                          {coach.eventEmailsApproved
                            ? "Event email details approved"
                            : "Event emails paused — confirm school and email in Edit"}
                        </p>

                        <div className="flex items-center justify-center gap-2">
                          <span className="font-medium">Years Coaching:</span>
                          <span>{coach.yearsCoaching || 0} years</span>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-sm flex-1 bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
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
                          className="text-sm flex-1 bg-red-600/80 backdrop-blur-md border-red-500/50 text-white hover:bg-red-700/90 hover:text-white shadow-lg"
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
          <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
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
                        <Input {...field} className="bg-black/30 border-white/20 text-white focus-visible:ring-white" />
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
                        <Input {...field} className="bg-black/30 border-white/20 text-white focus-visible:ring-white" />
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
                        <Input
                          {...field}
                          type="email"
                          className="bg-black/30 border-white/20 text-white focus-visible:ring-white"
                          autoComplete="email"
                          inputMode="email"
                        />
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
                        <Input {...field} className="bg-black/30 border-white/20 text-white focus-visible:ring-white" />
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
                        <Input type="number" min="0" {...field} className="bg-white text-gray-900" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="photo"
                  render={({ field: { onChange, value, ...field } }) => (
                    <FormItem>
                      <FormLabel>Profile Photo</FormLabel>
                      <FormControl>
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => onChange(e.target.files)}
                          {...field}
                          className="bg-black/30 border-white/20 text-white file:text-white"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <p className="text-sm text-muted-foreground">
                    Saving confirms the school and email for event notifications.
                    Unapproved accounts remain ineligible.
                  </p>
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
            {selectedCoach && (
              <AdminRegionEditor
                key={`coach-region-${selectedCoach.id}`}
                isAdmin={isAdmin}
                recordId={selectedCoach.id}
                region={selectedCoach.region}
                endpoint={`/api/admin/coaches/${selectedCoach.id}/region`}
                suggestions={regionSuggestions}
                queryKeys={[
                  ["/api/admin/coaches"],
                  ["/api/supervisor/coaches"],
                ]}
                helpText="Changing a region alone does not approve event notifications. Review this coach’s team and email, then explicitly save the managed profile above to reapprove."
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete {coachToDelete?.firstName} {coachToDelete?.lastName}? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={deleteCoachMutation.isPending}
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function getQueryFn({ on401 }: { on401: "throw" | "returnNull" }) {
  return async () => {
    const response = await apiRequest("GET", "/api/admin/coaches");

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