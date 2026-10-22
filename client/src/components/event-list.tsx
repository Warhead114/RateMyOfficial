import { useQuery, useMutation } from "@tanstack/react-query";
import { Event, Official, Team } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Edit, Trash, Users, ListChecks, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { formatInEastern, formatTimeTo12Hour } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function EventList() {
  const { toast } = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<{ id: number; name: string } | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // State to store event officials and teams
  const [eventDataMap, setEventDataMap] = useState<{
    [eventId: number]: {
      officials: Official[];
      teams: Team[];
    }
  }>({});

  // Fetch events with proper error handling
  const { data: events = [], isLoading, error, refetch } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    queryFn: async () => {
      console.log('EventList: Fetching events from API');
      const response = await apiRequest("GET", "/api/events");
      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.status}`);
      }
      const data = await response.json();
      console.log('EventList: Received events data:', data);
      return Array.isArray(data) ? data : [];
    },
    retry: 3,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    staleTime: 0 // Always consider data stale to ensure fresh fetches after mutations
  });

  // Fetch officials and teams for each event
  useEffect(() => {
    if (!events || events.length === 0) {
      console.log('EventList: No events to fetch details for');
      setEventDataMap({});
      setIsLoadingDetails(false);
      return;
    }

    let isMounted = true;

    const fetchEventData = async () => {
      console.log('EventList: Fetching details for', events.length, 'events');
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
            console.log(`EventList: Fetching details for event ${event.id}: ${event.name}`);
            const [officialsRes, teamsRes] = await Promise.all([
              fetch(`/api/events/${event.id}/officials`, { credentials: 'include' }),
              fetch(`/api/events/${event.id}/teams`, { credentials: 'include' })
            ]);

            const officialsData = officialsRes.ok ? await officialsRes.json() : [];
            const officials = Array.isArray(officialsData) ? [...officialsData].sort((a: Official, b: Official) => a.lastName.localeCompare(b.lastName)) : [];
            const teamsData = teamsRes.ok ? await teamsRes.json() : [];
            const teams = Array.isArray(teamsData) ? [...teamsData].sort((a: Team, b: Team) => a.name.localeCompare(b.name)) : [];

            console.log(`EventList: Event ${event.id} has ${officials.length} officials and ${teams.length} teams`);
            return { eventId: event.id, officials, teams };
          } catch (error) {
            console.error(`EventList: Error fetching data for event ${event.id}:`, error);
            return { eventId: event.id, officials: [], teams: [] };
          }
        });

        const results = await Promise.all(fetchPromises);
        
        // Build the data map from results
        results.forEach(({ eventId, officials, teams }) => {
          dataMap[eventId] = { officials, teams };
        });

        console.log('EventList: Complete data map:', dataMap);
        if (isMounted) {
          setEventDataMap(dataMap);
          setIsLoadingDetails(false);
          console.log('EventList: All event details loaded');
        }
      } catch (error) {
        console.error('EventList: Error in fetchEventData:', error);
        if (isMounted) {
          setIsLoadingDetails(false);
        }
      }
    };

    fetchEventData();

    return () => {
      isMounted = false;
    };
  }, [events]);

  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      console.log('EventList: Deleting event:', eventId);
      const response = await apiRequest("DELETE", `/api/events/${eventId}`);
      if (!response.ok) {
        throw new Error('Failed to delete event');
      }
      return response.json();
    },
    onSuccess: async () => {
      console.log('EventList: Event deleted successfully, invalidating cache...');
      toast({
        title: "Success",
        description: "Event has been deleted"
      });

      // Clear event data map
      setEventDataMap({});

      // Remove queries completely
      queryClient.removeQueries({ queryKey: ["/api/events"] });

      // Invalidate all event-related queries
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey;
          return String(key).includes('/api/events');
        }
      });

      // Force refetch
      await queryClient.refetchQueries({
        queryKey: ["/api/events"],
        type: 'active',
        exact: true
      });

      console.log('EventList: Cache invalidation complete');
    },
    onError: (error) => {
      console.error('EventList: Delete error:', error);
      toast({
        title: "Error",
        description: "Failed to delete event",
        variant: "destructive"
      });
    }
  });

  const handleDelete = (eventId: number, eventName: string) => {
    setEventToDelete({ id: eventId, name: eventName });
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (eventToDelete) {
      deleteMutation.mutate(eventToDelete.id);
      setDeleteConfirmOpen(false);
      setEventToDelete(null);
    }
  };

  if (isLoading || isLoadingDetails) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manage Events</CardTitle>
          <CardDescription>Loading events...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">{isLoadingDetails ? 'Loading event details...' : 'Loading events...'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manage Events</CardTitle>
          <CardDescription>Error loading events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center p-8">
            <p className="text-destructive mb-4">Failed to load events: {error.message}</p>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-transparent border-white/20">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-white">Manage Events</CardTitle>
          <CardDescription className="text-white/70">
            View, edit, and delete events in the system
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
          onClick={() => {
            console.log('EventList: Manual refresh triggered');
            queryClient.invalidateQueries({ queryKey: ["/api/events"] });
            refetch();
          }}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {!events || events.length === 0 ? (
          <div className="text-center py-8">
            <ListChecks className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No events found</h3>
            <p className="text-muted-foreground mb-4">
              Events you create will appear here for management.
            </p>
            <Link href="/admin">
              <Button variant="outline">
                Go to Add Event
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {events.length} event{events.length !== 1 ? 's' : ''}
            </p>

            {events.map((event) => {
              const eventData = eventDataMap[event.id] || { officials: [], teams: [] };

              return (
                <Card key={event.id} className="border-l-4 border-l-primary bg-transparent">
                  <CardContent className="pt-6 bg-transparent">
                    <div className="flex flex-col sm:flex-row justify-between gap-4">
                      <div className="flex-1 space-y-3">
                        <div>
                          <h3 className="text-lg font-semibold text-white">{event.name}</h3>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Badge variant="outline">
                              {formatInEastern(event.date, 'PPP')}
                            </Badge>
                            {event.startTime && (
                              <Badge variant="outline">
                                {formatTimeTo12Hour(event.startTime)}
                              </Badge>
                            )}
                            {event.eventType && (
                              <Badge variant="secondary">
                                {event.eventType}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Venue:</span>
                            <span>{event.venue}</span>
                          </div>
                          {event.description && (
                            <div className="flex items-start gap-2">
                              <span className="font-medium">Description:</span>
                              <span className="flex-1">{event.description}</span>
                            </div>
                          )}
                        </div>

                        {/* Officials List */}
                        <div className="mt-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Users className="h-4 w-4 text-white" />
                            <span className="font-medium text-white">Officials ({eventData.officials.length}):</span>
                          </div>
                          {eventData.officials.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {eventData.officials.map((official) => (
                                <Badge key={official.id} variant="outline" className="bg-blue-600/30 border-blue-500/50 text-white">
                                  {official.firstName} {official.lastName}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-white/70 text-sm">No officials assigned</p>
                          )}
                        </div>

                        {/* Teams List */}
                        <div className="mt-3">
                          <div className="flex items-center gap-2 mb-2">
                            <ListChecks className="h-4 w-4 text-white" />
                            <span className="font-medium text-white">Teams ({eventData.teams.length}):</span>
                          </div>
                          {eventData.teams.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {eventData.teams.map((team) => (
                                <Badge key={team.id} variant="outline" className="bg-green-600/30 border-green-500/50 text-white">
                                  {team.name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-white/70 text-sm">No teams assigned</p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 self-start">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-black/80 backdrop-blur-md border-white/30 text-white hover:bg-black/90 hover:text-white shadow-lg"
                          onClick={() => {
                            window.location.href = `/events/${event.id}/edit`;
                          }}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="bg-red-600/80 backdrop-blur-md border-red-500/50 text-white hover:bg-red-700/90 hover:text-white shadow-lg"
                          onClick={() => handleDelete(event.id, event.name)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{eventToDelete?.name}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
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
      </CardContent>
    </Card>
  );
}