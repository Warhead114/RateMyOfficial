import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Event, Official, Team } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { formatInEastern, formatTimeTo12Hour } from "@/lib/utils";
import { Calendar, Clock, MapPin, Type, Users, ListChecks } from "lucide-react";

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const eventId = parseInt(id as string);

  // Fetch the event data
  const { data: event, isLoading: isEventLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/events/${eventId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch event");
      }
      return response.json();
    },
    enabled: !isNaN(eventId)
  });

  // Fetch event officials
  const { data: officials, isLoading: isOfficialsLoading } = useQuery<Official[]>({
    queryKey: [`/api/events/${eventId}/officials`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/events/${eventId}/officials`);
      if (!response.ok) {
        throw new Error("Failed to fetch event officials");
      }
      return response.json();
    },
    enabled: !isNaN(eventId)
  });

  // Fetch event teams
  const { data: teams, isLoading: isTeamsLoading } = useQuery<Team[]>({
    queryKey: [`/api/events/${eventId}/teams`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/events/${eventId}/teams`);
      if (!response.ok) {
        throw new Error("Failed to fetch event teams");
      }
      return response.json();
    },
    enabled: !isNaN(eventId)
  });

  const isLoading = isEventLoading || isOfficialsLoading || isTeamsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin h-8 w-8 border-4 border-primary rounded-full border-t-transparent"></div>
        <span className="ml-3">Loading event details...</span>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-red-500">Event Not Found</h2>
        <p className="mt-4 text-muted-foreground">The event you're looking for doesn't exist or has been removed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">{event.name}</h1>
        <p className="text-xl text-muted-foreground">
          Event Details
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Event Information</CardTitle>
            <CardDescription>General details about the event</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-medium">Date</div>
                <div>{formatInEastern(event.date, 'PPP')}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-medium">Start Time</div>
                <div>{event.startTime ? formatTimeTo12Hour(event.startTime) : formatInEastern(event.date, 'p')}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-medium">Venue</div>
                <div>{event.venue}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Type className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-medium">Event Type</div>
                <div>{event.eventType}</div>
              </div>
            </div>

            {event.description && (
              <div className="pt-2">
                <div className="font-medium mb-1">Description</div>
                <div className="text-sm text-muted-foreground">{event.description}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="mr-2 h-5 w-5" />
                Officials
              </CardTitle>
              <CardDescription>Officials assigned to this event</CardDescription>
            </CardHeader>
            <CardContent>
              {officials && officials.length > 0 ? (
                <div className="space-y-3">
                  {officials.map((official) => (
                    <div key={official.id} className="flex items-center justify-between border-b pb-2">
                      <div>
                        <div className="font-medium">{official.firstName} {official.lastName}</div>
                        <div className="text-sm text-muted-foreground">
                          {official.association} • {official.yearsExperience} years experience
                        </div>
                      </div>
                      <Badge variant="outline">{official.location}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-center py-4">
                  No officials assigned to this event
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <ListChecks className="mr-2 h-5 w-5" />
                Teams
              </CardTitle>
              <CardDescription>Teams participating in this event</CardDescription>
            </CardHeader>
            <CardContent>
              {teams && teams.length > 0 ? (
                <div className="space-y-3">
                  {teams.map((team) => (
                    <div key={team.id} className="flex items-center justify-between border-b pb-2">
                      <div className="font-medium">{team.name}</div>
                      <Badge>Team</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-center py-4">
                  No teams assigned to this event
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}