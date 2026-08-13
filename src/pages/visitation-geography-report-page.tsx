import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";

import { ReportsLayout } from "../components/reports/reports-layout";

const OTTAWA_GATINEAU_CENTER: [number, number] = [-75.6972, 45.4215];
const OPEN_FREE_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const REQUIRED_ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";

export const VisitationGeographyReportPage = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      attributionControl: false,
      center: OTTAWA_GATINEAU_CENTER,
      container: mapContainerRef.current,
      style: OPEN_FREE_MAP_STYLE_URL,
      zoom: 9.4,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: REQUIRED_ATTRIBUTION,
      }),
      "bottom-right",
    );

    mapRef.current = map;

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <ReportsLayout
      title="Visitation Geography Report"
      subtitle="Explore the Ottawa/Gatineau area with a responsive map view for upcoming visitation geography work."
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card panel-shadow">
        <div className="border-b border-border/80 px-4 py-3 sm:px-5">
          <p className="text-sm text-muted-foreground">
            Pan and zoom the map to inspect the Ottawa/Gatineau region. Additional visitation layers will be added in later steps.
          </p>
        </div>
        <div className="p-3 sm:p-4">
          <div className="overflow-hidden rounded-lg border border-border/80 bg-background/40">
            <div
              className="h-[24rem] w-full min-w-0 sm:h-[30rem] lg:h-[calc(100vh-19rem)] lg:min-h-[34rem]"
              ref={mapContainerRef}
            />
          </div>
        </div>
      </section>
    </ReportsLayout>
  );
};
