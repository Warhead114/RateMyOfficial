import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

export default function PendingUsers() {
  const { toast } = useToast();

  const { data: pendingUsers, isLoading } = useQuery<User[]>({
    queryKey: ["/api/users/pending"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users/pending");
      return res.json();
    }
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ userId, approved }: { userId: number; approved: boolean }) => {
      await apiRequest(
        "POST", 
        `/api/users/${userId}/verify`,
        { approved }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      toast({
        title: "Success",
        description: "User verification status updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return <div>Loading pending coaches...</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Pending Coach Approval Requests</h3>
      <p className="text-sm text-muted-foreground mb-4">
        As a Regional Supervisor, you can approve or reject coach registration requests.
      </p>
      
      {pendingUsers?.length === 0 ? (
        <p className="text-muted-foreground">There are currently no pending coach approval requests.</p>
      ) : (
        pendingUsers?.map((user) => (
          <Card key={user.id}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-medium">
                    {user.firstName} {user.lastName}
                  </h3>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Email: {user.email}</p>
                    <p>Role: {user.userType}</p>
                    {user.school && <p>School: {user.school}</p>}
                    {user.region && <p>Region: {user.region}</p>}
                    {user.yearsCoaching !== null && <p>Years Coaching: {user.yearsCoaching}</p>}
                    <p>Registered: {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}</p>
                  </div>
                </div>
                <div className="space-x-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => approvalMutation.mutate({ userId: user.id, approved: true })}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => approvalMutation.mutate({ userId: user.id, approved: false })}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}