import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Event, User } from "@shared/schema";
import { ProfileEdit } from "./profile-edit";
import CoachSettings from "./settings";
import { formatInEastern, formatTimeTo12Hour } from "@/lib/utils";
import EventList from "@/components/event-list";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock } from "lucide-react";
import { Link } from "wouter";

// Component to display events for a coach
function CoachEvents({ schoolName }: { schoolName: string }) {
  const { data: coachEvents, isLoading, error } = useQuery<Event[]>({
    queryKey: ["/api/coach/events"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!schoolName, // Only fetch if the coach has a school set
  });

  if (isLoading) {
    return <div>Loading events...</div>;
  }

  if (error) {
    console.error("Error fetching coach events:", error);
    return (
      <div className="p-4 text-red-500">
        Error loading events. Please try again later.
      </div>
    );
  }

  if (!schoolName) {
    return (
      <div className="p-4 border border-amber-200 bg-amber-50 rounded-md">
        <p className="text-amber-800">
          Please set your school in your profile to see associated events.
        </p>
      </div>
    );
  }

  if (!coachEvents || coachEvents.length === 0) {
    return (
      <div className="text-muted-foreground">
        No events found for your school/team. Events that include your team will appear here.
      </div>
    );
  }

  // Sort events by date (most recent first)
  const sortedEvents = [...coachEvents].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
        {sortedEvents.map((event) => (
          <Card key={event.id} className="overflow-hidden">
            <CardContent className="p-0">
              <div className="p-3 sm:p-4">
                <div className="flex flex-wrap items-start sm:items-center justify-between gap-2">
                  <h3 className="text-base sm:text-lg font-semibold">{event.name}</h3>
                  <Badge className="text-xs" variant={new Date(event.date) > new Date() ? "default" : "secondary"}>
                    {new Date(event.date) > new Date() ? "Upcoming" : "Completed"}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1 sm:space-y-2">
                  <div className="flex items-center text-xs sm:text-sm">
                    <Calendar className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span className="truncate">{formatInEastern(new Date(event.date), 'PPP')}</span>
                  </div>
                  <div className="flex items-center text-xs sm:text-sm">
                    <Clock className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span>{event.startTime ? formatTimeTo12Hour(event.startTime) : formatInEastern(new Date(event.date), 'p')}</span>
                  </div>
                  <div className="text-xs sm:text-sm mt-1 sm:mt-2">
                    <span className="font-medium">Venue:</span> {event.venue}
                  </div>
                  {event.eventType && (
                    <div className="text-xs sm:text-sm">
                      <span className="font-medium">Type:</span> {event.eventType}
                    </div>
                  )}
                </div>
                <div className="mt-3 sm:mt-4">
                  <Link to={`/events/${event.id}`}>
                    <span className="text-xs sm:text-sm text-primary hover:underline cursor-pointer">
                      View Event Details
                    </span>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function CoachDashboard() {
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

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user || user.userType !== "Coach") {
    return <div>Access denied. This page is only for coaches.</div>;
  }

  return (
    <div className="space-y-8">
      <Card className="overflow-visible min-h-screen">
        <CardHeader className="sticky top-0 z-10 bg-card">
          <CardTitle>Coaches Corner</CardTitle>
          <CardDescription>
            Manage your profile and events
          </CardDescription>
        </CardHeader>
        <CardContent className="touch-scroll-area styled-scrollbar">
          <Tabs defaultValue="profile" className="space-y-4">
            <TabsList className="flex flex-nowrap justify-start overflow-x-auto overflow-y-hidden pb-1 w-full">
              <TabsTrigger value="profile" data-tab="profile" className="text-xs sm:text-sm whitespace-nowrap">My Profile</TabsTrigger>
              <TabsTrigger value="manage-profile" data-tab="manage-profile" className="text-xs sm:text-sm whitespace-nowrap">Manage Profile</TabsTrigger>
              <TabsTrigger value="events" data-tab="events" className="text-xs sm:text-sm whitespace-nowrap">My Events</TabsTrigger>
              <TabsTrigger value="settings" data-tab="settings" className="text-xs sm:text-sm whitespace-nowrap">Settings</TabsTrigger>
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
                        <p className="text-xs sm:text-sm text-muted-foreground">School</p>
                        <p className="text-sm sm:text-lg">{user.school || 'Not specified'}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-muted-foreground">Years Coaching</p>
                        <p className="text-sm sm:text-lg">{user.yearsCoaching !== null ? user.yearsCoaching : 'Not specified'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="manage-profile">
              <div className="space-y-2 sm:space-y-4">
                <h3 className="text-base sm:text-lg font-medium">Manage Profile</h3>
                <ProfileEdit user={user} />
              </div>
            </TabsContent>

            <TabsContent value="events">
              <div className="space-y-2 sm:space-y-4">
                <h3 className="text-base sm:text-lg font-medium">My Events</h3>
                <CoachEvents schoolName={user.school || ""} />
              </div>
            </TabsContent>
            <TabsContent value="settings">
              <div className="space-y-2 sm:space-y-4">
                <h3 className="text-base sm:text-lg font-medium">Settings</h3>
                <CoachSettings />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}