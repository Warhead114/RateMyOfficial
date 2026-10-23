import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import ReviewForm from "@/components/review-form";
import { Official } from "@shared/schema";

export default function OfficialReviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();

  // Check if user is authenticated
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/auth/me"]
  });

  const { data: official, isLoading } = useQuery<Official>({
    queryKey: [`/api/officials/slug/${slug}`],
    queryFn: async () => {
      const response = await fetch(`/api/officials/slug/${slug}`);
      if (!response.ok) {
        throw new Error("Failed to fetch official");
      }
      return response.json();
    }
  });

  // Define the evaluation background style
  const backgroundStyle = {
    backgroundImage: `url(/uploads/Stall-image.png)`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundAttachment: 'fixed'
  };

  // Redirect if not authenticated
  if (!user && !isLoadingUser) {
    setLocation("/login");
    return null;
  }

  if (isLoading || !official || isLoadingUser) {
    return (
      <div
        className="min-h-screen"
        style={backgroundStyle}
      >
        <div className="container mx-auto px-4 py-8">
          <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
            <CardHeader className="text-center">
              <CardTitle className="text-white">Loading...</CardTitle>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={backgroundStyle}
    >
      <div className="container mx-auto px-4 py-8 space-y-8">
        <ReviewForm officialId={official.id} />
      </div>
    </div>
  );
}