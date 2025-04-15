import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export function ProfileEdit({ user }: { user: User }) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      const form = e.currentTarget;

      // Append all form fields
      formData.append('firstName', form.firstName.value);
      formData.append('lastName', form.lastName.value);
      formData.append('email', form.email.value);
      formData.append('region', form.region.value);
      formData.append('yearsExperience', form.yearsExperience.value);

      // Handle photo upload
      const photoInput = form.photo as HTMLInputElement;
      if (photoInput.files && photoInput.files[0]) {
        formData.append('photo', photoInput.files[0]);
      }

      const response = await fetch('/api/users/profile', {
        method: 'PUT',
        body: formData,
        credentials: 'include'
      });

      const updatedUser = await response.json();

      if (!response.ok) {
        throw new Error(updatedUser.message || "Failed to update profile");
      }

      // Update the cache immediately with new data
      queryClient.setQueryData(["/api/auth/me"], updatedUser);

      toast({
        title: "Success",
        description: "Profile updated successfully",
      });

      // Switch back to profile view
      const profileTab = document.querySelector('[data-tab="profile"]') as HTMLButtonElement;
      if (profileTab) {
        profileTab.click();
      }
    } catch (error) {
      console.error('Profile update error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update profile",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} encType="multipart/form-data" className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">First Name</label>
            <Input 
              name="firstName"
              defaultValue={user.firstName}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Last Name</label>
            <Input 
              name="lastName"
              defaultValue={user.lastName}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <Input 
              name="email"
              type="email"
              defaultValue={user.email}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Region</label>
            <Input 
              name="region"
              defaultValue={user.region || ""}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Years Experience</label>
            <Input 
              name="yearsExperience"
              type="number"
              defaultValue={user.yearsExperience?.toString() || "0"}
              min="0"
              required
            />
          </div>
        </div>

        <Card className="h-fit">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              {user.photoUrl && (
                <img
                  src={user.photoUrl}
                  alt="Current profile photo"
                  className="w-32 h-32 rounded-full object-cover mx-auto"
                />
              )}
              <div>
                <label className="block text-sm font-medium mb-2">Profile Photo</label>
                <Input 
                  type="file"
                  name="photo"
                  accept="image/*"
                  className="mx-auto"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}