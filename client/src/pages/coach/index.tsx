import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Event, User, Official } from "@shared/schema";
import { ProfileEdit } from "./profile-edit";
import CoachSettings from "./settings";
import CoachTutorial from "./tutorial";
import { formatInEastern, formatTimeTo12Hour } from "@/lib/utils";
import EventList from "@/components/event-list";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock } from "lucide-react";
import { Link } from "wouter";

type CoachUser = User & {
  age?: number | null;
  teamMascot?: string | null;
};

type AssignedOfficial = Official & {
  role?: string | null;
};

// Component to display events for a coach
function CoachEvents({ schoolName }: { schoolName: string }) {
  const { data: coachEvents, isLoading, error } = useQuery<Event[]>({
    queryKey: ["/api/coach/events"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!schoolName, // Only fetch if the coach has a school set
  });

  if (isLoading) {
    return null;
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
          <Card key={event.id} className="overflow-hidden bg-black/80 backdrop-blur-md border-white/30 shadow-xl">
            <CardContent className="p-0">
              <div className="p-3 sm:p-4">
                <div className="flex flex-wrap items-start sm:items-center justify-between gap-2">
                  <h3 className="text-base sm:text-lg font-semibold text-white text-shadow-lg">{event.name}</h3>
                  <Badge className="text-xs bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 shadow-lg" variant={new Date(event.date) > new Date() ? "default" : "secondary"}>
                    {new Date(event.date) > new Date() ? "Upcoming" : "Completed"}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1 sm:space-y-2">
                  <div className="flex items-center text-xs sm:text-sm text-white font-medium text-shadow-md">
                    <Calendar className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span className="truncate">{formatInEastern(new Date(event.date), 'PPP')}</span>
                  </div>
                  <div className="flex items-center text-xs sm:text-sm text-white font-medium text-shadow-md">
                    <Clock className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span>{event.startTime ? formatTimeTo12Hour(event.startTime) : formatInEastern(new Date(event.date), 'p')}</span>
                  </div>
                  <div className="text-xs sm:text-sm mt-1 sm:mt-2 text-white font-medium text-shadow-md">
                    <span className="font-semibold">Venue:</span> {event.venue}
                  </div>
                  {event.eventType && (
                    <div className="text-xs sm:text-sm text-white font-medium text-shadow-md">
                      <span className="font-semibold">Type:</span> {event.eventType}
                    </div>
                  )}
                </div>
                <div className="mt-3 sm:mt-4">
                  <Link to={`/events/${event.id}`}>
                    <span className="text-xs sm:text-sm text-white font-medium hover:underline cursor-pointer text-shadow-md">
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
  const { data: user, isLoading } = useQuery<CoachUser>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/auth/me");
      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }
      return response.json();
    }
  });

  // Fetch officials data and sort them by last name
  const { data: officialsResponse, isLoading: isOfficialsLoading } = useQuery<{data: AssignedOfficial[], total: number}>({
    queryKey: ["/api/officials"],
  });
  const officialsData = officialsResponse?.data;
  const officials = officialsData ? [...officialsData].sort((a, b) => a.lastName.localeCompare(b.lastName)) : [];


  if (isLoading || isOfficialsLoading) {
    return null;
  }

  if (!user || user.userType !== "Coach") {
    return <div>Access denied. This page is only for coaches.</div>;
  }

  return (
    <div className="space-y-8">
      <Card className="overflow-visible min-h-screen bg-transparent border-transparent">
        <CardHeader className="sticky top-0 z-10 bg-transparent text-center">
          <div className="space-y-4 sm:space-y-6">
          <div className="flex justify-center items-center relative">
            <h1 className="text-lg sm:text-2xl md:text-3xl font-bold tracking-tight text-white drop-shadow-lg">Coaches Corner</h1>
            <div className="absolute right-0">

            </div>
          </div>
        </div>
          <CardDescription className="text-white text-sm sm:text-base font-medium">
            Manage your profile and events
          </CardDescription>
        </CardHeader>
        <CardContent className="touch-scroll-area styled-scrollbar">
          <Tabs defaultValue="tutorial" className="space-y-4">
            <TabsList className="flex flex-nowrap justify-start overflow-x-auto overflow-y-hidden pb-1 w-full">
              <TabsTrigger value="tutorial" data-tab="tutorial" className="text-xs whitespace-nowrap">Tutorial</TabsTrigger>
              <TabsTrigger value="profile" data-tab="profile" className="text-xs whitespace-nowrap">My Profile</TabsTrigger>
              <TabsTrigger value="manage-profile" data-tab="manage-profile" className="text-xs whitespace-nowrap">Manage Profile</TabsTrigger>
              <TabsTrigger value="events" data-tab="events" className="text-xs whitespace-nowrap">My Events</TabsTrigger>
              <TabsTrigger value="officials" data-tab="officials" className="text-xs whitespace-nowrap">Officials</TabsTrigger>
            </TabsList>

            <TabsContent value="tutorial">
              <div className="space-y-2 sm:space-y-4">
                <h3 className="text-base sm:text-lg font-medium">Tutorial</h3>
                <CoachTutorial />
              </div>
            </TabsContent>

            <TabsContent value="profile">
              <div className="space-y-4 sm:space-y-6">
                <h3 className="text-base sm:text-lg font-medium">My Profile</h3>
                <div className="flex justify-center">
                  <Card className="bg-black/80 backdrop-blur-md border-white/30 shadow-xl w-full max-w-sm">
                    <CardContent className="p-6">
                      <div className="flex flex-col items-center text-center space-y-4">
                        <Avatar className="w-20 h-20 border-2 border-white/30">
                          <AvatarImage
                            src={user.photoUrl || ''}
                            alt={`${user.firstName} ${user.lastName}`}
                          />
                          <AvatarFallback className="bg-black/80 backdrop-blur-md text-white text-lg font-semibold border border-white/20">
                            {user.firstName[0]}{user.lastName[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="space-y-2 w-full">
                          <h3 className="athletic-text text-xl text-white font-bold drop-shadow-lg">
                            {user.firstName} {user.lastName}
                          </h3>

                          <div className="space-y-1 text-base text-white font-medium text-shadow-md">
                            <div className="flex items-center justify-center gap-2">
                              <span className="font-semibold">Age:</span>
                              <span>{user.age || "Not specified"}</span>
                            </div>

                            <div className="flex items-center justify-center gap-2">
                              <span className="font-semibold">Years Coaching:</span>
                              <span>{user.yearsCoaching || 0} years</span>
                            </div>

                            <div className="flex items-center justify-center gap-2">
                              <span className="font-semibold">Email:</span>
                              <span className="text-sm truncate">{user.email}</span>
                            </div>

                            <div className="flex items-center justify-center gap-2">
                              <span className="font-semibold">School:</span>
                              <span>{user.school || "Not specified"}</span>
                            </div>

                            <div className="flex items-center justify-center gap-2">
                              <span className="font-semibold">Team Mascot:</span>
                              <span>{user.teamMascot || "Not specified"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
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

            <TabsContent value="officials">
              <div className="space-y-2 sm:space-y-4">
                <h3 className="text-base sm:text-lg font-medium">Officials</h3>
                {isOfficialsLoading ? (
                  <div>Loading officials...</div>
                ) : officials.length === 0 ? (
                  <div className="text-muted-foreground">No officials found.</div>
                ) : (
                  <Card className="bg-black/80 backdrop-blur-md border-white/30 shadow-xl">
                    <CardContent className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {officials.map((official) => {
                          const slug = `${official.firstName}${official.lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
                          return (
                            <Link key={official.id} href={`/officials/${slug}`}>
                              <div className="flex items-center space-x-4 cursor-pointer">
                                <Avatar className="h-12 w-12 border-2 border-white/30">
                                  <AvatarImage
                                    src={official.photoUrl || undefined}
                                    alt={`${official.firstName} ${official.lastName}`}
                                  />
                                  <AvatarFallback className="bg-black/80 backdrop-blur-md text-white font-semibold border border-white/20">
                                    {official.firstName[0]}{official.lastName[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="space-y-1">
                                  <h4 className="athletic-text text-lg font-bold text-white drop-shadow-lg hover:text-blue-300 transition-colors">
                                    {official.firstName} {official.lastName}
                                  </h4>
                                  <p className="text-sm text-white/80 font-medium text-shadow-md">{official.role}</p>
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}