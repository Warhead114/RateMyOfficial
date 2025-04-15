import { Link } from "wouter";
import { LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useEffect, useState } from "react";
import { Settings } from "@shared/schema";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const logoText = "RateMyOfficial"; // Fixed logo text
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  // Always define all hooks at the top level, regardless of user state
  const { data: user } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/auth/me");
        return await response.json();
      } catch (error) {
        console.error('Auth error:', error);
        return null;
      }
    }
  });
  
  // Fetch application settings
  const { data: settings } = useQuery<Settings[]>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/settings");
        return await response.json();
      } catch (error) {
        console.error('Settings error:', error);
        return [];
      }
    }
  });
  
  // Fetch user-specific settings if user is logged in
  const { data: userSettings } = useQuery<Settings[]>({
    queryKey: ["/api/user/settings"],
    queryFn: async () => {
      if (!user) return null;
      try {
        const response = await apiRequest("GET", "/api/user/settings");
        return await response.json();
      } catch (error) {
        console.error('User settings error:', error);
        return null;
      }
    },
    enabled: !!user // Only fetch if user is logged in
  });
  
  // Apply settings when they are loaded
  useEffect(() => {
    if (settings) {
      // Set default theme from site settings
      let themeValue = settings.find(s => s.key === "theme")?.value || "light";
      
      // Override with user-specific settings if available
      if (userSettings && Array.isArray(userSettings) && userSettings.length > 0) {
        const userTheme = userSettings.find(s => s.key === "theme")?.value;
        if (userTheme) {
          themeValue = userTheme;
        }
      }
      
      // Convert theme value to dark mode boolean
      const darkMode = themeValue === "dark";
      const backgroundImageSetting = settings.find(s => s.key === "backgroundImage")?.value;
      const backgroundIsDark = settings.find(s => s.key === "backgroundIsDark")?.value === "true";
      
      if (backgroundImageSetting) {
        setBackgroundImage(backgroundImageSetting);
      }
      
      // Create a style element to apply the settings
      const styleEl = document.createElement('style');
      
      // Define default theme colors
      const primaryColor = "#0f172a";
      const borderRadius = "0.5";
      
      // If we have a background image and brightness analysis, set up contrast text styles
      if (backgroundImageSetting && backgroundIsDark !== undefined) {
        styleEl.textContent = `
          :root {
            --primary: ${primaryColor};
            --border-radius: ${borderRadius}rem;
          }
          
          /* Auto-adjusting text colors for background image */
          .bg-image-contrast {
            color: ${backgroundIsDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.9)'};
          }
          
          .bg-image-contrast-muted {
            color: ${backgroundIsDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)'};
          }
          
          /* Card and content background for readability */
          .bg-image-content {
            background-color: ${backgroundIsDark 
              ? 'rgba(0, 0, 0, 0.75)' 
              : 'rgba(255, 255, 255, 0.75)'};
            backdrop-filter: blur(4px);
          }
        `;
      } else {
        styleEl.textContent = `
          :root {
            --primary: ${primaryColor};
            --border-radius: ${borderRadius}rem;
          }
        `;
      }
      
      document.head.appendChild(styleEl);
      
      // Update theme.json (this would normally be done server-side)
      const themeData = {
        primary: primaryColor,
        variant: "professional", // Use a default variant
        appearance: darkMode ? 'dark' : 'light',
        radius: parseFloat(borderRadius)
      };
      
      // Set dark mode class on html element
      if (darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      
      return () => {
        document.head.removeChild(styleEl);
      };
    }
  }, [settings, userSettings]);

  // Logout is handled directly in the button click handler
  // to avoid React hooks errors during the logout process

  // Dashboard logic is always defined, even if user is null
  const getDashboardLink = () => {
    if (!user) return "/";
    if (user.role === "admin") return "/admin";
    if (user.userType === "Regional Supervisor") return "/supervisor";
    if (user.userType === "Coach") return "/coach";
    return "/";
  };

  const getDashboardLabel = () => {
    if (!user) return "Dashboard";
    if (user.role === "admin") return "Admin Dashboard";
    if (user.userType === "Regional Supervisor") return "Dashboard";
    if (user.userType === "Coach") return "Coaches Corner";
    return "Dashboard";
  };

  return (
    <div 
      className="min-h-screen bg-background" 
      style={
        backgroundImage 
          ? { 
              backgroundImage: `url(${backgroundImage})`, 
              backgroundSize: 'cover', 
              backgroundPosition: 'center',
              backgroundAttachment: 'fixed'
            } 
          : {}
      }
    >
      {/* Overlay for background image to ensure content remains readable */}
      {backgroundImage && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm -z-10"></div>
      )}
      <header className="sticky top-0 z-50 w-full border-b bg-image-content backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between py-2 sm:h-14">
            {/* Logo centered on mobile, left-aligned on larger screens */}
            <Link 
              href="/" 
              className="flex items-center space-x-2 bg-image-contrast w-full sm:w-auto justify-center sm:justify-start mb-2 sm:mb-0"
            >
              <span className="logo-text text-2xl sm:text-3xl">{logoText}</span>
              <img 
                src="/uploads/wrestlers-silhouette.png" 
                alt="Wrestlers silhouette" 
                className="h-8 sm:h-10 object-contain"
              />
            </Link>
            
            {/* Navigation - full width on mobile, right-aligned on larger screens */}
            <nav className="flex items-center justify-center sm:justify-end w-full sm:w-auto">
              {!user ? (
                // Not logged in - show auth links
                <div className="flex items-center gap-4 sm:gap-6 justify-center sm:justify-end w-full">
                  <Link href="/register" className="text-sm font-medium hover:text-primary bg-image-contrast">
                    Register
                  </Link>
                  <Link href="/login" className="text-sm font-medium hover:text-primary bg-image-contrast">
                    Login
                  </Link>
                  <Link href="/admin/login" className="text-sm font-medium hover:text-primary bg-image-contrast">
                    Admin
                  </Link>
                </div>
              ) : (
                // Logged in users - show navigation based on user type
                <div className="flex items-center flex-wrap gap-3 justify-center sm:justify-end w-full">
                  <Link href={getDashboardLink()} className="text-sm font-medium hover:text-primary bg-image-contrast">
                    {getDashboardLabel()}
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2 bg-image-contrast text-sm"
                    onClick={() => {
                      // Direct approach - bypass React Query mutation to avoid hooks errors
                      (async () => {
                        try {
                          await apiRequest("POST", "/api/auth/logout");
                          // Force immediate page reload to prevent React re-renders
                          window.location.href = "/";
                        } catch (error) {
                          toast({
                            title: "Error",
                            description: "There was a problem logging out",
                            variant: "destructive"
                          });
                        }
                      })();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
                </div>
              )}
            </nav>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
      <footer className="border-t mt-auto bg-image-content">
        <div className="container mx-auto px-4 h-16 flex items-center justify-center text-xs bg-image-contrast">
          © {new Date().getFullYear()} {logoText}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}