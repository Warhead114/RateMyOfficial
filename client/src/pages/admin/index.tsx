import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import AdminLogin from "./admin-login";
import AddOfficialForm from "./add-official-form";
import AddSupervisorForm from "./add-supervisor-form";
import AddEventForm from "./add-event-form";
import PendingUsers from "./pending-users";
import ManageCoaches from "./manage-coaches";
import ManageTeams from "./manage-teams";
import ManageReviews from "@/components/manage-reviews";

import { Official } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import EventList from "@/components/event-list";
import { useToast } from "@/hooks/use-toast";

import { Loading } from "@/components/ui/loading";
import AddCoachForm from "./add-coach-form";

function SystemMaintenancePanel() {
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshRatingsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/refresh-ratings");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "All official ratings have been refreshed successfully"
      });

      // Force invalidate and refetch ALL officials-related caches
      queryClient.invalidateQueries({ queryKey: ["/api/officials"] });

      // Invalidate all individual official queries
      queryClient.invalidateQueries({
        predicate: (query) => {
          return typeof query.queryKey[0] === "string" &&
                 (query.queryKey[0].startsWith("/api/officials/") ||
                  query.queryKey[0].includes("officials"));
        },
      });

      // Force immediate refetch of officials data
      queryClient.refetchQueries({ queryKey: ["/api/officials"] });

      setIsRefreshing(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to refresh ratings",
        variant: "destructive"
      });
      setIsRefreshing(false);
    }
  });

  const handleRefreshRatings = () => {
    if (confirm("Are you sure you want to refresh all officials' ratings? This may take a moment.")) {
      setIsRefreshing(true);
      refreshRatingsMutation.mutate();
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">System Maintenance</h3>

      <Alert>
        <Terminal className="h-4 w-4" />
        <AlertTitle>Ratings Recalculation</AlertTitle>
        <AlertDescription>
          This will refresh all officials' ratings and review counts based on currently valid reviews.
          Use this tool to fix any data inconsistencies when officials show incorrect review counts.
        </AlertDescription>
      </Alert>

      <div className="flex gap-2 mt-4">
        <Button
          onClick={handleRefreshRatings}
          disabled={isRefreshing}
          className="bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
        >
          {isRefreshing ? "Refreshing..." : "Refresh All Ratings"}
        </Button>

        <Button
          onClick={async () => {
            try {
              const response = await fetch('/api/admin/update-experience', {
                method: 'POST',
                credentials: 'include'
              });

              if (response.ok) {
                const result = await response.json();
                alert(`Success: ${result.message}`);
                // Refresh the officials list to show updated experience
                queryClient.invalidateQueries({ queryKey: ["/api/officials"] });
              } else {
                const error = await response.json();
                alert(`Error: ${error.message}`);
              }
            } catch (error) {
              alert('Failed to update experience');
            }
          }}
          variant="outline"
          className="bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
        >
          Update All Experience (+1 Year)
        </Button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // Get tab from URL query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const defaultTab = urlParams.get('tab') || 'officials';
  
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/auth/me");
      return response.json();
    }
  });

  const { data: officialsResponse, isLoading: isLoadingOfficials, error: officialsError } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/officials");
      return response.json();
    },
    enabled: !!user && user.role === "admin"
  });
  const officialsData = officialsResponse?.data;
  const officials = officialsData ? [...officialsData].sort((a, b) => a.lastName.localeCompare(b.lastName)) : [];

  const { data: supervisorsResponse, isLoading: isLoadingSupervisors, error: supervisorsError } = useQuery<{data: any[], total: number}>({
    queryKey: ["/api/users/supervisors"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/users/supervisors");
      return response.json();
    },
    enabled: !!user && user.role === "admin"
  });
  // Filter out the current user from the supervisors list if they are a Regional Supervisor
  const supervisors = supervisorsResponse?.data?.filter(supervisor =>
    !(user?.userType === "Regional Supervisor" && supervisor.id === user?.id)
  );

  const deleteOfficialMutation = useMutation({
    mutationFn: async (officialId: number) => {
      await apiRequest("DELETE", `/api/officials/${officialId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Official has been deleted"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/officials"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete official",
        variant: "destructive"
      });
    }
  });

  // Delete supervisor mutation
  const deleteSupervisorMutation = useMutation({
    mutationFn: async (supervisorId: number) => {
      // Admins always use the admin endpoint
      const endpoint = `/api/admin/supervisors/${supervisorId}`;
      const response = await apiRequest("DELETE", endpoint);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to delete supervisor" }));
        throw new Error(error.message || "Failed to delete supervisor");
      }
      return response.json();
    },
    onSuccess: async () => {
      toast({
        title: "Regional Supervisor deleted",
        description: "The Regional Supervisor has been successfully deleted",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/users/supervisors"] });
      await queryClient.refetchQueries({ queryKey: ["/api/users/supervisors"] });
    },
    onError: (error: any) => {
      console.error("Delete supervisor error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete Regional Supervisor",
        variant: "destructive",
      });
    },
  });

  if (isLoadingUser) {
    return null;
  }

  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return <AdminLogin />;
  }

  const handleDeleteOfficial = (officialId: number) => {
    if (confirm("Are you sure you want to delete this official?")) {
      deleteOfficialMutation.mutate(officialId);
    }
  };

  const handleDeleteSupervisor = (supervisorId: number) => {
    if (confirm("Are you sure you want to delete this supervisor?")) {
      deleteSupervisorMutation.mutate(supervisorId);
    }
  };

  return (
    <div className="space-y-8">
      <Card className="overflow-visible min-h-screen bg-transparent border-transparent">
        <CardHeader className="sticky top-0 z-10 bg-black/80 backdrop-blur-sm text-center border-b border-white/20">
          <CardTitle className="text-white text-lg sm:text-xl md:text-2xl font-bold drop-shadow-lg">Admin Dashboard</CardTitle>
          <CardDescription className="text-white/90 text-sm sm:text-base drop-shadow-md">
            Manage officials, events, and user approvals
          </CardDescription>
        </CardHeader>
        <CardContent className="touch-scroll-area styled-scrollbar">
          <Tabs defaultValue={defaultTab} className="space-y-4">
            <TabsList className="flex flex-nowrap justify-start overflow-x-auto overflow-y-hidden pb-1 w-full bg-black/60 backdrop-blur-md border border-white/20">
              <TabsTrigger value="officials" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Add Official</TabsTrigger>
              <TabsTrigger value="manage" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Manage Officials</TabsTrigger>
              <TabsTrigger value="addSupervisor" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Add Supervisor</TabsTrigger>
              <TabsTrigger value="manageSupervisors" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Manage Supervisors</TabsTrigger>
              <TabsTrigger value="events" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Add Event</TabsTrigger>
              <TabsTrigger value="manageEvents" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Manage Events</TabsTrigger>
              <TabsTrigger value="reviews" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Manage Reviews</TabsTrigger>
              <TabsTrigger value="coaches" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Add Coach</TabsTrigger>
              <TabsTrigger value="manageCoaches" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Manage Coaches</TabsTrigger>
              <TabsTrigger value="teams" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Teams</TabsTrigger>
              <TabsTrigger value="pending" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Pending Users</TabsTrigger>

              <TabsTrigger value="system" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">System</TabsTrigger>
            </TabsList>
            <TabsContent value="officials" className="admin-dashboard-text">
              <AddOfficialForm />
            </TabsContent>
            <TabsContent value="addSupervisor">
              <AddSupervisorForm />
            </TabsContent>
            <TabsContent value="manageSupervisors" className="admin-dashboard-text">
              {isLoadingSupervisors ? (
                <Loading />
              ) : supervisorsError ? (
                <div className="text-center p-4">
                  <div className="text-red-300 font-semibold text-shadow-lg">Error loading supervisors: {supervisorsError.message}</div>
                  <div className="text-sm text-white/80 mt-2 text-shadow-md">
                    User: {user?.email} | Role: {user?.role} | Type: {user?.userType}
                  </div>
                </div>
              ) : !supervisors ? (
                <div className="text-center p-4">
                  <div className="text-yellow-300 font-semibold text-shadow-lg">Unable to load supervisors data</div>
                  <div className="text-sm text-white/80 mt-2 text-shadow-md">
                    Check console for debugging information
                  </div>
                </div>
              ) : supervisors.length === 0 ? (
                <div className="text-center p-4">
                  <div className="text-white font-semibold text-shadow-lg">No supervisors found</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {supervisors.map((supervisor) => (
                    <Card key={supervisor.id} className="bg-transparent border-white/30 shadow-xl">
                      <CardContent className="pt-6 px-6">
                        <div className="flex flex-col items-center gap-4 text-center">
                          <Avatar className="h-32 w-32 border-4 border-white/20">
                            <AvatarImage
                              src={supervisor.photoUrl || undefined}
                              alt={`${supervisor.firstName} ${supervisor.lastName}`}
                            />
                            <AvatarFallback className="bg-black/80 backdrop-blur-md text-white text-lg font-semibold border border-white/20">{supervisor.firstName[0]}</AvatarFallback>
                          </Avatar>
                          <div className="space-y-2 w-full">
                            <h3 className="athletic-text text-xl text-white font-bold text-shadow-lg">
                              {supervisor.firstName} {supervisor.lastName}
                            </h3>

                            <div className="space-y-1 text-base text-white font-medium text-shadow-md">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Email:</span>
                                <span>{supervisor.email}</span>
                              </div>

                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Region:</span>
                                <span>{supervisor.region || 'Not specified'}</span>
                              </div>

                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Experience:</span>
                                <span>{supervisor.yearsExperience || 0} years</span>
                              </div>

                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Status:</span>
                                <span>{supervisor.verified ? 'Verified' : 'Pending'}</span>
                              </div>
                            </div>

                            <div className="flex gap-2 pt-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-sm flex-1 bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
                                onClick={() => setLocation(`/admin/supervisors/${supervisor.id}/edit`)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="text-sm flex-1 bg-red-600/80 backdrop-blur-md border-red-500/50 text-white hover:bg-red-700/90 hover:text-white shadow-lg"
                                onClick={() => handleDeleteSupervisor(supervisor.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="manage" className="admin-dashboard-text">
              {isLoadingOfficials ? (
                <Loading />
              ) : officialsError ? (
                <div className="text-center p-4">
                  <div className="text-red-300 font-semibold text-shadow-lg">Error loading officials: {officialsError.message}</div>
                  <div className="text-sm text-white/80 mt-2 text-shadow-md">
                    User: {user?.email} | Role: {user?.role} | Type: {user?.userType}
                  </div>
                </div>
              ) : !officialsData ? (
                <div className="text-center p-4">
                  <div className="text-yellow-300 font-semibold text-shadow-lg">Unable to load officials data</div>
                  <div className="text-sm text-white/80 mt-2 text-shadow-md">
                    Check console for debugging information
                  </div>
                </div>
              ) : officials.length === 0 ? (
                <div className="text-center p-4">
                  <div className="text-white font-semibold text-shadow-lg">No officials found</div>
                  <div className="text-sm text-white/80 mt-2 text-shadow-md">
                    Officials should include: Cody Jamerson, Kyle Jamerson, Zack Warfield, Jerimy Rinker, Leigh Harris, Michael Fonte
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {officials.map((official) => (
                    <Card key={official.id} className="bg-transparent border-white/30 shadow-xl">
                      <CardContent className="pt-6 px-6">
                        <div className="flex flex-col items-center gap-4 text-center">
                          <Avatar className="h-20 w-20 border-2 border-white/30">
                            <AvatarImage 
                              src={official.photoUrl || undefined}
                              alt={`${official.firstName} ${official.lastName}`}
                            />
                            <AvatarFallback className="bg-black/80 backdrop-blur-md text-white text-lg font-semibold border border-white/20">{official.firstName[0]}</AvatarFallback>
                          </Avatar>
                          <div className="space-y-2 w-full">
                            <h3 className="athletic-text text-xl text-white font-bold text-shadow-lg">
                              {official.firstName} {official.lastName}
                            </h3>

                            <div className="space-y-1 text-base text-white font-medium text-shadow-md">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Age:</span>
                                <span>{official.age}</span>
                              </div>

                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Location:</span>
                                <span>{official.location}</span>
                              </div>

                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Experience:</span>
                                <span>{official.yearsExperience} years</span>
                              </div>

                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">Rating:</span>
                                <span>{official.averageRating || 0}/5 ({official.totalReviews || 0} reviews)</span>
                              </div>
                            </div>

                            <div className="flex gap-2 pt-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-sm flex-1 bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
                                onClick={() => setLocation(`/admin/officials/${official.id}/edit`)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="text-sm flex-1 bg-red-600/80 backdrop-blur-md border-red-500/50 text-white hover:bg-red-700/90 hover:text-white shadow-lg"
                                onClick={() => handleDeleteOfficial(official.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="events" className="admin-dashboard-text">
              <AddEventForm />
            </TabsContent>
            <TabsContent value="manageEvents" className="admin-dashboard-text">
              <EventList />
            </TabsContent>
            <TabsContent value="reviews" className="admin-dashboard-text">
              <ManageReviews />
            </TabsContent>
            <TabsContent value="coaches" className="admin-dashboard-text">
              <AddCoachForm />
            </TabsContent>
            <TabsContent value="manageCoaches" className="admin-dashboard-text">
              <ManageCoaches />
            </TabsContent>
            <TabsContent value="teams" className="admin-dashboard-text">
              <ManageTeams />
            </TabsContent>
            <TabsContent value="pending" className="admin-dashboard-text">
              <PendingUsers />
            </TabsContent>

            <TabsContent value="system" className="admin-dashboard-text">
              <SystemMaintenancePanel />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}