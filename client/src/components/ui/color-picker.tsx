import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const [currentColor, setCurrentColor] = useState(color);
  const [isOpen, setIsOpen] = useState(false);
  const presetColors = [
    "#0f172a", // Navy (default)
    "#ef4444", // Red
    "#f97316", // Orange
    "#eab308", // Yellow
    "#10b981", // Green
    "#06b6d4", // Cyan
    "#3b82f6", // Blue
    "#8b5cf6", // Purple
    "#ec4899", // Pink
    "#6b7280", // Gray
  ];

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentColor(e.target.value);
  };

  const applyColor = () => {
    onChange(currentColor);
    setIsOpen(false);
  };

  const selectPresetColor = (presetColor: string) => {
    setCurrentColor(presetColor);
    onChange(presetColor);
  };

  useEffect(() => {
    setCurrentColor(color);
  }, [color]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          className="w-[100px] justify-start text-left font-normal"
          style={{ 
            backgroundColor: currentColor, 
            color: isLightColor(currentColor) ? 'black' : 'white'
          }}
        >
          {currentColor}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-4">
        <div className="space-y-4">
          <div className="w-full">
            <div 
              className="w-full h-10 rounded-md mb-2" 
              style={{ backgroundColor: currentColor }}
            />
            <Input
              type="color"
              value={currentColor}
              onChange={handleColorChange}
              className="w-full h-10"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {presetColors.map((presetColor) => (
              <button
                key={presetColor}
                className="w-6 h-6 rounded-md border cursor-pointer"
                style={{ backgroundColor: presetColor }}
                onClick={() => selectPresetColor(presetColor)}
                aria-label={`Select color ${presetColor}`}
              />
            ))}
          </div>
          <div className="flex justify-between">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={applyColor}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Helper function to determine if a color is light or dark
function isLightColor(color: string): boolean {
  // Convert hex to RGB
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Calculate luminance (perceived brightness)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Return true if color is light (luminance > 0.5)
  return luminance > 0.5;
}