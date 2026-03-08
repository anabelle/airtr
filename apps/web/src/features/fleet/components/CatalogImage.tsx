import type { AircraftModel } from "@acars/core";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCatalogImage } from "../hooks/useCatalogImage";

export function CatalogImage({
  model,
  fallback,
  className,
}: {
  model: AircraftModel;
  fallback: ReactNode;
  className?: string;
}) {
  const { imageUrl, isGenerating, error } = useCatalogImage(model);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={`${model.manufacturer} ${model.name} factory catalog view`}
        loading="lazy"
        className={className ?? "h-full w-full object-cover"}
      />
    );
  }

  if (isGenerating) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-foreground/60">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          Generating catalog image
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
        {fallback}
        <span className="absolute bottom-2 left-2 right-2 truncate text-center text-[9px] font-semibold uppercase tracking-wider text-foreground/50">
          Catalog photo unavailable
        </span>
      </div>
    );
  }

  return <>{fallback}</>;
}
