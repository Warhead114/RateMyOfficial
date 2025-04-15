import { useState } from "react";
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
  const officials = officialsResponse?.data;

  // Fetch teams for selection
  const { data: teams } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const form = useForm<InsertEvent>({
    resolver: zodResolver(insertEventSchema),
    defaultValues: {
      name: "",
      date: new Date().toISOString().split('T')[0], // Today's date as YYYY-MM-DD
      venue: "",
      description: "",
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
      setIsLoading(true);
      try {
        await apiRequest("POST", "/api/events", {
          ...data,
          teams: selectedTeams
        });
        toast({
          title: "Success",
          description: "Event added successfully",
        });
        form.reset();
        setSelectedTeams([]);
        queryClient.invalidateQueries({ queryKey: ["/api/events"] });
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
                <Input {...field} />
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
                  value={typeof field.value === 'string' ? field.value : field.value.toISOString().split('T')[0]}
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

            <Dialog open={isAddTeamDialogOpen} onOpenChange={setIsAddTeamDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" type="button">
                  Add New Team
                </Button>
              </DialogTrigger>
              <DialogContent>
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
                  <SelectTrigger>
                    <SelectValue placeholder="Select officials" />
                  </SelectTrigger>
                  <SelectContent>
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
                      <span>
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