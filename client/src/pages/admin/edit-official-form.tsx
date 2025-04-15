import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { InsertOfficial, insertOfficialSchema } from "@shared/schema";
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
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function EditOfficialForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch current official data
  const { data: official } = useQuery({
    queryKey: [`/api/officials/${id}`],
  });

  const form = useForm<InsertOfficial>({
    resolver: zodResolver(insertOfficialSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      age: 0,
      location: "",
      association: "",
      yearsExperience: 0,
    },
  });

  // Set form default values when official data is loaded
  useEffect(() => {
    if (official) {
      form.reset({
        firstName: official.firstName,
        lastName: official.lastName,
        age: official.age,
        location: official.location,
        association: official.association,
        yearsExperience: official.yearsExperience,
      });
      if (official.photoUrl) {
        setPreviewUrl(official.photoUrl);
      }
    }
  }, [official, form]);

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
    mutationFn: async (data: InsertOfficial) => {
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

        const response = await fetch(`/api/officials/${id}`, {
          method: 'PATCH',
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to update official');
        }

        const result = await response.json();
        console.log('Update successful:', result);

        toast({
          title: "Success",
          description: "Official updated successfully",
        });
        
        // Invalidate queries to refresh the data
        queryClient.invalidateQueries({ queryKey: ["/api/officials"] });
        queryClient.invalidateQueries({ queryKey: [`/api/officials/${id}`] });
        
        setLocation(`/officials/${id}`);
      } catch (error) {
        console.error('Error updating official:', error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to update official",
          variant: "destructive",
        });
        throw error;
      } finally {
        setIsLoading(false);
      }
    }
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
        className="space-y-4"
      >
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

          <FormField
            control={form.control}
            name="age"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Age</FormLabel>
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

          <FormField
            control={form.control}
            name="location"
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
            name="association"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Association</FormLabel>
                <FormControl>
                  <Input {...field} />
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
          className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer"
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
            <div className="text-muted-foreground">
              <p>Drag & drop a photo here or click to select</p>
            </div>
          )}
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? "Updating Official..." : "Update Official"}
        </Button>
      </form>
    </Form>
  );
}
