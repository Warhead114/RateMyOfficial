import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search } from "lucide-react";
import { Official } from "@shared/schema";

export default function SearchBar() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const { data: results } = useQuery<Official[]>({
    queryKey: [`/api/officials/search`, query],
    enabled: isSearching && query.length > 0
  });

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          placeholder="Search by name or location..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsSearching(true);
          }}
          onFocus={() => setIsSearching(true)}
        />
        <Button variant="secondary">
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {isSearching && query && (
        <Card className="absolute w-full mt-1 p-2 z-10">
          {results?.length === 0 ? (
            <div className="p-2 text-muted-foreground">No results found</div>
          ) : (
            <div className="space-y-1">
              {results?.map((official) => (
                <button
                  key={official.id}
                  className="w-full p-2 text-left hover:bg-accent rounded-lg"
                  onClick={() => {
                    setLocation(`/officials/${official.id}`);
                    setIsSearching(false);
                    setQuery("");
                  }}
                >
                  <div className="font-medium">{official.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {official.location}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
