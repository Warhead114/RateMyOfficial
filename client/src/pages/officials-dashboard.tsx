import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { User } from "@shared/schema";
import { Loading } from "@/components/ui/loading";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export default function OfficialsDashboard() {
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/auth/me");
      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }
      return response.json();
    }
  });

  const deleteOfficialMutation = useMutation({
    mutationFn: async (officialId: number) => {
      const response = await apiRequest("DELETE", `/api/officials/${officialId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to delete official" }));
        throw new Error(error.message || "Failed to delete official");
      }
      return response.json();
    },
    onSuccess: async () => {
      toast({
        title: "Official deleted",
        description: "The official has been successfully deleted",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/officials"] });
      await queryClient.refetchQueries({ queryKey: ["/api/officials"] });
    },
    onError: (error: any) => {
      console.error("Delete official error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete official",
        variant: "destructive",
      });
    },
  });


  if (isLoading) {
    return <Loading text="Loading dashboard..." />;
  }

  if (!user) {
    return <div>Please log in to access the officials dashboard.</div>;
  }

  return (
    <div className="space-y-8">
      <Card className="overflow-visible min-h-screen">
        <CardHeader className="sticky top-0 z-10 bg-card">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Officials Dashboard</CardTitle>
              <CardDescription>
                View your profile
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="touch-scroll-area styled-scrollbar">
          <Tabs defaultValue="profile" className="space-y-4">
            <TabsList className="flex flex-nowrap justify-start overflow-x-auto overflow-y-hidden pb-1 w-full">
              <TabsTrigger value="profile" className="text-xs sm:text-sm whitespace-nowrap">My Profile</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">My Profile</h3>
                <div className="flex flex-col items-center space-y-6">
                  {user.photoUrl ? (
                    <div className="w-40 h-40 rounded-full overflow-hidden">
                      <img
                        src={user.photoUrl}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-40 h-40 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-4xl text-muted-foreground">
                        {user.firstName[0]}{user.lastName[0]}
                      </span>
                    </div>
                  )}
                  <div className="w-full max-w-md space-y-4">
                    <div className="grid grid-cols-1 gap-y-2">
                      <div>
                        <p className="text-sm text-muted-foreground">Name</p>
                        <p className="text-lg font-medium">{user.firstName} {user.lastName}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="text-lg">{user.email}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Role</p>
                        <p className="text-lg">{user.userType}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}