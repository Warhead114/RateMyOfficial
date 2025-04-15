import { useQuery, useMutation } from "@tanstack/react-query";
import { Event, User, Official, Team } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Filter, Edit, Trash, Users, ListChecks } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import EventForm from "@/components/event-form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatInEastern, formatTimeTo12Hour } from "@/lib/utils";

export default function Events() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Check if user is authenticated and has permission
  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"]
  });

  const canManageEvents = user?.role === "admin" || user?.userType === "Regional Supervisor";

  // Fetch events
  const { data: events, isLoading, dataUpdatedAt } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    enabled: canManageEvents,
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch when component mounts
    staleTime: 0 // Consider data stale immediately
  });
  
  // State to store event officials and teams
  const [eventDataMap, setEventDataMap] = useState<{
    [eventId: number]: {
      officials: Official[];
      teams: Team[];
    }
  }>({});
  
  // State to track loading status of event details
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  
  // Fetch officials and teams for each event
  useEffect(() => {
    if (!events || events.length === 0) return;
    
    const fetchEventData = async () => {
      console.log('Fetching event details for', events.length, 'events');
      setIsLoadingDetails(true);
      const dataMap: typeof eventDataMap = {};
      
      try {
        // Use Promise.all to fetch all event details in parallel
        await Promise.all(events.map(async (event) => {
          try {
            console.log(`Fetching details for event ${event.id}: ${event.name}`);
            const [officialsRes, teamsRes] = await Promise.all([
              apiRequest("GET", `/api/events/${event.id}/officials`),
              apiRequest("GET", `/api/events/${event.id}/teams`)
            ]);
            
            const officials: Official[] = await officialsRes.json();
            const teams: Team[] = await teamsRes.json();
            
            console.log(`Event ${event.id} has ${officials.length} officials and ${teams.length} teams`);
            dataMap[event.id] = { officials, teams };
          } catch (error) {
            console.error(`Error fetching data for event ${event.id}:`, error);
            dataMap[event.id] = { officials: [], teams: [] };
          }
        }));
        
        setEventDataMap(dataMap);
      } catch (error) {
        console.error('Error fetching event details:', error);
      } finally {
        setIsLoadingDetails(false);
      }
    };
    
    fetchEventData();
  }, [events, dataUpdatedAt]); // Re-fetch when events or dataUpdatedAt changes

  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      await apiRequest("DELETE", `/api/events/${eventId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event has been deleted"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete event",
        variant: "destructive"
      });
    }
  });

  const handleDelete = (eventId: number) => {
    if (confirm("Are you sure you want to delete this event?")) {
      deleteMutation.mutate(eventId);
    }
  };

  if (!canManageEvents) {
    return (
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Access Denied</h1>
        <p className="text-xl text-muted-foreground">
          You don't have permission to manage events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Event Management</h1>
        <p className="text-xl text-muted-foreground">
          Create and manage wrestling events
        </p>
      </div>

      <Tabs defaultValue="manage" className="w-full">
        <TabsList className="flex w-full">
          <TabsTrigger value="manage" className="text-xs sm:text-lg flex-1 whitespace-nowrap">Manage Events</TabsTrigger>
          <TabsTrigger value="add" className="text-xs sm:text-lg flex-1 whitespace-nowrap">Add Event</TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Event List</CardTitle>
              <CardDescription>View and manage all wrestling events</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : isLoadingDetails ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin h-6 w-6 border-2 border-primary rounded-full border-t-transparent mr-2"></div>
                    <span>Loading event details...</span>
                  </div>
                </div>
              ) : !events?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  No events found
                </div>
              ) : (
                <div className="space-y-4">
                  {events.map((event) => (
                    <Card key={event.id}>
                      <CardContent className="pt-6">
                        <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
                          <div className="w-full">
                            <h3 className="font-medium text-lg">{event.name}</h3>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <p>Date: {formatInEastern(event.date, 'PPP')}</p>
                              <p>Time: {event.startTime ? formatTimeTo12Hour(event.startTime) : formatInEastern(event.date, 'p')}</p>
                              <p>Venue: {event.venue}</p>
                              <p>Type: {event.eventType}</p>
                              
                              {/* Officials */}
                              <div className="mt-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <Users className="h-4 w-4" />
                                  <span className="font-medium">Officials:</span>
                                </div>
                                {eventDataMap[event.id]?.officials?.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {eventDataMap[event.id].officials.map((official) => (
                                      <Badge key={official.id} variant="outline" className="flex items-center gap-1 text-xs sm:text-sm">
                                        {official.firstName} {official.lastName}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-muted-foreground text-xs">No officials assigned</p>
                                )}
                              </div>
                              
                              {/* Teams */}
                              <div className="mt-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <ListChecks className="h-4 w-4" />
                                  <span className="font-medium">Teams:</span>
                                </div>
                                {eventDataMap[event.id]?.teams?.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {eventDataMap[event.id].teams.map((team) => (
                                      <Badge key={team.id} variant="secondary" className="flex items-center gap-1 text-xs sm:text-sm">
                                        {team.name}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-muted-foreground text-xs">No teams assigned</p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-3 self-end sm:self-start sm:ml-4 shrink-0">
                            <Link href={`/events/${event.id}/edit`}>
                              <Button variant="outline" size="sm" className="px-3 h-9">
                                <Edit className="h-4 w-4 sm:mr-2" />
                                <span className="hidden sm:inline">Edit</span>
                              </Button>
                            </Link>
                            <Button
                              variant="outline"
                              size="sm"
                              className="px-3 h-9"
                              onClick={() => handleDelete(event.id)}
                            >
                              <Trash className="h-4 w-4 sm:mr-2" />
                              <span className="hidden sm:inline">Delete</span>
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="add">
          <Card>
            <CardHeader>
              <CardTitle>Create New Event</CardTitle>
              <CardDescription>Add a new wrestling event</CardDescription>
            </CardHeader>
            <CardContent>
              <EventForm onSuccess={() => {}} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}