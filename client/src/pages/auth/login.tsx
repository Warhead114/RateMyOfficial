import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginUser, loginUserSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Link } from "wouter";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginUser>({
    resolver: zodResolver(loginUserSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: LoginUser) => {
      setIsLoading(true);
      try {
        const response = await apiRequest("POST", "/api/auth/login", data);
        const userData = await response.json();

        // Invalidate auth query to refresh the state
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });

        toast({
          title: "Login successful",
          description: "Welcome back!",
        });

        // Wait for query invalidation before redirecting
        await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });

        // Get fresh user data to ensure accurate redirect
        const freshUserResponse = await apiRequest("GET", "/api/auth/me");
        const freshUserData = await freshUserResponse.json();

        // Small delay to ensure session is properly established
        setTimeout(() => {
          // Based on user type, redirect to the appropriate dashboard
          // Check both original and fresh user data for reliability
          const userRole = userData.role || freshUserData.role;
          const userType = userData.userType || freshUserData.userType;
          
          console.log('Redirect logic - Role:', userRole, 'Type:', userType);
          
          if (userRole === 'admin') {
            console.log('Redirecting admin to /admin');
            window.location.href = "/admin";
          } else if (userType === 'Regional Supervisor') {
            console.log('Redirecting supervisor to /supervisor');
            window.location.href = "/supervisor";
          } else if (userType === 'Coach') {
            console.log('Redirecting coach to /coach');
            window.location.href = "/coach";
          } else {
            console.log('Redirecting to home page');
            window.location.href = "/";
          }
        }, 100);
      } finally {
        setIsLoading(false);
      }
    },
    onError: (error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="username" {...field} />
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
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <p className="text-sm text-right">
                <Link href="/forgot-password" className="text-primary hover:underline">
                  Forgot Password?
                </Link>
              </p>

              <Button
                type="submit"
                className="w-full text-black font-bold hover:text-black"
                disabled={isLoading}
              >
                Login
              </Button>

              <p className="text-sm text-center text-muted-foreground">
                Don't have an account?{" "}
                <Link href="/register" className="text-primary hover:underline">
                  Register
                </Link>
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}