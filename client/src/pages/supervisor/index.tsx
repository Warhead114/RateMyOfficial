import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import AddOfficialForm from "../admin/add-official-form";
import AddEventForm from "../admin/add-event-form";
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
import SupervisorSettings from "./settings";

export default function SupervisorPage() {
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
    enabled: user?.role === "supervisor"
  });
  const officials = officialsResponse?.data;

  if (isLoadingUser) {
    return <div>Loading...</div>;
  }

  if (!user || user.userType !== "Regional Supervisor") {
    return <div>Access denied. This page is only for Regional Supervisors.</div>;
  }

  const deleteMutation = useMutation({
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

  const handleDelete = (officialId: number) => {
    if (confirm("Are you sure you want to delete this official?")) {
      deleteMutation.mutate(officialId);
    }
  };

  return (
    <div className="space-y-8">
      <Card className="overflow-visible min-h-screen">
        <CardHeader className="sticky top-0 z-10 bg-card">
          <CardTitle>Regional Supervisor Dashboard</CardTitle>
          <CardDescription>
            Manage officials, events, and user approvals
          </CardDescription>
        </CardHeader>
        <CardContent className="touch-scroll-area styled-scrollbar">
          <Tabs defaultValue="profile" className="space-y-4">
            <TabsList className="flex flex-nowrap justify-start overflow-x-auto overflow-y-hidden pb-1 w-full">
              <TabsTrigger value="profile" data-tab="profile" className="text-xs sm:text-sm whitespace-nowrap">My Profile</TabsTrigger>
              <TabsTrigger value="manage-profile" data-tab="manage-profile" className="text-xs sm:text-sm whitespace-nowrap">Manage Profile</TabsTrigger>
              <TabsTrigger value="officials" className="text-xs sm:text-sm whitespace-nowrap">Add Official</TabsTrigger>
              <TabsTrigger value="manage" className="text-xs sm:text-sm whitespace-nowrap">Manage Officials</TabsTrigger>
              <TabsTrigger value="events" className="text-xs sm:text-sm whitespace-nowrap">Add Event</TabsTrigger>
              <TabsTrigger value="manageEvents" className="text-xs sm:text-sm whitespace-nowrap">Manage Events</TabsTrigger>
              <TabsTrigger value="reviews" className="text-xs sm:text-sm whitespace-nowrap">Manage Reviews</TabsTrigger>
              <TabsTrigger value="manageCoaches" className="text-xs sm:text-sm whitespace-nowrap">Manage Coaches</TabsTrigger>
              <TabsTrigger value="teams" className="text-xs sm:text-sm whitespace-nowrap">Manage Teams</TabsTrigger>
              <TabsTrigger value="pendingUsers" className="text-xs sm:text-sm whitespace-nowrap">Pending Users</TabsTrigger>
              <TabsTrigger value="settings" className="text-xs sm:text-sm whitespace-nowrap">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <div className="space-y-4 sm:space-y-6">
                <h3 className="text-base sm:text-lg font-medium">My Profile</h3>
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
                        <p className="text-xs sm:text-sm text-muted-foreground">Name</p>
                        <p className="text-sm sm:text-lg font-medium">{user.firstName} {user.lastName}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-muted-foreground">Email</p>
                        <p className="text-sm sm:text-lg text-ellipsis overflow-hidden">{user.email}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-muted-foreground">Region</p>
                        <p className="text-sm sm:text-lg">{user.region || 'Not specified'}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-muted-foreground">Years Experience</p>
                        <p className="text-sm sm:text-lg">{user.yearsExperience !== null ? user.yearsExperience : 'Not specified'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="manage-profile">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Manage Profile</h3>
                <ProfileEdit user={user} />
              </div>
            </TabsContent>

            <TabsContent value="officials">
              <AddOfficialForm />
            </TabsContent>
            <TabsContent value="manage">
              {isLoadingOfficials ? (
                <div>Loading officials...</div>
              ) : officials?.length === 0 ? (
                <div className="text-muted-foreground">No officials found</div>
              ) : (
                <div className="space-y-4">
                  {officials?.map((official) => (
                    <Card key={official.id}>
                      <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6">
                        <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
                          <div className="flex gap-3 sm:gap-4">
                            <Avatar className="h-12 w-12 sm:h-16 sm:w-16 shrink-0">
                              <AvatarImage src={official.photoUrl || undefined} alt={`${official.firstName} ${official.lastName}`} />
                              <AvatarFallback>{official.firstName[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <h3 className="font-medium text-sm sm:text-base">
                                {official.firstName} {official.lastName}
                              </h3>
                              <div className="text-xs sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
                                <p>Location: {official.location}</p>
                                <p>Association: {official.association}</p>
                                <p>Experience: {official.yearsExperience} years</p>
                                <p>Rating: {official.averageRating || 0}/5 ({official.totalReviews || 0} reviews)</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 self-end sm:self-start mt-2 sm:mt-0">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs sm:text-sm"
                              onClick={() => setLocation(`/supervisor/officials/${official.id}/edit`)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="text-xs sm:text-sm"
                              onClick={() => handleDelete(official.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="events">
              <AddEventForm />
            </TabsContent>
            <TabsContent value="manageEvents">
              <EventList />
            </TabsContent>
            <TabsContent value="reviews">
              <ManageReviews />
            </TabsContent>
            <TabsContent value="manageCoaches">
              <ManageCoaches />
            </TabsContent>
            <TabsContent value="teams">
              <ManageTeams />
            </TabsContent>
            <TabsContent value="pendingUsers">
              <PendingUsers />
            </TabsContent>
            <TabsContent value="settings">
              <SupervisorSettings />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}