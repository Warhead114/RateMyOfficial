import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parse } from "date-fns"
import { formatInTimeZone } from "date-fns-tz"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Eastern Time Zone constant
export const EASTERN_TIME_ZONE = "America/New_York"

/**
 * Formats a date in Eastern Time Zone
 * @param date The date to format
 * @param formatStr The format string to use
 * @returns Formatted date string in Eastern Time
 */
export function formatInEastern(date: Date | string | number, formatStr: string = 'PPP'): string {
  try {
    if (typeof date === 'string' && !date.includes('T')) {
      // If it's a date-only string like "2025-03-24", append time for proper timezone handling
      date = `${date}T12:00:00.000Z`;
    }
    
    const dateObj = typeof date === 'string' || typeof date === 'number' 
      ? new Date(date) 
      : date;
      
    return formatInTimeZone(dateObj, EASTERN_TIME_ZONE, formatStr);
  } catch (error) {
    console.error("Error formatting date in Eastern timezone:", error);
    return "Invalid date";
  }
}

/**
 * Ensures a date is formatted for Eastern Time storage
 * @param dateInput The date input from a form
 * @returns Date string formatted for consistent storage
 */
export function formatDateForStorage(dateInput: string | Date): string {
  try {
    if (typeof dateInput === 'string') {
      // If it's already a string in YYYY-MM-DD format
      const [year, month, day] = dateInput.split('-').map(Number);
      // Create a date string for noon Eastern Time to avoid timezone issues
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00.000Z`;
    } else {
      // If it's a Date object, convert it to Eastern Time string
      return formatInTimeZone(dateInput, EASTERN_TIME_ZONE, "yyyy-MM-dd'T'12:00:00.000'Z'");
    }
  } catch (error) {
    console.error("Error formatting date for storage:", error);
    // Return original if there's an error
    return typeof dateInput === 'string' ? dateInput : dateInput.toISOString();
  }
}

/**
 * Converts 24-hour time format to 12-hour AM/PM format
 * @param time Time string in 24-hour format (HH:MM)
 * @returns Formatted time string in 12-hour format with AM/PM
 */
export function formatTimeTo12Hour(time: string): string {
  if (!time) return '';
  
  // Parse the time string (expected format: "HH:MM")
  const [hoursStr, minutes] = time.split(':');
  const hours = parseInt(hoursStr, 10);
  
  if (isNaN(hours)) return time; // Return original if parsing fails
  
  // Convert to 12-hour format
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12; // Convert 0 to 12 for 12 AM
  
  return `${hours12}:${minutes} ${period}`;
}
