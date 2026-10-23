import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AdminRegionEditorProps {
  isAdmin: boolean;
  recordId: number;
  region?: string | null;
  endpoint: string;
  suggestions?: string[];
  helpText: string;
  queryKeys: string[][];
  label?: string;
}

export function AdminRegionEditor({
  isAdmin,
  recordId,
  region,
  endpoint,
  suggestions = [],
  helpText,
  queryKeys,
  label = "Assigned region",
}: AdminRegionEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(region ?? "");
  const [savedValue, setSavedValue] = useState(region ?? "");
  const [errorMessage, setErrorMessage] = useState("");
  const datalistId = `region-options-${recordId}`;

  useEffect(() => {
    const nextRegion = region ?? "";
    setValue(nextRegion);
    setSavedValue(nextRegion);
    setErrorMessage("");
  }, [recordId, region]);

  const saveRegionMutation = useMutation({
    mutationFn: async (nextRegion: string) => {
      const response = await apiRequest("PATCH", endpoint, { region: nextRegion });
      return response.json();
    },
    onSuccess: async (updatedRecord) => {
      const updatedRegion =
        typeof updatedRecord?.region === "string" ? updatedRecord.region : value.trim();
      setValue(updatedRegion);
      setSavedValue(updatedRegion);
      setErrorMessage("");
      await Promise.all(
        queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      toast({
        title: "Region updated",
        description: "The assigned region has been saved.",
      });
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || "Could not save the assigned region. Please try again.");
      toast({
        title: "Region not saved",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!isAdmin) return null;

  const trimmedValue = value.trim();
  const handleSave = () => {
    if (saveRegionMutation.isPending) return;
    if (!trimmedValue) {
      setErrorMessage("Enter a region before saving.");
      return;
    }
    if (trimmedValue.length > 120) {
      setErrorMessage("Region must be 120 characters or fewer.");
      return;
    }
    if (trimmedValue === savedValue) return;
    setErrorMessage("");
    saveRegionMutation.mutate(trimmedValue);
  };

  return (
    <section className="mt-5 space-y-3 rounded-md border border-white/20 bg-black/20 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-white">Explicit region assignment</h3>
        <p className="text-sm text-white/70">{helpText}</p>
      </div>
      <div className="space-y-2">
        <label htmlFor={`region-input-${recordId}`} className="text-sm font-medium text-white">
          {label}
        </label>
        <Input
          id={`region-input-${recordId}`}
          name="region"
          list={datalistId}
          value={value}
          maxLength={120}
          autoComplete="off"
          placeholder="Enter or select a region"
          onChange={(event) => {
            setValue(event.target.value);
            setErrorMessage("");
          }}
          aria-describedby={`${datalistId}-help ${datalistId}-feedback`}
          aria-invalid={Boolean(errorMessage)}
          className="bg-black/30 border-white/20 text-white focus-visible:ring-white"
          disabled={saveRegionMutation.isPending}
        />
        <datalist id={datalistId}>
          {Array.from(new Set(suggestions.filter(Boolean))).map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <p id={`${datalistId}-help`} className="text-xs text-white/60">
          Choose a suggested association or enter an authoritative region label.
        </p>
        <p
          id={`${datalistId}-feedback`}
          role={errorMessage ? "alert" : "status"}
          aria-live="polite"
          className={`min-h-5 text-sm ${errorMessage ? "text-red-200" : "text-white/70"}`}
        >
          {errorMessage || (savedValue ? `Saved region: ${savedValue}` : "No region assigned yet.")}
        </p>
      </div>
      <Button
        type="button"
        onClick={handleSave}
        disabled={
          saveRegionMutation.isPending ||
          (trimmedValue.length > 0 && trimmedValue === savedValue)
        }
      >
        {saveRegionMutation.isPending ? "Saving region..." : "Save region"}
      </Button>
    </section>
  );
}
