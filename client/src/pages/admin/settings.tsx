import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminSettings() {
  const [theme, setTheme] = useState<string>("light");
  const [siteTheme, setSiteTheme] = useState<string>("light");
  const [backgroundImage, setBackgroundImage] = useState<File | null>(null);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false); // Added state for upload progress
  const { toast } = useToast();

  // Fetch current user settings
  const { data: userSettings } = useQuery<Array<{ key: string; value: string }>>({
    queryKey: ["/api/user/settings"],
    retry: false,
  });

  // Fetch site-wide settings
  const { data: siteSettings } = useQuery<Array<{ key: string; value: string }>>({
    queryKey: ["/api/settings"],
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

    // Find site-wide settings
    if (siteSettings && Array.isArray(siteSettings)) {
      const siteThemeSetting = siteSettings.find((setting) => setting.key === "theme");
      if (siteThemeSetting) {
        setSiteTheme(siteThemeSetting.value);
      }

      const backgroundImageSetting = siteSettings.find((setting) => setting.key === "backgroundImage");
      if (backgroundImageSetting && backgroundImageSetting.value) {
        setBackgroundPreview(backgroundImageSetting.value);
      }
    }
  }, [userSettings, siteSettings]);

  // Mutation to update user settings
  const updateUserSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return apiRequest("POST", "/api/user/settings", { key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({
        title: "User preferences updated",
        description: "Your personal preferences have been saved.",
      });
    },
    onError: (error) => {
      console.error("Error updating user settings:", error);
      toast({
        title: "Error",
        description: "Failed to update user preferences. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation to update site settings
  const updateSiteSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return apiRequest("POST", "/api/settings", { key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Site settings updated",
        description: "The site settings have been saved.",
      });
    },
    onError: (error) => {
      console.error("Error updating site settings:", error);
      toast({
        title: "Error",
        description: "Failed to update site settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation to upload background image
  const uploadBackgroundMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("backgroundImage", file);

      return fetch("/api/settings/upload-background", {
        method: "POST",
        body: formData,
        credentials: "include",
      }).then(async (res) => {
        if (!res.ok) {
          const error = await res.text();
          throw new Error(error);
        }
        return res.json();
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setBackgroundPreview(data.backgroundImage);
      toast({
        title: "Background image updated",
        description: "The site background image has been updated.",
      });
    },
    onError: (error) => {
      console.error("Error uploading background image:", error);
      toast({
        title: "Error",
        description: "Failed to upload background image. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleUserThemeChange = (value: string) => {
    setTheme(value);
    updateUserSettingMutation.mutate({ key: "theme", value });
  };

  const handleSiteThemeChange = (value: string) => {
    setSiteTheme(value);
    updateSiteSettingMutation.mutate({ key: "theme", value });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setBackgroundImage(e.target.files[0]);
      const reader = new FileReader();
      reader.onloadend = () => {
        setBackgroundPreview(reader.result as string);
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleUploadImage = () => {
    if (backgroundImage) {
      setIsUploading(true); // Indicate upload start
      uploadBackgroundMutation.mutate(backgroundImage, {
        onSuccess: () => setIsUploading(false), // Indicate upload completion
        onError: () => setIsUploading(false), // Indicate upload failure
      });
    } else {
      toast({
        title: "No image selected",
        description: "Please select an image to upload.",
        variant: "destructive",
      });
    }
  };

  // Function to remove background image
  const handleRemoveBackground = () => {
    updateSiteSettingMutation.mutate({ 
      key: "backgroundImage", 
      value: "" 
    });
    setBackgroundPreview(null);
    setBackgroundImage(null);
  };

  return (
    <div className="container mx-auto p-4">
      <Tabs defaultValue="user">
        <TabsList className="mb-4">
          <TabsTrigger value="user">User Preferences</TabsTrigger>
          <TabsTrigger value="site">Site Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="user">
          <Card>
            <CardHeader>
              <CardTitle>User Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Color Theme</h3>
                <p className="text-sm text-muted-foreground">
                  Choose how the application looks to you.
                </p>
                <div className="flex items-center gap-4">
                  <Select value={theme} onValueChange={handleUserThemeChange}>
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
        </TabsContent>

        <TabsContent value="site">
          <Card>
            <CardHeader>
              <CardTitle>Site-wide Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Default Theme</h3>
                <p className="text-sm text-muted-foreground">
                  Set the default theme for all users who haven't chosen their own theme.
                </p>
                <div className="flex items-center gap-4">
                  <Select value={siteTheme} onValueChange={handleSiteThemeChange}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select default theme" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <h3 className="text-lg font-medium">Background Image</h3>
                <p className="text-sm text-muted-foreground">
                  Upload a background image for the site. The system will automatically adjust text colors for readability.
                </p>

                <div className="grid gap-4">
                  {backgroundPreview && (
                    <div className="relative aspect-video max-w-md overflow-hidden rounded-lg border">
                      <img
                        src={backgroundPreview.startsWith('data:') ? backgroundPreview : backgroundPreview}
                        className="h-full w-full object-cover"
                        alt="Background preview"
                      />
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label htmlFor="background-image">Select new image</Label>
                    <Input
                      id="background-image"
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                    />
                    <div className="flex gap-2 mt-2">
                      <Button 
                        onClick={handleUploadImage}
                        disabled={!backgroundImage || isUploading}
                      >
                        {isUploading ? "Uploading..." : "Upload Background Image"}
                      </Button>
                      {backgroundPreview && (
                        <Button 
                          variant="destructive"
                          onClick={handleRemoveBackground}
                        >
                          Remove Background
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}