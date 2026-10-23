import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
import { AlertCircle, Pencil, Trash } from "lucide-react";
import { Loading } from "@/components/ui/loading";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AdminRegionEditor } from "@/components/admin-region-editor";

interface Team {
  id: number;
  name: string;
  createdAt: string;
  region?: string | null;
}

const teamFormSchema = z.object({
  name: z.string().min(1, "Team name is required"),
});

type TeamFormValues = z.infer<typeof teamFormSchema>;

export default function ManageTeams() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Form for adding/editing teams
  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      name: "",
    },
  });

  // Query to get all teams
  const { data: teamsData = [], isLoading, error } = useQuery({
    queryKey: ["/api/teams"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/teams");
      return response.json();
    },
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

  // Sort teams alphabetically by name
  const teams = [...teamsData].sort((a, b) => a.name.localeCompare(b.name));

  // Mutation to create a new team
  const createTeamMutation = useMutation({
    mutationFn: async (data: TeamFormValues) => {
      const response = await apiRequest("POST", "/api/teams", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      toast({
        title: "Success",
        description: "Team created successfully",
      });
      setAddDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create team",
        variant: "destructive",
      });
    },
  });

  // Mutation to update a team
  const updateTeamMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: TeamFormValues }) => {
      const response = await apiRequest("PATCH", `/api/teams/${id}`, data);
      return response.json();
    },
    onSuccess: async () => {
      toast({
        title: "Success",
        description: "Team updated successfully",
      });
      setEditDialogOpen(false);
      setCurrentTeam(null);
      form.reset();

      // Force immediate cache invalidation and refetch
      queryClient.removeQueries({ queryKey: ["/api/teams"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      await queryClient.refetchQueries({ queryKey: ["/api/teams"], type: 'active' });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update team",
        variant: "destructive",
      });
    },
  });

  // Mutation to delete a team
  const deleteTeamMutation = useMutation({
    mutationFn: async (teamId: number) => {
      const response = await apiRequest("DELETE", `/api/teams/${teamId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to delete team" }));
        throw new Error(error.message || "Failed to delete team");
      }
      return response.json();
    },
    onSuccess: async () => {
      toast({
        title: "Team deleted",
        description: "The team has been successfully deleted",
      });
      setDeleteConfirmOpen(false);
      setCurrentTeam(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      await queryClient.refetchQueries({ queryKey: ["/api/teams"] });
    },
    onError: (error: any) => {
      console.error("Delete team error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete team",
        variant: "destructive",
      });
    },
  });

  // Handle opening the edit dialog
  const handleEditTeam = (team: Team) => {
    setCurrentTeam(team);
    form.setValue("name", team.name);
    setEditDialogOpen(true);
  };

  // Handle opening the delete confirmation dialog
  const handleDeleteTeam = (team: Team) => {
    setCurrentTeam(team);
    setDeleteConfirmOpen(true);
  };

  // Handle submitting the form for editing a team
  const onEditSubmit = (data: TeamFormValues) => {
    if (currentTeam) {
      updateTeamMutation.mutate({ id: currentTeam.id, data });
    }
  };

  // Handle submitting the form for adding a new team
  const onAddSubmit = (data: TeamFormValues) => {
    createTeamMutation.mutate(data);
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <Loading text="Loading teams..." />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load teams. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="bg-transparent border-white/20">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-white">Manage Teams</CardTitle>
          <CardDescription className="text-white/70">
            View, edit, and delete teams in the system
          </CardDescription>
        </div>
        <Button onClick={() => {
          form.reset();
          setAddDialogOpen(true);
        }}>
          Add New Team
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableCaption>List of all teams in the system</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center">
                  No teams found
                </TableCell>
              </TableRow>
            ) : (
              teams.map((team: Team) => (
                <TableRow key={team.id}>
                  <TableCell>{team.name}</TableCell>
                  <TableCell>{formatDate(team.createdAt)}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
                      onClick={() => handleEditTeam(team)}
                      disabled={updateTeamMutation.isPending || deleteTeamMutation.isPending}
                    >
                      {updateTeamMutation.isPending && currentTeam?.id === team.id ? (
                        <div className="flex items-center justify-center">
                          <div className="relative mr-1">
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
                        <>
                          <Pencil className="h-4 w-4 mr-1" /> Edit
                        </>
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="bg-red-600/80 backdrop-blur-md border-red-500/50 text-white hover:bg-red-700/90 hover:text-white shadow-lg"
                      onClick={() => handleDeleteTeam(team)}
                      disabled={updateTeamMutation.isPending || deleteTeamMutation.isPending}
                    >
                      {deleteTeamMutation.isPending && currentTeam?.id === team.id ? (
                        <div className="flex items-center justify-center">
                          <div className="relative mr-1">
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
                        <>
                          <Trash className="h-4 w-4 mr-1" /> Delete
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Edit Team Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Team</DialogTitle>
              <DialogDescription>
                Update the team information below.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter team name" {...field} className="bg-transparent border-white/20 text-white"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" type="button">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    type="submit"
                    disabled={updateTeamMutation.isPending}
                  >
                    {updateTeamMutation.isPending ? (
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
            {currentTeam && (
              <AdminRegionEditor
                key={`team-region-${currentTeam.id}`}
                isAdmin={isAdmin}
                recordId={currentTeam.id}
                region={currentTeam.region}
                endpoint={`/api/admin/teams/${currentTeam.id}/region`}
                suggestions={regionSuggestions}
                queryKeys={[
                  ["/api/teams"],
                  ["/api/admin/coaches"],
                  ["/api/supervisor/coaches"],
                ]}
                helpText="A region change alone does not approve event notifications. If a coach’s notification eligibility needs review, verify their team and email, then explicitly save the managed profile to reapprove."
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Add Team Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Team</DialogTitle>
              <DialogDescription>
                Enter the information for the new team.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onAddSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter team name" {...field} className="bg-white border-gray-300 text-gray-900"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" type="button">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    type="submit"
                    disabled={createTeamMutation.isPending}
                  >
                    {createTeamMutation.isPending ? (
                      <div className="flex items-center justify-center">
                        <div className="relative mr-2">
                          <div className="w-4 h-4 bg-white rounded-full animate-pulse"></div>
                          <img 
                            src="/uploads/wrestlers-silhouette.png" 
                            alt="" 
                            className="absolute inset-0 w-3 h-3 m-auto object-contain animate-pulse"
                          />
                        </div>
                        Adding...
                      </div>
                    ) : (
                      "Add Team"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the team "{currentTeam?.name}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => currentTeam && deleteTeamMutation.mutate(currentTeam.id)}
                disabled={deleteTeamMutation.isPending}
              >
                {deleteTeamMutation.isPending ? (
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