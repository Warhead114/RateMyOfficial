import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCoachSchema, CreateCoach } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type AddCoachFormData = CreateCoach;

interface Team {
  id: number;
  name: string;
}

export default function AddCoachForm() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddTeamDialogOpen, setIsAddTeamDialogOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  // Fetch existing teams
  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/teams");
      if (!response.ok) throw new Error('Failed to fetch teams');
      return response.json();
    }
  });

  // Create team mutation
  const createTeamMutation = useMutation({
    mutationFn: async (teamData: { name: string }) => {
      const response = await apiRequest("POST", "/api/teams", teamData);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to create team" }));
        throw new Error(error.message || "Failed to create team");
      }
      return response.json();
    },
    onSuccess: async (newTeam) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      form.setValue("school", newTeam.name);
      setNewTeamName("");
      setIsAddTeamDialogOpen(false);
      toast({
        title: "Team created",
        description: `${newTeam.name} has been added to the teams list.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create team",
        variant: "destructive",
      });
    },
  });

  const form = useForm<AddCoachFormData>({
    resolver: zodResolver(createCoachSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      school: "",
      yearsCoaching: undefined,
    },
  });

  const createCoachMutation = useMutation({
    mutationFn: async (data: AddCoachFormData) => {
      console.log('[ADMIN] Starting coach creation process...');
      const formData = new FormData();
      formData.append("firstName", data.firstName.trim());
      formData.append("lastName", data.lastName.trim());
      formData.append("email", data.email.trim().toLowerCase());
      formData.append("password", data.password);
      formData.append("userType", "Coach");
      formData.append("school", data.school.trim());
      
      const yearsCoaching = Number(data.yearsCoaching) || 0;
      formData.append("yearsCoaching", String(yearsCoaching));
      formData.append("isVerified", "true");

      console.log('[ADMIN] Coach data:', {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: data.email.trim(),
        school: data.school.trim(),
        yearsCoaching: yearsCoaching,
        hasPhoto: !!(data.photo && data.photo[0])
      });

      if (data.photo && data.photo[0]) {
        console.log('[ADMIN] Photo attached:', data.photo[0].name, data.photo[0].size);
        formData.append("photo", data.photo[0]);
      }

      console.log('[ADMIN] Sending POST to /api/admin/coaches');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch("/api/admin/coaches", {
          method: "POST",
          body: formData,
          credentials: "include",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        console.log('[ADMIN] Response status:', response.status, response.statusText);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ADMIN] Server error response:', errorText);
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = { message: errorText || "Failed to create coach" };
          }
          throw new Error(error.message || "Failed to create coach");
        }

        const result = await response.json();
        console.log('[ADMIN] Coach created successfully:', result);
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('[ADMIN] Request timeout after 30 seconds');
          throw new Error('Request timeout - please check your connection and try again');
        }
        console.error('[ADMIN] Fetch error:', error);
        throw error;
      }
    },
    onSuccess: async () => {
      toast({
        title: "Coach created successfully",
        description: "The coach has been added to the system and is ready to use.",
      });
      form.reset();
      // Invalidate both endpoints to ensure cache is refreshed
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/coaches"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/supervisor/coaches"] });
    },
    onError: (error: any) => {
      console.error("Create coach error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create coach",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: AddCoachFormData) => {
    setIsSubmitting(true);
    console.log('[ADMIN] Form submitted with data:', {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      school: data.school,
      yearsCoaching: data.yearsCoaching,
      hasPhoto: !!(data.photo && data.photo[0])
    });
    try {
      await createCoachMutation.mutateAsync(data);
      console.log('[ADMIN] Form submission completed successfully');
    } catch (error) {
      console.error('[ADMIN] Form submission error:', error);
      console.error('[ADMIN] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      setIsSubmitting(false);
      console.log('[ADMIN] isSubmitting set to false');
    }
  };

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Add New Coach</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="school"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>School/Team</FormLabel>
                  <div className="flex gap-2">
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select a school/team" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {teams
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((team) => (
                            <SelectItem key={team.id} value={team.name}>
                              {team.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Dialog open={isAddTeamDialogOpen} onOpenChange={setIsAddTeamDialogOpen}>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline" className="whitespace-nowrap">
                          Add New
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add New School/Team</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <FormLabel htmlFor="newTeamName">School/Team Name</FormLabel>
                          <Input 
                            id="newTeamName"
                            value={newTeamName} 
                            onChange={(e) => setNewTeamName(e.target.value)} 
                            placeholder="Enter school or team name"
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
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="yearsCoaching"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Years Coaching</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        field.onChange(value === '' ? 0 : parseInt(value) || 0);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="photo"
              render={({ field: { onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Profile Photo (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onChange(e.target.files)}
                      {...field}
                      className="bg-black/30 border-white/20 text-white file:text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Creating Coach..." : "Create Coach"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}