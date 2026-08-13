import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";

import { ReportsLayout } from "../components/reports/reports-layout";
import {
  mockVisitationGeographyHouseholds,
  type MockHouseholdProperties,
} from "../dev/mock/visitation-geography-households";

const OTTAWA_GATINEAU_CENTER: [number, number] = [-75.6972, 45.4215];
const OPEN_STREET_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "openstreetmap-raster": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "\u00A9 OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "openstreetmap-raster",
      type: "raster",
      source: "openstreetmap-raster",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};
const REQUIRED_ATTRIBUTION = "\u00A9 OpenStreetMap contributors";
const HOUSEHOLD_SOURCE_ID = "mock-households";
const CLUSTER_LAYER_ID = "mock-household-clusters";
const CLUSTER_COUNT_LAYER_ID = "mock-household-cluster-count";
const HOUSEHOLD_LAYER_ID = "mock-household-points";
const CLUSTER_RADIUS = 56;
const CLUSTER_MAX_ZOOM = 13;
const CLUSTERED_SOURCE_ATTRIBUTION = "Mock household data";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const cloneMockHouseholdGeoJson = () =>
  JSON.parse(JSON.stringify(mockVisitationGeographyHouseholds)) as typeof mockVisitationGeographyHouseholds;

const installHouseholdLayers = (map: maplibregl.Map) => {
  if (map.getSource(HOUSEHOLD_SOURCE_ID)) {
    return;
  }

  const plainGeoJson = cloneMockHouseholdGeoJson();

  map.addSource(HOUSEHOLD_SOURCE_ID, {
    type: "geojson",
    attribution: CLUSTERED_SOURCE_ATTRIBUTION,
    data: plainGeoJson,
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
  });

  const clusteredSource = map.getSource(HOUSEHOLD_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  clusteredSource?.setData(cloneMockHouseholdGeoJson());

  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: HOUSEHOLD_SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#60a5fa",
        8,
        "#3b82f6",
        16,
        "#1d4ed8",
      ],
      "circle-radius": [
        "step",
        ["get", "point_count"],
        18,
        8,
        24,
        16,
        30,
      ],
      "circle-opacity": 0.88,
      "circle-stroke-color": "#eff6ff",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: HOUSEHOLD_SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count}",
      "text-size": 12,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  map.addLayer({
    id: HOUSEHOLD_LAYER_ID,
    type: "circle",
    source: HOUSEHOLD_SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "visited"], true],
        "#2563eb",
        "#f97316",
      ],
      "circle-radius": 8,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  map.moveLayer(CLUSTER_LAYER_ID);
  map.moveLayer(CLUSTER_COUNT_LAYER_ID);
  map.moveLayer(HOUSEHOLD_LAYER_ID);
};

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
      style: OPEN_STREET_MAP_STYLE,
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

    const handleClusterClick = (event: maplibregl.MapLayerMouseEvent) => {
      const clusterFeature = event.features?.[0];

      if (!clusterFeature || clusterFeature.geometry.type !== "Point") {
        return;
      }

      const clusterId = clusterFeature.properties?.cluster_id;
      const source = map.getSource(HOUSEHOLD_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const clusterCoordinates = clusterFeature.geometry.coordinates as [number, number];

      if ((typeof clusterId !== "number" && typeof clusterId !== "string") || !source) {
        return;
      }

      source.getClusterExpansionZoom(Number(clusterId)).then((zoom) => {
        map.easeTo({
          center: clusterCoordinates,
          zoom,
          duration: 500,
        });
      }).catch(() => {
        map.easeTo({
          center: clusterCoordinates,
          zoom: map.getZoom() + 2,
          duration: 500,
        });
      });
    };

    const handleHouseholdClick = (event: maplibregl.MapLayerMouseEvent) => {
      const householdFeature = event.features?.[0];

      if (!householdFeature || householdFeature.geometry.type !== "Point") {
        return;
      }

      const properties = householdFeature.properties as MockHouseholdProperties | undefined;

      if (!properties) {
        return;
      }

      const popupHtml = `
        <div style="min-width: 12rem; color: #10213d;">
          <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.35rem;">
            ${escapeHtml(properties.householdName)}
          </div>
          <div style="font-size: 0.82rem; line-height: 1.45;">
            <div><strong>Members:</strong> ${properties.memberCount}</div>
            <div><strong>Visited:</strong> ${properties.visited ? "Visited" : "Not visited"}</div>
            <div><strong>Visit count:</strong> ${properties.visitCount}</div>
          </div>
        </div>
      `;

      new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 14 })
        .setLngLat(householdFeature.geometry.coordinates as [number, number])
        .setHTML(popupHtml)
        .addTo(map);
    };

    const setPointerCursor = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const resetCursor = () => {
      map.getCanvas().style.cursor = "";
    };

    const bindInteractiveLayers = () => {
      installHouseholdLayers(map);

      map.off("click", CLUSTER_LAYER_ID, handleClusterClick);
      map.off("click", HOUSEHOLD_LAYER_ID, handleHouseholdClick);
      map.off("mouseenter", CLUSTER_LAYER_ID, setPointerCursor);
      map.off("mouseleave", CLUSTER_LAYER_ID, resetCursor);
      map.off("mouseenter", HOUSEHOLD_LAYER_ID, setPointerCursor);
      map.off("mouseleave", HOUSEHOLD_LAYER_ID, resetCursor);

      map.on("click", CLUSTER_LAYER_ID, handleClusterClick);
      map.on("click", HOUSEHOLD_LAYER_ID, handleHouseholdClick);
      map.on("mouseenter", CLUSTER_LAYER_ID, setPointerCursor);
      map.on("mouseleave", CLUSTER_LAYER_ID, resetCursor);
      map.on("mouseenter", HOUSEHOLD_LAYER_ID, setPointerCursor);
      map.on("mouseleave", HOUSEHOLD_LAYER_ID, resetCursor);
    };

    map.on("moveend", bindInteractiveLayers);
    map.on("load", bindInteractiveLayers);
    map.on("styledata", bindInteractiveLayers);

    mapRef.current = map;

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      map.off("moveend", bindInteractiveLayers);
      map.off("load", bindInteractiveLayers);
      map.off("styledata", bindInteractiveLayers);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <ReportsLayout
      title="Visitation Geography Report"
      subtitle="Explore clustered mock household points across Ottawa and Gatineau using local development data."
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card panel-shadow">
        <div className="border-b border-border/80 px-4 py-3 sm:px-5">
          <p className="text-sm text-muted-foreground">
            Zoom out to see clusters, zoom in to split them, and click a household marker to view mock visitation details.
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
