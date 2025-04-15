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

export default function AdminLogin() {
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

        if (userData.role !== 'admin') {
          throw new Error('Not authorized as admin');
        }

        // Invalidate auth query to refresh the state
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });

        toast({
          title: "Login successful",
          description: "Welcome back, admin!",
        });

        // Wait for query invalidation before redirecting
        await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
        
        // Use direct page navigation instead of React Router to ensure a complete refresh
        window.location.href = "/admin";
      } finally {
        setIsLoading(false);
      }
    },
    onError: (error) => {
      toast({
        title: "Login failed",
        description: error.message === 'Not authorized as admin' 
          ? "You don't have admin privileges" 
          : "Invalid credentials",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle>Admin Login</CardTitle>
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

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}