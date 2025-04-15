import { useQuery, useMutation } from "@tanstack/react-query";
import { Event, Official, Team } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Edit, Trash, Users, ListChecks } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { formatInEastern, formatTimeTo12Hour } from "@/lib/utils";

export default function EventList() {
  const { toast } = useToast();
  
  // Fetch events with refresh settings
  const { data: events, isLoading, dataUpdatedAt } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0
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
      console.log('EventList: Fetching event details for', events.length, 'events');
      setIsLoadingDetails(true);
      const dataMap: typeof eventDataMap = {};
      
      try {
        // Use Promise.all to fetch all event details in parallel
        await Promise.all(events.map(async (event) => {
          try {
            console.log(`EventList: Fetching details for event ${event.id}: ${event.name}`);
            const [officialsRes, teamsRes] = await Promise.all([
              apiRequest("GET", `/api/events/${event.id}/officials`),
              apiRequest("GET", `/api/events/${event.id}/teams`)
            ]);
            
            const officials: Official[] = await officialsRes.json();
            const teams: Team[] = await teamsRes.json();
            
            console.log(`EventList: Event ${event.id} has ${officials.length} officials and ${teams.length} teams`);
            dataMap[event.id] = { officials, teams };
          } catch (error) {
            console.error(`EventList: Error fetching data for event ${event.id}:`, error);
            dataMap[event.id] = { officials: [], teams: [] };
          }
        }));
        
        setEventDataMap(dataMap);
      } catch (error) {
        console.error('EventList: Error fetching event details:', error);
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }
  
  if (isLoadingDetails) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-primary rounded-full border-t-transparent mr-2"></div>
          <span>Loading event details...</span>
        </div>
      </div>
    );
  }

  if (!events?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No events found
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Events</CardTitle>
        <CardDescription>
          View, edit, and delete events in the system
        </CardDescription>
      </CardHeader>
      <CardContent className="touch-scroll-area styled-scrollbar max-h-[70vh]">
        <div className="space-y-4">
          {events.map((event) => (
            <Card key={event.id}>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="w-full">
                    <h3 className="font-medium text-lg mb-2">{event.name}</h3>
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
                              <Badge key={official.id} variant="outline" className="flex items-center gap-1 text-xs">
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
                              <Badge key={team.id} variant="secondary" className="flex items-center gap-1 text-xs">
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
                  <div className="flex gap-2 self-start mt-2 sm:mt-0 sm:ml-4">
                    <Link href={`/events/${event.id}/edit`}>
                      <Button variant="outline" size="sm" className="text-xs">
                        <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => handleDelete(event.id)}
                    >
                      <Trash className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
