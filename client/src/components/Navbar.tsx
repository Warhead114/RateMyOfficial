
import React from 'react';
import { Link } from 'wouter';

export default function Navbar() {
  return (
    <nav className="w-full bg-background border-b">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6">
        <div className="h-16 flex flex-row items-center justify-between">
          <Link href="/" className="flex-shrink-0">
            <div className="logo-text text-lg sm:text-xl font-medium">
              RateMyOfficial
            </div>
          </Link>
          <div className="flex items-center space-x-4 sm:space-x-6">
            <Link href="/register" className="text-sm hover:text-primary">Register</Link>
            <Link href="/login" className="text-sm hover:text-primary">Login</Link>
            <Link href="/admin" className="text-sm hover:text-primary">Admin</Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
