import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Loading } from "@/components/ui/loading";
import { Loader2 } from "lucide-react";

type CoachUser = User & { teamMascot?: string | null };

function ProfileEdit({ user }: { user: CoachUser }) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Show prominent loading message
      toast({
        title: "Updating Profile",
        description: "Please wait while we save your changes...",
      });

      const formData = new FormData();
      const form = e.currentTarget;

      // Validate and sanitize input fields
      const firstName = form.firstName.value.trim();
      const lastName = form.lastName.value.trim();
      const email = form.email.value.trim();
      const school = form.school.value.trim();
      const yearsCoaching = form.yearsCoaching.value.trim();
      const teamMascot = form.teamMascot.value.trim();

      if (!firstName || !lastName || !email || !school) {
        toast({
          title: "Validation Error",
          description: "First name, last name, email, and school are required.",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Append all form fields
      formData.append('firstName', firstName);
      formData.append('lastName', lastName);
      formData.append('email', email);
      formData.append('school', school);
      formData.append('yearsCoaching', yearsCoaching);
      formData.append('teamMascot', teamMascot || '');

      // Handle photo upload with validation
      const photoInput = form.photo as HTMLInputElement;
      if (photoInput.files && photoInput.files[0]) {
        const file = photoInput.files[0];
        
        console.log('Uploading photo:', {
          name: file.name,
          type: file.type,
          size: file.size
        });

        // Validate file size (server enforces 20MB limit)
        if (file.size > 20 * 1024 * 1024) {
          toast({
            title: "File Too Large",
            description: "Profile photo must be less than 20MB.",
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }
        
        // Log upload details for debugging
        console.log('Preparing to upload photo:', {
          name: file.name,
          size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
          type: file.type
        });

        formData.append('photo', file, file.name);
      }

      const response = await fetch('/api/users/profile', {
        method: 'PUT',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Profile update error:', errorData);
        throw new Error(errorData.message || errorData.details || "Failed to update profile");
      }

      const updatedUser = await response.json();

      // Force immediate cache update and refetch
      queryClient.setQueryData(["/api/auth/me"], updatedUser);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/me"], type: 'active' });

      toast({
        title: "Success",
        description: "Profile updated successfully",
      });

      // Switch back to profile view with slight delay to ensure cache update
      setTimeout(() => {
        const profileTab = document.querySelector('[data-tab="profile"]') as HTMLButtonElement;
        if (profileTab) {
          profileTab.click();
        }
      }, 500);
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
            <label className="block text-sm font-medium mb-1 text-white">First Name</label>
            <Input 
              name="firstName"
              defaultValue={user.firstName}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Last Name</label>
            <Input 
              name="lastName"
              defaultValue={user.lastName}
              required
            />
          </div>


          <div>
            <label className="block text-sm font-medium mb-1 text-white">Years Coaching</label>
            <Input 
              name="yearsCoaching"
              type="number"
              defaultValue={user.yearsCoaching?.toString() || "0"}
              min="0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Email</label>
            <Input 
              name="email"
              type="email"
              defaultValue={user.email}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">School</label>
            <Input 
              name="school"
              defaultValue={user.school || ""}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Team Mascot</label>
            <Input 
              name="teamMascot"
              defaultValue={user.teamMascot || ""}
              placeholder="e.g., Eagles, Warriors, Lions"
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
                <label className="block text-sm font-medium mb-2 text-white">Profile Photo</label>
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
        {isSubmitting ? (
          <div className="flex items-center justify-center">
            <div className="relative animate-pulse mr-2">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center animate-ping">
                <Loader2 className="w-3 h-3 animate-spin" />
              </div>
            </div>
            Saving Changes...
          </div>
        ) : (
          "Save Changes"
        )}
      </Button>
    </form>
  );
}

export default ProfileEdit;
export { ProfileEdit };