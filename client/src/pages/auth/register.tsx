import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { InsertUser, registerUserSchema } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { apiRequest } from "@/lib/queryClient";
import type { Team } from "@shared/schema";

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  const navigate = setLocation; // Alias for clarity in the original handleSubmit logic

  const form = useForm<InsertUser>({
    resolver: zodResolver(registerUserSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
      userType: "Coach",
      school: "",
    },
  });

  const userType = form.watch("userType");
  const { watch, register, getFieldState, formState: { errors } } = form;

  // Fetch teams for the school dropdown
  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/teams");
      const data = await response.json();
      return data as Team[];
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertUser) => {
      setIsLoading(true);
      try {
        await apiRequest("POST", "/api/auth/register", data);
        toast({
          title: "Registration request submitted",
          description: "Thank you for registering! Your account is pending approval from an administrator.",
        });
        setLocation("/");
      } finally {
        setIsLoading(false);
      }
    },
    onError: (error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onload = (upload) => {
        if (upload.target?.result) {
          setPhotoPreview(upload.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Validate form
    if (!form.getValues().firstName || !form.getValues().lastName || !form.getValues().email || !form.getValues().password) {
      setError("Please fill in all required fields");
      return;
    }

    if (form.getValues().password !== form.getValues().confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (form.getValues().password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (form.getValues().userType === "Coach" && !form.getValues().school) {
      setError("Please enter your school name");
      return;
    }

    if (form.getValues().userType === "Regional Supervisor" && !form.getValues().region) {
      setError("Please select your region");
      return;
    }

    try {
      // Use FormData for multipart upload
      const submitData = new FormData();
      const formValues = form.getValues();
      
      submitData.append('firstName', formValues.firstName);
      submitData.append('lastName', formValues.lastName);
      submitData.append('email', formValues.email);
      submitData.append('password', formValues.password);
      submitData.append('confirmPassword', formValues.confirmPassword || formValues.password);
      submitData.append('userType', formValues.userType);

      if (formValues.userType === "Coach") {
        if (formValues.school) submitData.append('school', formValues.school);
        if (formValues.yearsCoaching) submitData.append('yearsCoaching', String(formValues.yearsCoaching));
      } else if (formValues.userType === "Regional Supervisor") {
        if (formValues.region) submitData.append('region', formValues.region);
        if (formValues.yearsExperience) submitData.append('yearsExperience', String(formValues.yearsExperience));
      }

      // Add photo if selected
      if (photoFile) {
        submitData.append('photo', photoFile);
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        body: submitData,
        // Don't set Content-Type header - browser will set it with boundary for multipart/form-data
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Registration failed");
      }

      const data = await response.json();
      setSuccess(data.message);

      // Clear form after successful registration
      form.reset();
      setPhotoFile(null);
      setPhotoPreview(null);

      // Redirect to login page after 2 seconds
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle>Join RateMyOfficial</CardTitle>
          <CardDescription>
            Create an account to rate and review wrestling officials. Your account will need approval from an administrator before you can log in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground font-medium">First Name</FormLabel>
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
                      <FormLabel className="text-foreground font-medium">Last Name</FormLabel>
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
                name="userType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Role</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Coach">Coach</SelectItem>
                        <SelectItem value="Regional Supervisor">Regional Supervisor</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {userType === "Coach" && (
                <FormField
                  control={form.control}
                  name="school"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>School</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} list="registered-teams" placeholder="Select or enter your school" />
                      </FormControl>
                      <datalist id="registered-teams">
                        {teams.sort((a, b) => a.name.localeCompare(b.name)).map((team) => (
                          <option key={team.id} value={team.name} />
                        ))}
                      </datalist>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              
              {userType === "Coach" && (
                <FormField
                  control={form.control}
                  name="yearsCoaching"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground font-medium">Years Coaching</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {userType === "Regional Supervisor" && (
                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground font-medium">Region</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {userType === "Regional Supervisor" && (
                <FormField
                  control={form.control}
                  name="yearsExperience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground font-medium">Years Experience</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}


              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Email</FormLabel>
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
                    <FormLabel className="text-foreground font-medium">Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Confirm Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel className="text-foreground font-medium">Profile Photo</FormLabel>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                />
                {photoPreview && (
                  <div className="mt-2">
                    <img src={photoPreview} alt="Photo Preview" className="w-32 h-32 object-cover rounded" />
                  </div>
                )}
              </div>


              {error && <p className="text-red-500 text-sm">{error}</p>}
              {success && <p className="text-green-500 text-sm">{success}</p>}

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || mutation.isPending}
              >
                {isLoading || mutation.isPending ? "Submitting application..." : "Submit Application"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}