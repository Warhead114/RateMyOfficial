import fs from 'fs';
import path from 'path';
import { storage } from './storage';

// Try to import canvas with error handling to make deployment more robust
let createCanvas: any;
let loadImage: any;
let canvasAvailable = true;

try {
  const canvas = require('canvas');
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
} catch (error) {
  console.error('Canvas module could not be loaded. Image analysis will be disabled:', error);
  canvasAvailable = false;
}

/**
 * Analyzes an image to determine if it's dark or light
 * @param imagePath Path to the image file
 * @returns Promise resolving to true if image is dark, false if light
 */
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB limit

export async function validateAndCompressImage(imagePath: string): Promise<boolean> {
  try {
    // Check if the file exists
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }
    
    const stats = fs.statSync(imagePath);
    if (stats.size > MAX_IMAGE_SIZE) {
      throw new Error('Image size exceeds 2MB limit');
    }
    return true;
  } catch (error) {
    console.error(`Error validating image ${imagePath}:`, error);
    throw error;
  }
}

export async function analyzeBrightness(imagePath: string): Promise<boolean> {
  // If canvas is not available, skip analysis and return a default
  if (!canvasAvailable) {
    console.log('Canvas not available for image analysis, returning default (false)');
    return false;
  }
  
  try {
    // First check if path is relative
    const fullPath = imagePath.startsWith('/') 
      ? path.join(process.cwd(), imagePath.substring(1)) 
      : imagePath;
    
    // Check if the file exists
    if (!fs.existsSync(fullPath)) {
      console.error(`Image file not found: ${fullPath}`);
      return false;
    }
    
    // Load the image
    const image = await loadImage(fullPath);
    
    // Create a canvas with the same dimensions as the image
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    
    // Draw the image on the canvas
    ctx.drawImage(image, 0, 0);
    
    // Sample pixels from the image (we'll sample a grid of points)
    const sampleSize = Math.min(20, Math.min(image.width, image.height)); // Sample up to 20x20 grid
    const stepX = Math.max(1, Math.floor(image.width / sampleSize));
    const stepY = Math.max(1, Math.floor(image.height / sampleSize));
    
    let totalBrightness = 0;
    let sampleCount = 0;
    
    // Sample brightness across the image
    for (let y = 0; y < image.height; y += stepY) {
      for (let x = 0; x < image.width; x += stepX) {
        const pixelData = ctx.getImageData(x, y, 1, 1).data;
        // Calculate relative luminance using the formula for perceived brightness
        // https://www.w3.org/TR/WCAG20/#relativeluminancedef
        const r = pixelData[0] / 255;
        const g = pixelData[1] / 255;
        const b = pixelData[2] / 255;
        
        // Relative luminance formula
        const brightness = 
          0.2126 * (r <= 0.03928 ? r/12.92 : Math.pow((r+0.055)/1.055, 2.4)) +
          0.7152 * (g <= 0.03928 ? g/12.92 : Math.pow((g+0.055)/1.055, 2.4)) +
          0.0722 * (b <= 0.03928 ? b/12.92 : Math.pow((b+0.055)/1.055, 2.4));
        
        totalBrightness += brightness;
        sampleCount++;
      }
    }
    
    // Calculate average brightness
    const averageBrightness = totalBrightness / sampleCount;
    
    // Determine if image is dark or light (threshold at 0.5 on a 0-1 scale)
    const isDark = averageBrightness < 0.5;
    
    console.log(`Image ${imagePath} analyzed: average brightness=${averageBrightness.toFixed(2)}, isDark=${isDark}`);
    
    return isDark;
  } catch (error) {
    console.error(`Error analyzing image brightness for ${imagePath}:`, error);
    // Default to false (assume light) if analysis fails
    return false;
  }
}

/**
 * Analyzes a background image and saves the result to settings
 * @param imagePath Path to the image file
 */
export async function analyzeAndSaveBackgroundBrightness(imagePath: string): Promise<void> {
  try {
    // Check if canvas is available
    if (!canvasAvailable) {
      console.log('Canvas not available for background image analysis, using default setting');
      await storage.updateSetting("backgroundIsDark", "false");
      return;
    }
    
    const isDark = await analyzeBrightness(imagePath);
    await storage.updateSetting("backgroundIsDark", isDark.toString());
    console.log(`Background image brightness analysis saved: isDark=${isDark}`);
  } catch (error) {
    console.error('Error saving background brightness analysis:', error);
    // In case of error, set a default value
    try {
      await storage.updateSetting("backgroundIsDark", "false");
    } catch (settingError) {
      console.error('Failed to set default background brightness:', settingError);
    }
  }
}