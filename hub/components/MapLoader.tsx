"use client";

import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";

function Opening() {
  const { t } = useI18n();
  return (
    <div className="map-page">
      <div className="map-message" role="status">
        <p>{t.maps.opening}</p>
      </div>
    </div>
  );
}

// The map uses WebGL and the browser: it loads only there, not while the site is being built.
const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <Opening /> });

export function MapLoader() {
  return <MapView />;
}
