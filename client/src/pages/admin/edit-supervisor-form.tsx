
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const editSupervisorSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  region: z.string().min(1, "Association is required"),
  yearsExperience: z.coerce.number().int().nonnegative(),
  photo: z.instanceof(File).optional(),
});

type EditSupervisorValues = z.infer<typeof editSupervisorSchema>;

export default function EditSupervisorForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch existing officials to get their associations
  const { data: officialsData } = useQuery<{ data: Array<{ association: string }> }>({
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

  // Fetch current supervisor data
  const { data: supervisor, isLoading: isFetchingData } = useQuery({
    queryKey: [`/api/admin/supervisors/${id}`],
    queryFn: async () => {
      const response = await fetch(`/api/admin/supervisors/${id}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch supervisor data');
      }
      
      return response.json();
    },
    enabled: !!id, // Only run query if we have an id
  });

  const form = useForm<EditSupervisorValues>({
    resolver: zodResolver(editSupervisorSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      region: "",
      yearsExperience: 0,
    },
  });

  // Set form default values when supervisor data is loaded
  useEffect(() => {
    if (supervisor && !isFetchingData) {
      console.log('Setting form data with supervisor:', supervisor);
      console.log('Supervisor photo URL:', supervisor.photoUrl);
      
      const formData = {
        firstName: supervisor.firstName || "",
        lastName: supervisor.lastName || "",
        email: supervisor.email || "",
        region: supervisor.region || "",
        yearsExperience: supervisor.yearsExperience || 0,
      };
      
      console.log('Form data to set:', formData);
      
      // Reset the form with the new data
      form.reset(formData);
      
      if (supervisor.photoUrl) {
        console.log('Setting preview URL to:', supervisor.photoUrl);
        setPreviewUrl(supervisor.photoUrl);
      }
    }
  }, [supervisor, isFetchingData, form]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
      form.setValue("photo", file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
      form.setValue("photo", file);
    }
  };

  const mutation = useMutation({
    mutationFn: async (data: EditSupervisorValues) => {
      setIsLoading(true);
      try {
        const formData = new FormData();

        // Append all fields except photo
        Object.entries(data).forEach(([key, value]) => {
          if (key !== 'photo' && value !== undefined && value !== null) {
            formData.append(key, value.toString());
          }
        });

        // Append photo if exists
        if (data.photo instanceof File) {
          formData.append('photo', data.photo);
        }

        const response = await fetch(`/api/admin/supervisors/${id}`, {
          method: 'PATCH',
          body: formData,
          credentials: 'include'
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to update supervisor');
        }

        const result = await response.json();
        console.log('Update successful:', result);

        toast({
          title: "Success",
          description: "Supervisor updated successfully",
        });
        
        // Invalidate and refetch queries to refresh the data immediately
        await queryClient.invalidateQueries({ queryKey: ["/api/users/supervisors"] });
        await queryClient.invalidateQueries({ queryKey: [`/api/admin/supervisors/${id}`] });
        await queryClient.refetchQueries({ queryKey: ["/api/users/supervisors"] });
        
        // Navigate back to appropriate dashboard based on user type
        if (window.location.pathname.includes('/supervisor/')) {
          setLocation("/supervisor");
        } else {
          setLocation("/admin");
        }
      } catch (error) {
        console.error('Error updating supervisor:', error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to update supervisor",
          variant: "destructive",
        });
        throw error;
      } finally {
        setIsLoading(false);
      }
    }
  });

  if (isFetchingData) {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Edit Supervisor</h1>
          <p className="text-white/80">Loading supervisor data...</p>
        </div>
      </div>
    );
  }

  if (!supervisor && !isFetchingData) {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Edit Supervisor</h1>
          <p className="text-white/80">Supervisor not found</p>
          <Button onClick={() => setLocation("/admin")} className="mt-4">
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Edit Supervisor</h1>
        <p className="text-white/80">Update supervisor information</p>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
          className="space-y-4 max-w-2xl mx-auto"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">First Name</FormLabel>
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
                  <FormLabel className="text-white">Last Name</FormLabel>
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
                  <FormLabel className="text-white">Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                        list="associations-list-edit"
                        placeholder="Enter or select an association"
                      />
                      <datalist id="associations-list-edit">
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
                  <FormLabel className="text-white">Years Experience</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseInt(e.target.value, 10))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div
            className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer border-white/20"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleFileChange}
            />
            {previewUrl ? (
              <div className="relative w-32 h-32 mx-auto">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full h-full object-cover rounded-lg"
                />
                <button
                  type="button"
                  className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewUrl(null);
                    form.setValue("photo", undefined);
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="text-white/60">
                <p>Drag & drop a photo here or click to select</p>
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setLocation("/admin")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={isLoading}
            >
              {isLoading ? "Updating Supervisor..." : "Update Supervisor"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
