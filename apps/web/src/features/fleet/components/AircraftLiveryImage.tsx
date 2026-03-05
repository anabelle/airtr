import type { AircraftInstance, AircraftModel, AirlineEntity } from "@acars/core";
import { Loader2 } from "lucide-react";
import { useAircraftImage } from "../hooks/useAircraftImage";

interface AircraftLiveryImageProps {
  aircraft: AircraftInstance;
  airline: AirlineEntity | null;
  model: AircraftModel;
  isOwner: boolean;
  /** Fallback content rendered when no image is available (e.g., SVG silhouette) */
  fallback: React.ReactNode;
}

export function AircraftLiveryImage({
  aircraft,
  airline,
  model,
  isOwner,
  fallback,
}: AircraftLiveryImageProps) {
  const { imageUrl, isGenerating, error } = useAircraftImage(aircraft, airline, model, isOwner);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={`${airline?.name ?? "Airline"} ${model.manufacturer} ${model.name} livery`}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }

  if (isGenerating) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/60">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Generating livery…
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/40">
        {fallback}
        <span className="absolute bottom-1 text-[9px] text-red-400/70 px-1 truncate max-w-full">
          {error}
        </span>
      </div>
    );
  }

  return <>{fallback}</>;
}
