import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function SupervisorSettings() {
  const [theme, setTheme] = useState<string>("light");
  const { toast } = useToast();

  // Fetch current user settings
  const { data: userSettings, isLoading } = useQuery<Array<{ key: string; value: string }>>({
    queryKey: ["/api/user/settings"],
    retry: false,
  });

  useEffect(() => {
    // Find the theme setting if it exists
    if (userSettings && Array.isArray(userSettings)) {
      const themeSetting = userSettings.find((setting) => setting.key === "theme");
      if (themeSetting) {
        setTheme(themeSetting.value);
      }
    }
  }, [userSettings]);

  // Mutation to update user settings
  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return apiRequest("POST", "/api/user/settings", { key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({
        title: "Settings updated",
        description: "Your preferences have been saved.",
      });
    },
    onError: (error) => {
      console.error("Error updating settings:", error);
      toast({
        title: "Error",
        description: "Failed to update settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleThemeChange = (value: string) => {
    setTheme(value);
    updateSettingMutation.mutate({ key: "theme", value });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>Loading settings...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Supervisor Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Color Theme</h3>
            <p className="text-sm text-muted-foreground">
              Choose how the application looks to you.
            </p>
            <div className="flex items-center gap-4">
              <Select value={theme} onValueChange={handleThemeChange}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}