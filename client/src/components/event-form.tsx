import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertEventSchema, insertTeamSchema, type InsertEvent, type Official, type Team, type InsertTeam } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog";

const EVENT_TYPES = [
  "Dual Match",
  "Tri Match",
  "Quad Match",
  "Dual Tournament",
  "Individual Tournament"
];

export default function EventForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedOfficials, setSelectedOfficials] = useState<Array<{ officialId: number, role?: string }>>([]);
  const [selectedTeams, setSelectedTeams] = useState<number[]>([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [isAddTeamDialogOpen, setIsAddTeamDialogOpen] = useState(false);

  const { data: officials } = useQuery<Official[]>({
    queryKey: ["/api/officials"],
  });

  const { data: teams } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
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

  const createTeamMutation = useMutation({
    mutationFn: async (data: InsertTeam) => {
      return await apiRequest("POST", "/api/teams", data);
    },
    onSuccess: (newTeam: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      if (newTeam && newTeam.id) {
        setSelectedTeams(prev => [...prev, newTeam.id]);
      }
      setNewTeamName("");
      setIsAddTeamDialogOpen(false);
      
      toast({
        title: "Success!",
        description: "Team has been created!",
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
      // Format the date to avoid timezone issues
      let formattedData = { ...data };
      
      // If the date is a string (from the date input), use the formatDateForStorage utility
      // to ensure it's properly formatted for Eastern Time Zone
      if (typeof formattedData.date === 'string') {
        formattedData.date = formatDateForStorage(formattedData.date);
      }
      
      return await apiRequest("POST", "/api/events", {
        ...formattedData,
        officials: selectedOfficials,
        teams: selectedTeams
      });
    },
    onSuccess: (data) => {
      console.log('Event creation successful:', data);
      
      // Use more aggressive query invalidation to ensure all data is refreshed
      queryClient.invalidateQueries({
        predicate: (query) => {
          // Invalidate any query related to events
          const queryKey = Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey;
          const stringKey = String(queryKey);
          const shouldInvalidate = stringKey.includes('/api/events');
          
          if (shouldInvalidate) {
            console.log('Invalidating query with key:', queryKey);
          }
          
          return shouldInvalidate;
        },
      });
      
      form.reset();
      setSelectedOfficials([]);
      setSelectedTeams([]);

      toast({
        title: "Success!",
        description: "Event has been created!",
        duration: 3000,
      });

      // Wait slightly longer to ensure cache invalidation happens before navigation
      setTimeout(() => {
        console.log('Navigating to events page after creation');
        setLocation("/events");
      }, 1500);
      
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create event. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
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
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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
          <div className="flex flex-col sm:flex-row gap-2">
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
            
            <Dialog open={isAddTeamDialogOpen} onOpenChange={setIsAddTeamDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" type="button" className="sm:whitespace-nowrap">
                  Add New Team
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[90vw] sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add New Team</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <FormLabel htmlFor="newTeamName">Team Name</FormLabel>
                  <Input 
                    id="newTeamName"
                    value={newTeamName} 
                    onChange={(e) => setNewTeamName(e.target.value)} 
                    placeholder="Enter team name"
                  />
                </div>
                <DialogFooter>
                  <Button 
                    type="button" 
                    onClick={() => createTeamMutation.mutate({ name: newTeamName })}
                    disabled={!newTeamName.trim() || createTeamMutation.isPending}
                    className="w-full sm:w-auto"
                  >
                    {createTeamMutation.isPending ? "Creating..." : "Create Team"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {selectedTeams.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <h3 className="font-medium">Selected Teams:</h3>
                  {selectedTeams.map((teamId) => {
                    const team = teams?.find(t => t.id === teamId);
                    return (
                      <div key={teamId} className="flex flex-wrap justify-between items-center">
                        <span className="text-sm sm:text-base mr-4">{team?.name}</span>
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
            <SelectContent className="max-w-[90vw] sm:max-w-lg">
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
                      <div key={selectedOfficial.officialId} className="flex flex-wrap justify-between items-center">
                        <span className="text-sm sm:text-base mr-4">{official?.firstName} {official?.lastName}</span>
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

        <Button
          type="submit"
          disabled={selectedOfficials.length === 0 || mutation.isPending}
          className="w-full"
        >
          {mutation.isPending ? "Creating..." : "Create Event"}
        </Button>
      </form>
    </Form>
  );
}