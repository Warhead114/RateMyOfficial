import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertEventSchema, type InsertEvent, type Official, type Team, type Event } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatInEastern, formatDateForStorage } from "@/lib/utils";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

const EVENT_TYPES = [
  "Dual Match",
  "Tri Match",
  "Quad Match",
  "Dual Tournament",
  "Individual Tournament"
];

export default function EventEdit() {
  const { id } = useParams<{ id: string }>();
  const eventId = parseInt(id as string);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedOfficials, setSelectedOfficials] = useState<Array<{ officialId: number, role?: string }>>([]);
  const [selectedTeams, setSelectedTeams] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch the event data
  const { data: event, isLoading: isEventLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/events/${eventId}`);
      return response.json();
    },
    enabled: !isNaN(eventId)
  });

  const { data: officialsResponse } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
  });
  const officials = officialsResponse?.data;

  const { data: teams } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  // Fetch event officials
  const { data: eventOfficials, isLoading: isEventOfficialsLoading } = useQuery<Official[]>({
    queryKey: [`/api/events/${eventId}/officials`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/events/${eventId}/officials`);
      return response.json();
    },
    enabled: !isNaN(eventId)
  });

  // Fetch event teams
  const { data: eventTeams, isLoading: isEventTeamsLoading } = useQuery<Team[]>({
    queryKey: [`/api/events/${eventId}/teams`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/events/${eventId}/teams`);
      return response.json();
    },
    enabled: !isNaN(eventId)
  });

  const form = useForm<InsertEvent>({
    resolver: zodResolver(insertEventSchema),
    defaultValues: {
      name: "",
      date: "",
      startTime: "",
      venue: "",
      eventType: "",
      host: "",
      officials: [],
      teams: []
    },
  });

  // Update form with event data when it's loaded
  useEffect(() => {
    if (event) {
      // Format date for the date input (YYYY-MM-DD) in Eastern Time
      const date = new Date(event.date).toISOString().split('T')[0];
      form.reset({
        name: event.name,
        date: date,
        startTime: event.startTime || "",
        venue: event.venue,
        eventType: event.eventType,
        host: event.host,
        officials: [],
        teams: []
      });
    }
  }, [event, form]);

  // Update selected officials when eventOfficials are loaded
  useEffect(() => {
    if (eventOfficials) {
      setSelectedOfficials(eventOfficials.map(official => ({ officialId: official.id })));
    }
  }, [eventOfficials]);

  // Update selected teams when eventTeams are loaded
  useEffect(() => {
    if (eventTeams) {
      setSelectedTeams(eventTeams.map(team => team.id));
    }
  }, [eventTeams]);

  // Check if all data is loaded
  useEffect(() => {
    if (!isEventLoading && !isEventOfficialsLoading && !isEventTeamsLoading) {
      setIsLoading(false);
    }
  }, [isEventLoading, isEventOfficialsLoading, isEventTeamsLoading]);

  const mutation = useMutation({
    mutationFn: async (data: InsertEvent) => {
      // Ensure date is properly formatted with timezone handling
      let formattedData = {
        ...data,
        officials: selectedOfficials,
        teams: selectedTeams
      };

      // If the date is a string (from the date input), use the formatDateForStorage utility
      // to ensure it's properly formatted for Eastern Time Zone
      if (typeof formattedData.date === 'string') {
        formattedData.date = formatDateForStorage(formattedData.date);
      }

      console.log('Submitting event update for event ID:', eventId, 'with data:', formattedData);

      const result = await apiRequest("PATCH", `/api/events/${eventId}`, formattedData);

      console.log('Event update API response:', result);
      return result;
    },
    onSuccess: (data) => {
      console.log('Event update mutation successful with data:', data);

      // Invalidate all affected queries
      console.log('Invalidating queries for event update');

      // Use more aggressive query invalidation to ensure all data is refreshed
      queryClient.invalidateQueries({
        predicate: (query) => {
          // Invalidate any query related to events or the specific event
          const queryKey = Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey;
          const stringKey = String(queryKey);
          const shouldInvalidate = stringKey.includes('/api/events');

          if (shouldInvalidate) {
            console.log('Invalidating query with key:', queryKey);
          }

          return shouldInvalidate;
        },
      });

      toast({
        title: "Success!",
        description: "Event has been updated successfully!",
        duration: 3000,
      });

      // Wait slightly longer to ensure cache invalidation happens before navigation
      setTimeout(() => {
        console.log('Navigating back to events page');
        setLocation("/events");
      }, 1500);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update event. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !event) {
    return (
      <div className="flex items-center justify-center w-full h-64">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="ml-2">Loading event data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Edit Event</h1>
        <p className="text-xl text-muted-foreground">
          Update the event details
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit Event</CardTitle>
          <CardDescription>Update event information</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input 
                        type="date" 
                        {...field}
                        value={typeof field.value === 'string' ? field.value : field.value ? new Date(field.value).toISOString().split('T')[0] : ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <Input 
                        type="time" 
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="venue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Venue</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="eventType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select event type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-[300px]">
                        {EVENT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <FormLabel>Teams</FormLabel>
                <div className="flex gap-2">
                  <Select
                    onValueChange={(value) => {
                      const teamId = parseInt(value);
                      if (isNaN(teamId)) return;
                      if (selectedTeams.includes(teamId)) return;
                      setSelectedTeams(prev => [...prev, teamId]);
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a team" />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="h-[200px]">
                        {teams?.map((team) => (
                          <SelectItem
                            key={team.id}
                            value={team.id.toString()}
                            disabled={selectedTeams.includes(team.id)}
                          >
                            {team.name}
                          </SelectItem>
                        ))}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                </div>

                {selectedTeams.length > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <h3 className="font-medium">Selected Teams:</h3>
                        {selectedTeams.map((teamId) => {
                          const team = teams?.find(t => t.id === teamId);
                          return (
                            <div key={teamId} className="flex justify-between items-center">
                              <span>{team?.name}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedTeams(prev => prev.filter(id => id !== teamId))}
                              >
                                Remove
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Keep a hidden host field for backward compatibility */}
                <FormField
                  control={form.control}
                  name="host"
                  render={({ field }) => (
                    <input 
                      type="hidden"
                      {...field}
                      value={selectedTeams.length > 0 ? 
                        teams?.filter(t => selectedTeams.includes(t.id)).map(t => t.name).join(", ") : 
                        "No host"
                      }
                    />
                  )}
                />
              </div>

              <div className="space-y-4">
                <FormLabel>Assign Officials</FormLabel>
                <Select
                  onValueChange={(value) => {
                    const official = officials?.find(o => o.id === parseInt(value));
                    if (!official) return;
                    setSelectedOfficials(prev => [...prev, { officialId: official.id }]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an official" />
                  </SelectTrigger>
                  <SelectContent>
                    <ScrollArea className="h-[200px]">
                      {officials?.map((official) => (
                        <SelectItem
                          key={official.id}
                          value={official.id.toString()}
                          disabled={selectedOfficials.some(o => o.officialId === official.id)}
                        >
                          {official.firstName} {official.lastName}
                        </SelectItem>
                      ))}
                    </ScrollArea>
                  </SelectContent>
                </Select>

                {selectedOfficials.length > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <h3 className="font-medium">Assigned Officials:</h3>
                        {selectedOfficials.map((selectedOfficial) => {
                          const official = officials?.find(o => o.id === selectedOfficial.officialId);
                          return (
                            <div key={selectedOfficial.officialId} className="flex justify-between items-center">
                              <span>{official?.firstName} {official?.lastName}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedOfficials(prev => prev.filter(o => o.officialId !== selectedOfficial.officialId))}
                              >
                                Remove
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="flex space-x-4">
                <Button
                  type="submit"
                  disabled={selectedOfficials.length === 0 || mutation.isPending}
                  className="flex-1"
                >
                  {mutation.isPending ? "Updating..." : "Update Event"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation("/events")}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}