import { useQuery, useMutation } from "@tanstack/react-query";
import { Event, User, Official, Team } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loading } from "@/components/ui/loading";

export default function Events() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<number | null>(null);

  // Check if user is authenticated and has permission
  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"]
  });

  const canManageEvents = user?.role === "admin" || user?.userType === "Regional Supervisor";

  // Fetch events
  const { data: events, isLoading, dataUpdatedAt, refetch: refetchEvents } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    enabled: canManageEvents,
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch when component mounts
    staleTime: 0, // Always consider data stale to ensure fresh fetches
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
    if (!events || events.length === 0) {
      setEventDataMap({});
      setIsLoadingDetails(false);
      return;
    }

    let isMounted = true;

    const fetchEventData = async () => {
      console.log('Fetching event details for', events.length, 'events');
      setIsLoadingDetails(true);
      const dataMap: {
        [eventId: number]: {
          officials: Official[];
          teams: Team[];
        }
      } = {};

      try {
        // Fetch all event details in parallel
        const fetchPromises = events.map(async (event) => {
          try {
            console.log(`Fetching details for event ${event.id}: ${event.name}`);
            const [officialsRes, teamsRes] = await Promise.all([
              fetch(`/api/events/${event.id}/officials`, { credentials: 'include' }),
              fetch(`/api/events/${event.id}/teams`, { credentials: 'include' })
            ]);

            const officialsData = officialsRes.ok ? await officialsRes.json() : [];
            const officials = Array.isArray(officialsData) ? [...officialsData].sort((a: Official, b: Official) => a.lastName.localeCompare(b.lastName)) : [];
            const teamsData = teamsRes.ok ? await teamsRes.json() : [];
            const teams = Array.isArray(teamsData) ? [...teamsData].sort((a: Team, b: Team) => a.name.localeCompare(b.name)) : [];

            console.log(`Event ${event.id} has ${officials.length} officials and ${teams.length} teams`);
            return { eventId: event.id, officials, teams };
          } catch (error) {
            console.error(`Error fetching data for event ${event.id}:`, error);
            return { eventId: event.id, officials: [], teams: [] };
          }
        });

        const results = await Promise.all(fetchPromises);
        
        // Build the data map from results
        results.forEach(({ eventId, officials, teams }) => {
          dataMap[eventId] = { officials, teams };
        });

        console.log('Complete event data map:', dataMap);
        if (isMounted) {
          setEventDataMap(dataMap);
          setIsLoadingDetails(false);
        }
      } catch (error) {
        console.error('Error fetching event details:', error);
        if (isMounted) {
          setIsLoadingDetails(false);
        }
      }
    };

    fetchEventData();

    return () => {
      isMounted = false;
    };
  }, [events, dataUpdatedAt]); // Re-fetch when events or data timestamp changes

  // Delete event mutation
  const deleteEventMutation = useMutation({
    mutationFn: async (eventId: number) => {
      console.log('Deleting event:', eventId);
      const response = await apiRequest("DELETE", `/api/events/${eventId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to delete event" }));
        throw new Error(error.message || "Failed to delete event");
      }
      return response.json();
    },
    onSuccess: async () => {
      console.log('Event deleted successfully, invalidating cache...');
      toast({
        title: "Event deleted",
        description: "The event has been successfully deleted",
      });
      
      // Clear the event data map immediately
      setEventDataMap({});
      
      // Force complete cache removal and refetch
      queryClient.removeQueries({ queryKey: ["/api/events"] });
      
      // Invalidate all event-related queries
      await queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey;
          return String(key).includes('/api/events');
        }
      });
      
      // Force immediate refetch
      await queryClient.refetchQueries({ 
        queryKey: ["/api/events"], 
        type: 'active',
        exact: true
      });
      
      console.log('Cache invalidation complete');
    },
    onError: (error: any) => {
      console.error("Delete event error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete event",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (eventId: number) => {
    setEventToDelete(eventId);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (eventToDelete) {
      deleteEventMutation.mutate(eventToDelete);
      setDeleteConfirmOpen(false);
      setEventToDelete(null);
    }
  };

  if (!canManageEvents) {
    return (
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-white drop-shadow-lg">Access Denied</h1>
        <p className="text-xl text-white/90 drop-shadow-md">
          You don't have permission to manage events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-white drop-shadow-lg">Event Management</h1>
        <p className="text-xl text-white/90 drop-shadow-md">
          Create and manage wrestling events
        </p>
      </div>

      <Tabs defaultValue="manage" className="w-full">
        <TabsList className="flex w-full">
          <TabsTrigger value="manage" className="text-xs sm:text-lg flex-1 whitespace-nowrap">Manage Events</TabsTrigger>
          <TabsTrigger value="add" className="text-xs sm:text-lg flex-1 whitespace-nowrap">Add Event</TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-4">
          <Card className="bg-black/30 backdrop-blur-sm border-white/20">
            <CardHeader>
              <CardTitle className="text-white drop-shadow-lg">Event List</CardTitle>
              <CardDescription className="text-white/80 drop-shadow-md">View and manage all wrestling events</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : isLoadingDetails ? (
                <div className="flex items-center justify-center py-8">
                  <Loading />
                </div>
              ) : !events?.length ? (
                <div className="text-center py-8 text-white/80 drop-shadow-md">
                  No events found
                </div>
              ) : (
                <div className="space-y-4">
                  {events.map((event) => (
                    <Card key={event.id} className="bg-black/20 backdrop-blur-sm border-white/20">
                      <CardContent className="pt-6">
                        <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
                          <div className="w-full">
                            <h3 className="font-medium text-lg text-white drop-shadow-lg">{event.name}</h3>
                            <div className="text-sm text-white/80 drop-shadow-md space-y-1">
                              <p>Date: {formatInEastern(event.date, 'PPP')}</p>
                              <p>Time: {event.startTime ? formatTimeTo12Hour(event.startTime) : formatInEastern(event.date, 'p')}</p>
                              <p>Venue: {event.venue}</p>
                              <p>Type: {event.eventType}</p>

                              {/* Teams */}
                              <div className="mt-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <ListChecks className="h-4 w-4 text-white drop-shadow-lg" />
                                  <span className="font-medium text-white drop-shadow-lg">Teams ({eventDataMap[event.id]?.teams?.length || 0}):</span>
                                </div>
                                {eventDataMap[event.id]?.teams && eventDataMap[event.id].teams.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {eventDataMap[event.id].teams.map((team) => (
                                      <Badge key={team.id} variant="secondary" className="flex items-center gap-1 text-xs sm:text-sm bg-white/30 text-white border-white/50 drop-shadow-lg">
                                        {team.name}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-white/90 text-xs drop-shadow-lg">No teams assigned</p>
                                )}
                              </div>

                              {/* Officials */}
                              <div className="mt-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <Users className="h-4 w-4 text-white drop-shadow-lg" />
                                  <span className="font-medium text-white drop-shadow-lg">Officials ({eventDataMap[event.id]?.officials?.length || 0}):</span>
                                </div>
                                {eventDataMap[event.id]?.officials && eventDataMap[event.id].officials.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {eventDataMap[event.id].officials.map((official) => (
                                      <Badge key={official.id} variant="outline" className="flex items-center gap-1 text-xs sm:text-sm bg-white/30 text-white border-white/50 drop-shadow-lg">
                                        {official.firstName} {official.lastName}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-white/90 text-xs drop-shadow-lg">No officials assigned</p>
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
          <Card className="bg-black/30 backdrop-blur-sm border-white/20">
            <CardHeader>
              <CardTitle className="text-white drop-shadow-lg">Create New Event</CardTitle>
              <CardDescription className="text-white/80 drop-shadow-md">Add a new wrestling event</CardDescription>
            </CardHeader>
            <CardContent>
              <EventForm onSuccess={() => {}} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this event? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteEventMutation.isPending}
            >
              {deleteEventMutation.isPending ? (
                <div className="flex items-center justify-center">
                  <div className="relative mr-2">
                    <div className="w-4 h-4 bg-white rounded-full animate-pulse"></div>
                    <img 
                      src="/uploads/wrestlers-silhouette.png" 
                      alt="" 
                      className="absolute inset-0 w-3 h-3 m-auto object-contain animate-pulse"
                    />
                  </div>
                  Deleting...
                </div>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}