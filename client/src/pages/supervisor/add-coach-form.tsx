
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
      console.log('Preparing FormData for coach creation...');
      const formData = new FormData();
      formData.append("firstName", data.firstName.trim());
      formData.append("lastName", data.lastName.trim());
      formData.append("email", data.email.trim().toLowerCase());
      formData.append("password", data.password);
      formData.append("userType", "Coach");
      formData.append("school", data.school.trim());
      
      // Ensure yearsCoaching is a valid number
      const yearsCoaching = data.yearsCoaching !== undefined && data.yearsCoaching !== null 
        ? Number(data.yearsCoaching) 
        : 0;
      formData.append("yearsCoaching", String(yearsCoaching));
      formData.append("isVerified", "true");

      console.log('Coach data being sent:', {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: data.email.trim(),
        school: data.school.trim(),
        yearsCoaching: yearsCoaching,
        hasPhoto: !!(data.photo && data.photo[0])
      });

      if (data.photo && data.photo[0]) {
        console.log('Appending photo:', {
          name: data.photo[0].name,
          size: data.photo[0].size,
          type: data.photo[0].type
        });
        formData.append("photo", data.photo[0]);
      } else {
        console.log('No photo provided');
      }

      console.log('Sending POST request to /api/supervisor/coaches');
      
      try {
        const response = await fetch("/api/supervisor/coaches", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        console.log('Response received:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Server response error:', errorText);
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = { message: errorText || "Failed to create coach" };
          }
          throw new Error(error.message || "Failed to create coach");
        }

        const result = await response.json();
        console.log('Coach created successfully:', result);
        return result;
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
        throw fetchError;
      }
    },
    onSuccess: async () => {
      console.log('onSuccess callback triggered');
      toast({
        title: "Coach created successfully",
        description: "The coach has been added to the system and is ready to use.",
      });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["/api/supervisor/coaches"] });
      console.log('Query cache invalidated');
    },
    onError: (error: any) => {
      console.error("Create coach error:", error);
      console.error('Error type:', typeof error);
      console.error('Error details:', {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      });
      toast({
        title: "Error",
        description: error.message || "Failed to create coach",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: AddCoachFormData) => {
    setIsSubmitting(true);
    console.log('Submitting coach data:', {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      school: data.school,
      yearsCoaching: data.yearsCoaching,
      hasPhoto: !!(data.photo && data.photo[0])
    });
    try {
      console.log('Calling createCoachMutation.mutateAsync');
      await createCoachMutation.mutateAsync(data);
      console.log('Coach creation successful');
    } catch (error) {
      console.error('Form submission error:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      setIsSubmitting(false);
      console.log('Form submission complete, isSubmitting set to false');
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
