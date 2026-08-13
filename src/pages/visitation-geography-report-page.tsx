import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";

import { ReportsLayout } from "../components/reports/reports-layout";
import {
  mockVisitationGeographyHouseholds,
  type MockHouseholdProperties,
} from "../dev/mock/visitation-geography-households";
import {
  deriveClusterSummary,
  formatCoveragePercent,
  getClusterCoverageTone,
  type ClusterCoverageTone,
} from "../../shared/visitation-geography";

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

const getCoveragePalette = (tone: ClusterCoverageTone) => {
  switch (tone) {
    case "positive":
      return {
        accent: "var(--color-success)",
        background: "color-mix(in srgb, var(--color-success) 14%, var(--color-card) 86%)",
        border: "color-mix(in srgb, var(--color-success) 34%, var(--color-card) 66%)",
      };
    case "warning":
      return {
        accent: "var(--color-warning)",
        background: "color-mix(in srgb, var(--color-warning) 16%, var(--color-card) 84%)",
        border: "color-mix(in srgb, var(--color-warning) 38%, var(--color-card) 62%)",
      };
    default:
      return {
        accent: "#dc2626",
        background: "color-mix(in srgb, #dc2626 12%, var(--color-card) 88%)",
        border: "color-mix(in srgb, #dc2626 32%, var(--color-card) 68%)",
      };
  }
};

const updateClusterMarkerElement = (
  element: HTMLButtonElement,
  summary: ReturnType<typeof deriveClusterSummary>,
) => {
  const tone = getClusterCoverageTone(summary.coverage);
  const palette = getCoveragePalette(tone);

  element.dataset.summaryKey = [
    summary.households,
    summary.members,
    summary.visited,
    summary.visitations,
  ].join(":");
  element.style.background = palette.background;
  element.style.borderColor = palette.border;

  const householdsValue = element.querySelector<HTMLElement>("[data-role='households-value']");
  const householdsLabel = element.querySelector<HTMLElement>("[data-role='households-label']");
  const membersValue = element.querySelector<HTMLElement>("[data-role='members-value']");
  const coverageValue = element.querySelector<HTMLElement>("[data-role='coverage-value']");

  if (householdsValue) {
    householdsValue.textContent = String(summary.households);
    householdsValue.style.color = palette.accent;
  }
  if (householdsLabel) {
    householdsLabel.textContent = summary.households === 1 ? "household" : "households";
  }
  if (membersValue) {
    membersValue.textContent = `${summary.members} members`;
  }
  if (coverageValue) {
    coverageValue.textContent = `${formatCoveragePercent(summary.coverage)} coverage`;
    coverageValue.style.color = palette.accent;
  }
};

const createClusterMarkerElement = (
  summary: ReturnType<typeof deriveClusterSummary>,
  onClick: () => void,
) => {
  const button = document.createElement("button");
  button.type = "button";
  button.style.alignItems = "center";
  button.style.background = "var(--color-card)";
  button.style.backdropFilter = "blur(8px)";
  button.style.border = "1px solid var(--color-border)";
  button.style.borderRadius = "18px";
  button.style.boxShadow = "0 12px 28px rgba(15, 23, 42, 0.16)";
  button.style.cursor = "pointer";
  button.style.display = "flex";
  button.style.flexDirection = "column";
  button.style.gap = "2px";
  button.style.minWidth = "5.6rem";
  button.style.padding = "0.65rem 0.75rem";
  button.style.pointerEvents = "auto";
  button.style.textAlign = "center";

  const householdsValue = document.createElement("div");
  householdsValue.dataset.role = "households-value";
  householdsValue.style.fontSize = "1.1rem";
  householdsValue.style.fontWeight = "700";
  householdsValue.style.lineHeight = "1";

  const householdsLabel = document.createElement("div");
  householdsLabel.dataset.role = "households-label";
  householdsLabel.style.color = "var(--color-muted-foreground)";
  householdsLabel.style.fontSize = "0.68rem";
  householdsLabel.style.fontWeight = "600";
  householdsLabel.style.letterSpacing = "0.01em";
  householdsLabel.style.lineHeight = "1.05";
  householdsLabel.style.textTransform = "lowercase";

  const membersValue = document.createElement("div");
  membersValue.dataset.role = "members-value";
  membersValue.style.color = "var(--color-foreground)";
  membersValue.style.fontSize = "0.78rem";
  membersValue.style.fontWeight = "600";
  membersValue.style.lineHeight = "1.1";
  membersValue.style.marginTop = "0.18rem";

  const coverageValue = document.createElement("div");
  coverageValue.dataset.role = "coverage-value";
  coverageValue.style.fontSize = "0.78rem";
  coverageValue.style.fontWeight = "700";
  coverageValue.style.lineHeight = "1.1";

  button.append(householdsValue, householdsLabel, membersValue, coverageValue);
  updateClusterMarkerElement(button, summary);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
};

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
    clusterProperties: {
      memberCount: ["+", ["coalesce", ["get", "memberCount"], 0]],
      visitedCount: ["+", ["case", ["==", ["get", "visited"], true], 1, 0]],
      visitCount: ["+", ["coalesce", ["get", "visitCount"], 0]],
    },
  });

  const clusteredSource = map.getSource(HOUSEHOLD_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  clusteredSource?.setData(cloneMockHouseholdGeoJson());

  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: HOUSEHOLD_SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-radius": [
        "step",
        ["get", "point_count"],
        18,
        8,
        24,
        16,
        30,
      ],
      "circle-color": "#1f2937",
      "circle-opacity": 0.01,
      "circle-stroke-width": 0,
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
  map.moveLayer(HOUSEHOLD_LAYER_ID);
};

export const VisitationGeographyReportPage = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const clusterMarkersRef = useRef<Record<string, maplibregl.Marker>>({});
  const activeClusterMarkersRef = useRef<Record<string, maplibregl.Marker>>({});

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

    const renderClusterMarkers = () => {
      if (!map.getSource(HOUSEHOLD_SOURCE_ID) || !map.getLayer(CLUSTER_LAYER_ID)) {
        return;
      }

      const nextActiveMarkers: Record<string, maplibregl.Marker> = {};
      const clusterFeatures = map.queryRenderedFeatures(undefined, { layers: [CLUSTER_LAYER_ID] });

      for (const clusterFeature of clusterFeatures) {
        if (clusterFeature.geometry.type !== "Point") {
          continue;
        }

        const clusterId = clusterFeature.properties?.cluster_id;
        if (typeof clusterId !== "number" && typeof clusterId !== "string") {
          continue;
        }

        const markerKey = String(clusterId);
        if (nextActiveMarkers[markerKey]) {
          continue;
        }

        const summary = deriveClusterSummary({
          households: Number(clusterFeature.properties?.point_count ?? 0),
          memberCount: Number(clusterFeature.properties?.memberCount ?? 0),
          visitedCount: Number(clusterFeature.properties?.visitedCount ?? 0),
          visitCount: Number(clusterFeature.properties?.visitCount ?? 0),
        });
        const markerCoordinates = clusterFeature.geometry.coordinates as [number, number];
        const existingMarker = clusterMarkersRef.current[markerKey];
        const summaryKey = [
          summary.households,
          summary.members,
          summary.visited,
          summary.visitations,
        ].join(":");

        let marker = existingMarker;
        if (!marker || marker.getElement().dataset.summaryKey !== summaryKey) {
          existingMarker?.remove();
          const nextMarker = new maplibregl.Marker({
            anchor: "center",
            element: createClusterMarkerElement(summary, () => {
              const source = map.getSource(HOUSEHOLD_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
              if (!source) {
                return;
              }

              source.getClusterExpansionZoom(Number(clusterId)).then((zoom) => {
                map.easeTo({
                  center: markerCoordinates,
                  zoom,
                  duration: 500,
                });
              }).catch(() => {
                map.easeTo({
                  center: markerCoordinates,
                  zoom: map.getZoom() + 2,
                  duration: 500,
                });
              });
            }),
          }).setLngLat(markerCoordinates);

          clusterMarkersRef.current[markerKey] = nextMarker;
          marker = nextMarker;
        } else {
          updateClusterMarkerElement(marker.getElement() as HTMLButtonElement, summary);
          marker.setLngLat(markerCoordinates);
        }

        nextActiveMarkers[markerKey] = marker;
        if (!activeClusterMarkersRef.current[markerKey]) {
          marker.addTo(map);
        }
      }

      for (const [markerKey, marker] of Object.entries(activeClusterMarkersRef.current)) {
        if (!nextActiveMarkers[markerKey]) {
          marker.remove();
        }
      }

      activeClusterMarkersRef.current = nextActiveMarkers;
    };

    const bindInteractiveLayers = () => {
      installHouseholdLayers(map);
      renderClusterMarkers();

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

    map.on("render", renderClusterMarkers);
    map.on("moveend", bindInteractiveLayers);
    map.on("load", bindInteractiveLayers);
    map.on("styledata", bindInteractiveLayers);

    mapRef.current = map;

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      map.off("render", renderClusterMarkers);
      map.off("moveend", bindInteractiveLayers);
      map.off("load", bindInteractiveLayers);
      map.off("styledata", bindInteractiveLayers);
      for (const marker of Object.values(clusterMarkersRef.current)) {
        marker.remove();
      }
      clusterMarkersRef.current = {};
      activeClusterMarkersRef.current = {};
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
