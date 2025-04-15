import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import ReviewForm from "@/components/review-form";
import { Official } from "@shared/schema";

export default function OfficialReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  // Check if user is authenticated
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/auth/me"]
  });

  const { data: official, isLoading } = useQuery<Official>({
    queryKey: [`/api/officials/${id}`]
  });

  // Redirect if not authenticated
  if (!user && !isLoadingUser) {
    setLocation("/login");
    return null;
  }

  if (isLoading || !official || isLoadingUser) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Evaluate {official.firstName} {official.lastName}</CardTitle>
          <CardDescription>
            Please provide your evaluation for this official's performance
          </CardDescription>
        </CardHeader>
      </Card>
      <ReviewForm officialId={parseInt(id)} />
    </div>
  );
}