
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

const editCoachSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  school: z.string().min(1, "School is required"),
  yearsCoaching: z.coerce.number().int().nonnegative(),
  photo: z.instanceof(File).optional(),
});

type EditCoachValues = z.infer<typeof editCoachSchema>;

export default function EditCoachForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch current coach data
  const { data: coach, isLoading: isFetchingData } = useQuery({
    queryKey: [`/api/admin/coaches/${id}`],
    queryFn: async () => {
      const response = await fetch(`/api/admin/coaches/${id}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch coach data');
      }
      
      return response.json();
    },
    enabled: !!id,
  });

  const form = useForm<EditCoachValues>({
    resolver: zodResolver(editCoachSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      school: "",
      yearsCoaching: 0,
    },
  });

  // Set form default values when coach data is loaded
  useEffect(() => {
    if (coach && !isFetchingData) {
      console.log('Setting form data with coach:', coach);
      
      const formData = {
        firstName: coach.firstName || "",
        lastName: coach.lastName || "",
        email: coach.email || "",
        school: coach.school || "",
        yearsCoaching: coach.yearsCoaching || 0,
      };
      
      console.log('Form data to set:', formData);
      
      form.reset(formData);
      
      if (coach.photoUrl) {
        setPreviewUrl(coach.photoUrl);
      }
    }
  }, [coach, isFetchingData, form]);

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
    mutationFn: async (data: EditCoachValues) => {
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

        const response = await fetch(`/api/admin/coaches/${id}`, {
          method: 'PATCH',
          body: formData,
          credentials: 'include'
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to update coach');
        }

        const result = await response.json();
        console.log('Update successful:', result);

        toast({
          title: "Success",
          description: "Coach updated successfully",
        });
        
        // Invalidate and refetch queries to refresh the data immediately
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/coaches"] });
        await queryClient.invalidateQueries({ queryKey: [`/api/admin/coaches/${id}`] });
        await queryClient.refetchQueries({ queryKey: ["/api/admin/coaches"] });
        
        setLocation("/coach");
      } catch (error) {
        console.error('Error updating coach:', error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to update coach",
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
          <h1 className="text-2xl font-bold text-white">Edit Coach Profile</h1>
          <p className="text-white/80">Loading coach data...</p>
        </div>
      </div>
    );
  }

  if (!coach && !isFetchingData) {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Edit Coach Profile</h1>
          <p className="text-white/80">Coach not found</p>
          <Button onClick={() => setLocation("/coach")} className="mt-4">
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Edit Coach Profile</h1>
        <p className="text-white/80">Update your information</p>
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
              name="school"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">School</FormLabel>
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
                  <FormLabel className="text-white">Years Coaching</FormLabel>
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
              onClick={() => setLocation("/coach")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={isLoading}
            >
              {isLoading ? "Updating Profile..." : "Update Profile"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
