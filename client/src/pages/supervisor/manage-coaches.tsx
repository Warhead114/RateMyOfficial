import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Pencil, Trash2 } from "lucide-react";

interface Coach {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  school?: string;
  yearsCoaching?: number;
  photoUrl?: string;
  region?: string;
}

// Schema for coach edits
const coachEditSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  school: z.string().optional(),
  yearsCoaching: z.coerce.number().int().nonnegative().optional(),
});

type CoachEditValues = z.infer<typeof coachEditSchema>;

export default function ManageCoaches() {
  const { toast } = useToast();
  const [selectedCoach, setSelectedCoach] = useState<Coach | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Get all coaches (same as admin for feature parity)
  const { data: coaches, isLoading } = useQuery({
    queryKey: ["/api/admin/coaches"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Form for editing coach
  const form = useForm<CoachEditValues>({
    resolver: zodResolver(coachEditSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      school: "",
      yearsCoaching: 0,
    },
  });

  // Delete coach mutation
  const deleteCoachMutation = useMutation({
    mutationFn: async (coachId: number) => {
      await apiRequest("DELETE", `/api/admin/coaches/${coachId}`);
    },
    onSuccess: () => {
      toast({
        title: "Coach deleted",
        description: "The coach has been successfully deleted",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/coaches"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete coach",
        variant: "destructive",
      });
    },
  });

  // Edit coach mutation
  const editCoachMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CoachEditValues }) => {
      await apiRequest("PATCH", `/api/admin/coaches/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Coach updated",
        description: "The coach profile has been successfully updated",
      });
      setEditDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/coaches"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update coach",
        variant: "destructive",
      });
    },
  });

  const handleDeleteCoach = (coach: Coach) => {
    if (window.confirm(`Are you sure you want to delete ${coach.firstName} ${coach.lastName}?`)) {
      deleteCoachMutation.mutate(coach.id);
    }
  };

  const handleEditCoach = (coach: Coach) => {
    setSelectedCoach(coach);
    form.reset({
      firstName: coach.firstName,
      lastName: coach.lastName,
      email: coach.email,
      school: coach.school || "",
      yearsCoaching: coach.yearsCoaching || 0,
    });
    setEditDialogOpen(true);
  };

  const onSubmit = (data: CoachEditValues) => {
    if (selectedCoach) {
      editCoachMutation.mutate({ id: selectedCoach.id, data });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Coaches</CardTitle>
        <CardDescription>
          View, edit, and delete coaches in the system
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : coaches && coaches.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>School</TableHead>
                <TableHead>Years Coaching</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coaches.map((coach: Coach) => (
                <TableRow key={coach.id}>
                  <TableCell className="font-medium">
                    {coach.firstName} {coach.lastName}
                  </TableCell>
                  <TableCell>{coach.email}</TableCell>
                  <TableCell>{coach.school || "—"}</TableCell>
                  <TableCell>{coach.yearsCoaching || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="outline" 
                        size="icon"
                        onClick={() => handleEditCoach(coach)}
                        disabled={deleteCoachMutation.isPending}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="icon"
                        onClick={() => handleDeleteCoach(coach)}
                        disabled={deleteCoachMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center p-4">
            <p className="text-muted-foreground">No coaches found in the system.</p>
          </div>
        )}

        {/* Edit Coach Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Edit Coach Profile</DialogTitle>
              <DialogDescription>
                Update the coach's information below.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                  name="school"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>School</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
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
                        <Input type="number" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <DialogFooter>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setEditDialogOpen(false)}
                    disabled={editCoachMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={editCoachMutation.isPending}
                  >
                    {editCoachMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function getQueryFn({ on401 }: { on401: "throw" | "returnNull" }) {
  return async () => {
    const response = await fetch("/api/admin/coaches");
    
    if (response.status === 401) {
      if (on401 === "throw") {
        throw new Error("Unauthorized");
      }
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  };
}