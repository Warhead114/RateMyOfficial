import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parse } from "date-fns"
import { formatInTimeZone } from "date-fns-tz"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Cache for image version to avoid repeated API calls
let imageVersionCache: string | null = null;
let imageVersionPromise: Promise<string> | null = null;

/**
 * Get the current image version from the server
 * This version changes on server restart, forcing cache invalidation
 */
async function getImageVersion(): Promise<string> {
  if (imageVersionCache) {
    return imageVersionCache;
  }

  if (imageVersionPromise) {
    return imageVersionPromise;
  }

  imageVersionPromise = fetch('/api/image-version')
    .then(res => res.json())
    .then(data => {
      imageVersionCache = data.version;
      imageVersionPromise = null;
      return data.version;
    })
    .catch(() => {
      imageVersionPromise = null;
      return Date.now().toString(); // Fallback to timestamp
    });

  return imageVersionPromise;
}

/**
 * Creates a versioned image URL that forces cache invalidation
 * @param url The original image URL
 * @returns A promise that resolves to the versioned URL
 */
export async function getVersionedImageUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;

  // Normalize path separators
  let normalizedUrl = url.replace(/\\/g, '/');

  // Ensure URL starts with /
  if (!normalizedUrl.startsWith('/') && !normalizedUrl.startsWith('http')) {
    normalizedUrl = `/${normalizedUrl}`;
  }

  // Get server version
  const version = await getImageVersion();

  // Add version parameter
  const separator = normalizedUrl.includes('?') ? '&' : '?';
  return `${normalizedUrl}${separator}v=${version}`;
}

/**
 * Synchronous version that uses timestamp fallback
 * Use this when you can't use async/await
 */
export function getVersionedImageUrlSync(url: string | undefined): string | undefined {
  if (!url) return undefined;

  // Normalize path separators
  let normalizedUrl = url.replace(/\\/g, '/');

  // Ensure URL starts with /
  if (!normalizedUrl.startsWith('/') && !normalizedUrl.startsWith('http')) {
    normalizedUrl = `/${normalizedUrl}`;
  }

  // Use cached version if available, otherwise use timestamp
  const version = imageVersionCache || Date.now().toString();

  // Add version parameter
  const separator = normalizedUrl.includes('?') ? '&' : '?';
  return `${normalizedUrl}${separator}v=${version}`;
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
      // If it's a date-only string like "2025-03-24", treat it as Eastern Time noon
      // to avoid timezone conversion issues that could shift the date
      const [year, month, day] = date.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day, 12, 0, 0);
      return formatInTimeZone(dateObj, EASTERN_TIME_ZONE, formatStr);
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
 * @returns Date string formatted for consistent storage (YYYY-MM-DD)
 */
export function formatDateForStorage(dateInput: string | Date): string {
  if (typeof dateInput === 'string') {
    // If it's already a string in YYYY-MM-DD format, return it as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return dateInput;
    }
    // Otherwise parse and format using UTC to avoid timezone shifts
    const d = new Date(dateInput);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  // For Date objects, use UTC methods to avoid timezone shifts
  const year = dateInput.getUTCFullYear();
  const month = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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