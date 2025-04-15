import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import AdminLogin from "./admin-login";
import AddOfficialForm from "./add-official-form";
import AddEventForm from "./add-event-form";
import PendingUsers from "./pending-users";
import ManageCoaches from "./manage-coaches";
import ManageTeams from "./manage-teams";
import ManageReviews from "@/components/manage-reviews";
import AdminSettings from "./settings";
import { Official } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import EventList from "@/components/event-list";
import { useToast } from "@/hooks/use-toast";

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
      // Invalidate officials cache to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["/api/officials"] });
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

      <Button 
        onClick={handleRefreshRatings} 
        disabled={isRefreshing}
        className="mt-4"
      >
        {isRefreshing ? "Refreshing Ratings..." : "Refresh All Official Ratings"}
      </Button>
    </div>
  );
}

export default function AdminPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/auth/me");
      return response.json();
    }
  });

  const { data: officialsResponse, isLoading: isLoadingOfficials } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
    enabled: user?.role === "admin"
  });
  const officials = officialsResponse?.data;

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

  if (isLoadingUser) {
    return <div>Loading...</div>;
  }

  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return <AdminLogin />;
  }

  const handleDelete = (officialId: number) => {
    if (confirm("Are you sure you want to delete this official?")) {
      deleteMutation.mutate(officialId);
    }
  };

  return (
    <div className="space-y-8">
      <Card className="overflow-visible min-h-screen">
        <CardHeader className="sticky top-0 z-10 bg-card">
          <CardTitle>Admin Dashboard</CardTitle>
          <CardDescription>
            Manage officials, events, and user approvals
          </CardDescription>
        </CardHeader>
        <CardContent className="touch-scroll-area styled-scrollbar">
          <Tabs defaultValue="officials" className="space-y-4">
            <TabsList className="flex flex-nowrap justify-start overflow-x-auto overflow-y-hidden pb-1 w-full">
              <TabsTrigger value="officials" className="text-xs sm:text-sm whitespace-nowrap">Add Official</TabsTrigger>
              <TabsTrigger value="manage" className="text-xs sm:text-sm whitespace-nowrap">Manage Officials</TabsTrigger>
              <TabsTrigger value="events" className="text-xs sm:text-sm whitespace-nowrap">Add Event</TabsTrigger>
              <TabsTrigger value="manageEvents" className="text-xs sm:text-sm whitespace-nowrap">Manage Events</TabsTrigger>
              <TabsTrigger value="reviews" className="text-xs sm:text-sm whitespace-nowrap">Manage Reviews</TabsTrigger>
              <TabsTrigger value="coaches" className="text-xs sm:text-sm whitespace-nowrap">Manage Coaches</TabsTrigger>
              <TabsTrigger value="teams" className="text-xs sm:text-sm whitespace-nowrap">Manage Teams</TabsTrigger>
              <TabsTrigger value="pending" className="text-xs sm:text-sm whitespace-nowrap">Pending Users</TabsTrigger>
              <TabsTrigger value="system" className="text-xs sm:text-sm whitespace-nowrap">System</TabsTrigger>
              <TabsTrigger value="settings" className="text-xs sm:text-sm whitespace-nowrap">Settings</TabsTrigger>
            </TabsList>
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
                              onClick={() => setLocation(`/admin/officials/${official.id}/edit`)}
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
            <TabsContent value="coaches">
              <ManageCoaches />
            </TabsContent>
            <TabsContent value="teams">
              <ManageTeams />
            </TabsContent>
            <TabsContent value="pending">
              <PendingUsers />
            </TabsContent>
            <TabsContent value="system">
              <SystemMaintenancePanel />
            </TabsContent>
            <TabsContent value="settings">
              <AdminSettings />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}