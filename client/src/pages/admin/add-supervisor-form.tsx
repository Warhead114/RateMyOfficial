
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupervisorSchema, CreateSupervisor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type AddSupervisorFormData = CreateSupervisor;

export default function AddSupervisorForm() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch existing officials to get their associations and photos
  const { data: officialsData } = useQuery<{
    data: Array<{
      firstName: string;
      lastName: string;
      association: string;
      photoUrl: string | null;
    }>;
  }>({
    queryKey: ["/api/officials"],
    queryFn: async () => {
      const response = await fetch("/api/officials", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch officials");
      return response.json();
    },
  });

  // Get unique associations from officials
  const existingAssociations: string[] = officialsData?.data
    ? Array.from(new Set(officialsData.data.map((official) => official.association).filter(Boolean)))
    : [];

  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);

  const form = useForm<AddSupervisorFormData>({
    resolver: zodResolver(createSupervisorSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      region: "",
      yearsExperience: 0,
    },
  });

  // Find matching official photo when first and last name are entered
  const firstName = form.watch("firstName");
  const lastName = form.watch("lastName");

  useEffect(() => {
    if (firstName && lastName && officialsData?.data) {
      const matchingOfficial = officialsData.data.find(
        (official) =>
          official.firstName.toLowerCase() === firstName.toLowerCase() &&
          official.lastName.toLowerCase() === lastName.toLowerCase()
      );
      
      if (matchingOfficial?.photoUrl) {
        setExistingPhotoUrl(matchingOfficial.photoUrl);
        toast({
          title: "Photo Found",
          description: `Using existing photo for ${firstName} ${lastName}`,
        });
      } else {
        setExistingPhotoUrl(null);
      }
    }
  }, [firstName, lastName, officialsData, toast]);

  const createSupervisorMutation = useMutation({
    mutationFn: async (data: AddSupervisorFormData) => {
      const formData = new FormData();
      formData.append("firstName", data.firstName);
      formData.append("lastName", data.lastName);
      formData.append("email", data.email);
      formData.append("password", data.password);
      formData.append("userType", "Regional Supervisor");
      formData.append("region", data.region);
      formData.append("yearsExperience", data.yearsExperience.toString());
      formData.append("isVerified", "true");

      // Use existing photo URL if available and no new photo was uploaded
      if (existingPhotoUrl && (!data.photo || !data.photo[0])) {
        formData.append("existingPhotoUrl", existingPhotoUrl);
      } else if (data.photo && data.photo[0]) {
        formData.append("photo", data.photo[0]);
      }

      const response = await fetch("/api/admin/supervisors", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to create supervisor" }));
        throw new Error(errorData.message || "Failed to create supervisor");
      }

      return response.json();
    },
    onSuccess: async (data) => {
      console.log("Supervisor created successfully:", data);
      toast({
        title: "Supervisor created successfully",
        description: "The regional supervisor has been added to the system.",
      });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["/api/users/supervisors"] });
    },
    onError: (error: Error) => {
      console.error("Create supervisor error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create supervisor",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: AddSupervisorFormData) => {
    console.log("Form submitted with data:", data);
    setIsSubmitting(true);
    createSupervisorMutation.mutate(data, {
      onSettled: () => {
        setIsSubmitting(false);
      }
    });
  };

  return (
    <Card className="max-w-2xl mx-auto bg-transparent border-white/20">
      <CardHeader>
        <CardTitle className="text-white">Add New Regional Supervisor</CardTitle>
        <CardDescription className="text-white/90">
          Enter the supervisor's information to add them to the system
        </CardDescription>
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
                      <Input {...field} className="bg-transparent border-white/20 text-white" />
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
                      <Input {...field} className="bg-transparent border-white/20 text-white" />
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
                    <Input type="email" {...field} className="bg-transparent border-white/20 text-white" />
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
                    <Input type="password" {...field} className="bg-transparent border-white/20 text-white" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Association</FormLabel>
                    <FormControl>
                      <div>
                        <Input 
                          {...field} 
                          list="associations-list"
                          placeholder="Enter or select an association"
                          className="bg-transparent border-white/20 text-white"
                        />
                        <datalist id="associations-list">
                          {existingAssociations.map((association: string) => (
                            <option key={association} value={association} />
                          ))}
                        </datalist>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="yearsExperience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Years Experience</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        className="bg-transparent border-white/20 text-white"
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="photo"
              render={({ field: { onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Profile Photo (Optional)</FormLabel>
                  {existingPhotoUrl && (
                    <div className="mb-2">
                      <p className="text-sm text-white/70 mb-2">Existing photo will be used:</p>
                      <img
                        src={existingPhotoUrl}
                        alt="Existing official photo"
                        className="w-24 h-24 rounded-full object-cover border-2 border-white/20"
                      />
                      <p className="text-xs text-white/50 mt-1">Upload a new photo to replace this one</p>
                    </div>
                  )}
                  <FormControl>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onChange(e.target.files)}
                      {...field}
                      className="bg-transparent border-white/20 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating Supervisor..." : "Create Regional Supervisor"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
