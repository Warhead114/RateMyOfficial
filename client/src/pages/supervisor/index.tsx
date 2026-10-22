import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import AddOfficialForm from "../admin/add-official-form";
import AddSupervisorForm from "./add-supervisor-form";
import AddEventForm from "../admin/add-event-form";
import AddCoachForm from "../admin/add-coach-form";
import { Official, User } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import EventList from "@/components/event-list";
import { useToast } from "@/hooks/use-toast";
import { ProfileEdit } from "./profile-edit";
import ManageCoaches from "./manage-coaches";
import PendingUsers from "./pending-users";
import ManageTeams from "../admin/manage-teams";
import ManageReviews from "@/components/manage-reviews";

import { Loading } from "@/components/ui/loading";

export default function SupervisorPage() {
  // ALL HOOKS MUST BE AT THE TOP - NO CONDITIONAL HOOKS
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: user, isLoading: isLoadingUser } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/auth/me");
      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }
      return response.json();
    }
  });

  const { data: officialsResponse, isLoading: isLoadingOfficials } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/officials");
      if (!response.ok) {
        throw new Error('Failed to fetch officials');
      }
      return response.json();
    },
    enabled: !!user && user.userType === "Regional Supervisor"
  });

  const { data: supervisorsResponse, isLoading: isLoadingSupervisors } = useQuery<{data: any[], total: number}>({
    queryKey: ["/api/users/supervisors"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/users/supervisors");
      if (!response.ok) {
        throw new Error('Failed to fetch supervisors');
      }
      return response.json();
    },
    enabled: !!user && user.userType === "Regional Supervisor"
  });
  // Filter out the current user from the supervisors list
  const supervisors = supervisorsResponse?.data?.filter(supervisor => supervisor.id !== user?.id);

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
      const response = await apiRequest("DELETE", `/api/users/supervisors/${supervisorId}`);
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


  // Handler functions after hooks
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

  // Derived state after hooks
  const officialsData = officialsResponse?.data;
  const officials = officialsData ? [...officialsData].sort((a, b) => a.lastName.localeCompare(b.lastName)) : [];

  // Early returns after all hooks are called
  if (isLoadingUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
        <Loading />
        <p className="text-white font-semibold text-shadow-md">Loading...</p>
      </div>
    );
  }

  if (!user || user.userType !== "Regional Supervisor") {
    return <div>Access denied. This page is only for Regional Supervisors.</div>;
  }

  return (
    <div className="space-y-8">
      <Card className="overflow-visible min-h-screen bg-transparent border-transparent">
        <CardHeader className="sticky top-0 z-10 bg-black/80 backdrop-blur-sm text-center border-b border-white/20">
          <CardTitle className="text-white text-lg sm:text-xl md:text-2xl font-bold drop-shadow-lg">Regional Supervisor Dashboard</CardTitle>
          <CardDescription className="text-white/90 text-sm sm:text-base drop-shadow-md">
            Manage officials, events, and user approvals
          </CardDescription>
        </CardHeader>
        <CardContent className="touch-scroll-area styled-scrollbar">
          <Tabs defaultValue="profile" className="space-y-4">
            <TabsList className="flex flex-nowrap justify-start overflow-x-auto overflow-y-hidden pb-1 w-full bg-black/60 backdrop-blur-md border border-white/20">
              <TabsTrigger value="profile" data-tab="profile" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">My Profile</TabsTrigger>
              <TabsTrigger value="manage-profile" data-tab="manage-profile" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Manage Profile</TabsTrigger>
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
              <TabsTrigger value="pendingUsers" className="text-xs whitespace-nowrap text-white hover:text-white hover:bg-white/20 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Pending Users</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="admin-dashboard-text">
              <div className="space-y-4 sm:space-y-6">
                <h3 className="text-base sm:text-lg font-medium text-white text-shadow-lg">My Profile</h3>
                <div className="flex flex-col items-center space-y-4 sm:space-y-6">
                  {user.photoUrl ? (
                    <div className="w-28 h-28 sm:w-40 sm:h-40 rounded-full overflow-hidden">
                      <img
                        src={user.photoUrl}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-28 h-28 sm:w-40 sm:h-40 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-2xl sm:text-4xl text-muted-foreground">
                        {user.firstName[0]}{user.lastName[0]}
                      </span>
                    </div>
                  )}
                  <div className="w-full max-w-md space-y-2 sm:space-y-4 px-2 sm:px-0">
                    <div className="grid grid-cols-1 gap-y-2">
                      <div>
                        <p className="text-xs sm:text-sm text-white font-semibold text-shadow-md">Name</p>
                        <p className="text-sm sm:text-lg font-medium text-white text-shadow-md">{user.firstName} {user.lastName}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-white font-semibold text-shadow-md">Email</p>
                        <p className="text-sm sm:text-lg text-ellipsis overflow-hidden text-white text-shadow-md">{user.email}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-white font-semibold text-shadow-md">Region</p>
                        <p className="text-sm sm:text-lg text-white text-shadow-md">{user.region || 'Not specified'}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-white font-semibold text-shadow-md">Years Experience</p>
                        <p className="text-sm sm:text-lg text-white text-shadow-md">{user.yearsExperience !== null ? user.yearsExperience : 'Not specified'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="manage-profile" className="admin-dashboard-text">
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-white text-shadow-lg">Manage Profile</h3>
                <ProfileEdit user={user} />
              </div>
            </TabsContent>

            <TabsContent value="officials" className="admin-dashboard-text">
              <AddOfficialForm />
            </TabsContent>

            <TabsContent value="addSupervisor" className="admin-dashboard-text">
              <AddSupervisorForm />
            </TabsContent>

            <TabsContent value="manageSupervisors" className="admin-dashboard-text">
              {isLoadingSupervisors ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <Loading />
                  <p className="text-white font-semibold text-shadow-md">Loading supervisors...</p>
                </div>
              ) : !supervisors || supervisors.length === 0 ? (
                <div className="text-center p-4">
                  <div className="text-white font-semibold text-shadow-md">No Regional Supervisors Found</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {supervisors.map((supervisor) => (
                    <Card key={supervisor.id} className="bg-transparent border-white/30 shadow-xl">
                      <CardContent className="pt-6 px-6">
                        <div className="flex flex-col items-center gap-4 text-center">
                          <Avatar className="h-32 w-32 border-4 border-white/20">
                            <AvatarImage
                              src={supervisor.photoUrl}
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
                                onClick={() => setLocation(`/supervisor/supervisors/${supervisor.id}/edit`)}
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
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <Loading />
                  <p className="text-white font-semibold text-shadow-md">Loading officials...</p>
                </div>
              ) : !officials || officials.length === 0 ? (
                <div className="text-center p-4">
                  <div className="text-white font-semibold text-shadow-md">No officials found</div>
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
                                onClick={() => setLocation(`/supervisor/officials/${official.id}/edit`)}
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

            <TabsContent value="pendingUsers" className="admin-dashboard-text">
              <PendingUsers />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}