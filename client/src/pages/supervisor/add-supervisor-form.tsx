
import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { InsertOfficial, insertOfficialSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AddSupervisorForm() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<InsertOfficial>({
    resolver: zodResolver(insertOfficialSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      age: 0,
      location: "",
      association: "",
      yearsExperience: 0,
      photo: undefined,
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      console.log('File selected:', file.name);
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
      console.log('File dropped:', file.name);
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
        console.log('Starting file upload...');
        const formData = new FormData();

        // Append all fields except photo
        Object.entries(data).forEach(([key, value]) => {
          if (key !== 'photo' && value !== undefined && value !== null) {
            formData.append(key, value.toString());
          }
        });

        // Append photo if exists
        if (data.photo instanceof File) {
          console.log('Appending photo to FormData:', data.photo.name);
          formData.append('photo', data.photo);
        }

        const response = await fetch('/api/officials', {
          method: 'POST',
          body: formData,
          // Don't set Content-Type header, let the browser set it with the boundary
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to add supervisor');
        }

        const result = await response.json();
        console.log('Upload successful:', result);

        toast({
          title: "Success",
          description: "Supervisor added successfully",
        });
        form.reset();
        setPreviewUrl(null);
        queryClient.invalidateQueries({ queryKey: ["/api/officials"] });
      } catch (error) {
        console.error('Error uploading file:', error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to add supervisor",
          variant: "destructive",
        });
        throw error;
      } finally {
        setIsLoading(false);
      }
    }
  });

  return (
    <Card className="max-w-2xl mx-auto bg-transparent border-white/20">
      <CardHeader>
        <CardTitle className="text-white">Add New Supervisor</CardTitle>
        <CardDescription className="text-white/90">
          Enter the supervisor's information to add them to the system
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                  <FormItem className="bg-transparent">
                    <FormLabel>First Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="bg-transparent" />
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
                      <Input {...field} className="bg-white text-gray-900" />
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
                        className="bg-white text-gray-900"
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
                  <FormItem className="bg-transparent">
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input {...field} className="bg-transparent" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="association"
                render={({ field }) => (
                  <FormItem className="bg-transparent">
                    <FormLabel>Association</FormLabel>
                    <FormControl>
                      <Input {...field} className="bg-transparent" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="yearsExperience"
                render={({ field }) => (
                  <FormItem className="bg-transparent">
                    <FormLabel>Years Experience</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        className="bg-transparent"
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
              className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer bg-transparent"
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
              {isLoading ? "Adding Supervisor..." : "Add Supervisor"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
