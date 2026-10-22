import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { InsertEvent, insertEventSchema, Official, InsertTeam, Team } from "@shared/schema";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDateForStorage } from "@/lib/utils";

const EVENT_TYPES = [
  "Dual Match",
  "Tri Match",
  "Quad Match",
  "Dual Tournament",
  "Individual Tournament"
];

export default function AddEventForm() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTeams, setSelectedTeams] = useState<number[]>([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [isAddTeamDialogOpen, setIsAddTeamDialogOpen] = useState(false);

  // Fetch officials for selection
  const { data: officialsResponse, isLoading: isLoadingOfficials } = useQuery<{data: Official[], total: number}>({
    queryKey: ["/api/officials"],
  });
  const officialsData = officialsResponse?.data;
  const officials = officialsData ? [...officialsData].sort((a, b) => a.lastName.localeCompare(b.lastName)) : [];

  // Fetch all teams
  const { data: teamsData, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/teams");
      return response.json();
    },
  });

  // Sort teams alphabetically by name
  const teams = teamsData ? [...teamsData].sort((a, b) => a.name.localeCompare(b.name)) : [];


  const form = useForm<InsertEvent>({
    resolver: zodResolver(insertEventSchema),
    defaultValues: {
      name: "",
      date: new Date().toISOString().split('T')[0], // Today's date as YYYY-MM-DD
      startTime: "",
      venue: "",
      description: "",
      eventType: "Dual Match", // Set a default event type instead of empty string
      host: "",
      officials: [],
      teams: []
    },
  });

  const createTeamMutation = useMutation({
    mutationFn: async (data: InsertTeam) => {
      const response = await apiRequest("POST", "/api/teams", data);
      return response.json();
    },
    onSuccess: async (newTeam: any) => {
      // Use multiple cache invalidation strategies to ensure the UI updates
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/teams"] }),
        queryClient.refetchQueries({ queryKey: ["/api/teams"] }),
        queryClient.removeQueries({ queryKey: ["/api/teams"] }),
      ]);

      // Wait a moment for the queries to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      if (newTeam && newTeam.id) {
        setSelectedTeams(prev => [...prev, newTeam.id]);
      }
      setNewTeamName("");
      setIsAddTeamDialogOpen(false);

      toast({
        title: "Success!",
        description: "Team has been created and is now available for selection!",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create team. Please try again.",
        variant: "destructive",
      });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertEvent) => {
      setIsLoading(true);
      try {
        // Format the date properly for storage to avoid timezone issues
        const formattedData = {
          ...data,
          date: typeof data.date === 'string' ? formatDateForStorage(data.date) : data.date,
          teams: selectedTeams
        };
        
        console.log('Creating event with data:', formattedData);
        const response = await apiRequest("POST", "/api/events", formattedData);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          console.error('Event creation failed:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData
          });
          throw new Error(errorData.message || `Failed to create event (${response.status})`);
        }
        
        const result = await response.json();
        console.log('Event created successfully:', result);
        toast({
          title: "Success",
          description: "Event added successfully",
        });
        form.reset();
        setSelectedTeams([]);

        // Use multiple cache invalidation strategies to ensure all event-related UI updates
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/events"] }),
          queryClient.refetchQueries({ queryKey: ["/api/events"] }),
          queryClient.removeQueries({ queryKey: ["/api/events"] }),
        ]);

        // Also invalidate any event-related queries that might be cached
        queryClient.invalidateQueries({
          predicate: (query) => {
            const queryKey = query.queryKey;
            return Array.isArray(queryKey) && queryKey.some(key => 
              typeof key === 'string' && key.includes('events')
            );
          },
        });

        // Force immediate refetch of events to update EventList component
        await queryClient.refetchQueries({ queryKey: ["/api/events"], type: 'active' });

        // Wait a moment for the queries to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        return result;
      } finally {
        setIsLoading(false);
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Event Name</FormLabel>
              <FormControl>
                <Input {...field} className="bg-transparent border-white/20 text-white" />
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
              <FormLabel>Location</FormLabel>
              <FormControl>
                <Input {...field} className="bg-transparent border-white/20 text-white" />
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
                  className="bg-transparent border-white/20 text-white"
                  value={typeof field.value === 'string' ? field.value : field.value.toISOString().split('T')[0]}
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
              <FormLabel>Start Time (Optional)</FormLabel>
              <FormControl>
                <Input 
                  type="time" 
                  {...field}
                  className="bg-transparent border-white/20 text-white"
                />
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
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="bg-transparent border-white/20 text-white">
                    <SelectValue placeholder="Select event type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-[300px] bg-gray-800 text-white">
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
          <FormLabel className="text-white">Teams</FormLabel>
          <div className="flex gap-2">
            <Select
              onValueChange={(value) => {
                const teamId = parseInt(value);
                if (isNaN(teamId)) return;
                if (selectedTeams.includes(teamId)) return;
                setSelectedTeams(prev => [...prev, teamId]);
              }}
            >
              <SelectTrigger className="flex-1 bg-transparent border-white/20 text-white">
                <SelectValue placeholder="Select a team" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 text-white">
                <ScrollArea className="h-[200px]">
                  {teamsLoading ? (
                    <SelectItem value="loading" disabled>Loading teams...</SelectItem>
                  ) : teams && teams.length > 0 ? (
                    teams.map((team) => (
                      <SelectItem
                        key={team.id}
                        value={team.id.toString()}
                        disabled={selectedTeams.includes(team.id)}
                      >
                        {team.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-teams" disabled>No teams available</SelectItem>
                  )}
                </ScrollArea>
              </SelectContent>
            </Select>

            <Dialog open={isAddTeamDialogOpen} onOpenChange={setIsAddTeamDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" type="button">
                  Add New Team
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-gray-800 text-white">
                <DialogHeader>
                  <DialogTitle className="text-white">Add New Team</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <FormLabel htmlFor="newTeamName">Team Name</FormLabel>
                  <Input 
                    id="newTeamName"
                    value={newTeamName} 
                    onChange={(e) => setNewTeamName(e.target.value)} 
                    placeholder="Enter team name"
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <DialogFooter>
                  <Button 
                    type="button" 
                    onClick={() => createTeamMutation.mutate({ name: newTeamName })}
                    disabled={!newTeamName.trim() || createTeamMutation.isPending}
                  >
                    {createTeamMutation.isPending ? "Creating..." : "Create Team"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {selectedTeams.length > 0 && (
            <Card className="bg-transparent border-white/20">
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <h3 className="font-medium text-white">Selected Teams:</h3>
                  {selectedTeams.map((teamId) => {
                    const team = teams?.find(t => t.id === teamId);
                    return (
                      <div key={teamId} className="flex justify-between items-center">
                        <span className="text-white">{team?.name}</span>
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
            render={({ field }) => {
              // Auto-update host field when teams change
              const hostValue = selectedTeams.length > 0 ? 
                teams?.filter(t => selectedTeams.includes(t.id)).map(t => t.name).join(", ") || "Unknown Teams" : 
                "No host";

              // Update the field value whenever selectedTeams or teams change
              React.useEffect(() => {
                field.onChange(hostValue);
              }, [hostValue, field.onChange]);

              return (
                <input 
                  type="hidden"
                  {...field}
                  value={hostValue}
                />
              );
            }}
          />
        </div>

        <FormField
          control={form.control}
          name="officials"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Assign Officials</FormLabel>
              <FormControl>
                <Select
                  onValueChange={(value) => {
                    const officialId = parseInt(value);
                    const currentOfficials = field.value || [];
                    field.onChange([...currentOfficials, { officialId }]);
                  }}
                >
                  <SelectTrigger className="bg-transparent border-white/20 text-white">
                    <SelectValue placeholder="Select officials" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 text-white">
                    {officials?.map((official) => (
                      <SelectItem 
                        key={official.id} 
                        value={official.id.toString()}
                      >
                        {official.firstName} {official.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <div className="mt-2">
                {field.value?.map((official, index) => {
                  const selectedOfficial = officials?.find(
                    (o) => o.id === official.officialId
                  );
                  return selectedOfficial ? (
                    <div key={index} className="flex items-center gap-2 mt-1">
                      <span className="text-white">
                        {selectedOfficial.firstName} {selectedOfficial.lastName}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const newOfficials = field.value?.filter(
                            (_, i) => i !== index
                          );
                          field.onChange(newOfficials);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null;
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? "Adding Event..." : "Add Event"}
        </Button>
      </form>
    </Form>
  );
}