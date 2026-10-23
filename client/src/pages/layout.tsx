import { ReactNode } from "react";
import { useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import { useIsMobile, useScreenSize } from "@/hooks/use-mobile";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const screenSize = useScreenSize();

  // Determine background image based on current page
  const getBackgroundImage = () => {
    // Officials pages handle their own background
    if (location === '/officials' || location.startsWith('/official/')) {
      return null;
    }

    // Evaluation/review pages handle their own background
    if (location.includes('/review')) {
      return null;
    }

    // Use coach-dashboard-background.png for Coach dashboard
    if (location.startsWith('/coach')) {
      return '/uploads/coach-dashboard-background.png';
    }

    // Use specific backgrounds for Admin and Supervisor dashboards
    if (location === '/admin') {
      return '/uploads/Regional-Supervisor-Dashboard.png';
    }

    if (location === '/supervisor') {
      return '/uploads/Regional-Supervisor-Dashboard.png';
    }

    // Only home page uses OfficialsBackground.png
    if (location === '/') {
      return '/uploads/OfficialsBackground.png';
    }

    // All other pages handle their own backgrounds
    return null;
  };

  const backgroundImage = getBackgroundImage();

  const getBackgroundStyles = () => {
    if (!backgroundImage) {
      return { backgroundColor: '#1a1a1a' };
    }

    // Adjust background positioning for mobile
    const mobileStyles = {
      backgroundImage: `url('${backgroundImage}')`,
      backgroundSize: 'cover',
      backgroundPosition: isMobile ? 'center center' : 'top center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'scroll'
    };

    return mobileStyles;
  };

  return (
    <div
      className="min-h-screen w-full bg-no-repeat relative overflow-x-hidden flex flex-col"
      style={{
        ...getBackgroundStyles(),
        minHeight: '100svh' // Use small viewport height for mobile browsers
      }}
    >
      {/* Dark overlay for better text readability - exclude coach dashboard and supervisor page */}
      {backgroundImage && !backgroundImage.includes('coach-dashboard-background.jpg') && !backgroundImage.includes('Regional-Supervisor-Dashboard.png') && (
        <div className={`absolute inset-0 bg-black ${isMobile ? 'bg-opacity-50' : 'bg-opacity-40'}`}></div>
      )}

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />
        <main className={`flex-1 ${isMobile ? 'pt-14' : 'pt-16'}`} style={{ minHeight: 'calc(100vh - 120px)' }}>
          <div className={`${isMobile ? 'px-2' : 'px-4'} min-h-full`}>
            {children}
          </div>
        </main>
        <footer className="bg-transparent py-4 sm:py-8 flex-shrink-0">
          <div className={`container mx-auto ${isMobile ? 'px-2' : 'px-4'} text-center`}>
            <p className={`text-white drop-shadow-lg font-medium ${isMobile ? 'text-sm' : 'text-base'}`}>
              &copy; 2025 RateMyOfficial. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}