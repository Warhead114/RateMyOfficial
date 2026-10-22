import React from 'react';
import { Link, useLocation } from 'wouter';
import { WrestlersIcon } from './logo-images';
import { useQuery } from '@tanstack/react-query';
import { Button } from './ui/button';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';

async function apiRequest(method: string, url: string, body?: any) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response;
}

export default function Navbar() {
  const [location] = useLocation();
  const isCoachDashboard = location.startsWith('/coach');
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/auth/me");
        return response.json();
      } catch (error) {
        return null;
      }
    },
    retry: false
  });

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      toast({
        title: "Success",
        description: "Logged out successfully"
      });
      setLocation("/");
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to logout",
        variant: "destructive"
      });
    }
  };

  const isAuthenticated = user && (user.role === 'admin' || user.userType === 'Coach' || user.userType === 'Regional Supervisor');

  const isMobile = useIsMobile();

  return (
    <nav className="w-full absolute top-0 z-20 bg-transparent">
      <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6">
        <div className="h-14 sm:h-16 flex flex-row items-center justify-between">
          <a href="https://www.ratemyofficial.org" target="_blank" rel="noopener noreferrer" className="flex-shrink-0 flex items-center space-x-1 sm:space-x-2">
            <div className={`logo-text ${isMobile ? 'text-sm' : 'text-base sm:text-lg lg:text-xl'} font-medium text-white drop-shadow-lg`}>
              RateMyOfficial
            </div>
            <WrestlersIcon className="w-6 h-6 sm:w-8 sm:h-8 text-white drop-shadow-lg" />
          </a>
          <div className="flex items-center space-x-2 sm:space-x-4 lg:space-x-6">
            {!isAuthenticated ? (
              <>
                <Link href="/officials" className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg">
                  Officials
                </Link>
                <Link href="/register" className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg">
                  Register
                </Link>
                <Link href="/login" className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg">
                  Login
                </Link>
                <Link href="/admin" className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg">
                  Admin
                </Link>
              </>
            ) : (
              <>
                <Link href="/officials" className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg">
                  Officials
                </Link>
                {user?.role === 'admin' && (
                  <Link href="/admin">
                    <Button variant="ghost" size="sm" className="text-sm sm:text-base px-2 sm:px-3 text-white hover:text-white hover:bg-white/20">
                      Admin
                    </Button>
                  </Link>
                )}
                {user.userType === 'Regional Supervisor' && (
                  <Link href="/supervisor" className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg">
                    Supervisor
                  </Link>
                )}
                {user.userType === 'Coach' && (
                  <Link href="/coach" className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg">
                    Coach
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="text-sm sm:text-base text-white hover:text-gray-200 drop-shadow-lg cursor-pointer"
                >
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}