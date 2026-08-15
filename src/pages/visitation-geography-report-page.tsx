import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import { useSearchParams } from "react-router-dom";

import type {
  VisitationAreaSummary,
  VisitationGeographyFeature,
  VisitationGeographyFeatureCollection,
  VisitationGeographyFeatureProperties,
} from "../../shared/types";
import { ReportsLayout } from "../components/reports/reports-layout";
import { EmptyState } from "../components/states/empty-state";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { getPeriodDateRange, type ReportPeriod } from "../components/reports/visitation-report-utils";
import { getDisplayErrorMessage, isApiConfigured } from "../lib/api";
import {
  useVisitationGeographyReport,
  type VisitationGeographyReportParams,
} from "../lib/visitation-geography-report";
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
const HOUSEHOLD_SOURCE_ID = "visitation-geography-households";
const CLUSTER_LAYER_ID = "visitation-geography-household-clusters";
const HOUSEHOLD_LAYER_ID = "visitation-geography-household-points";
const CLUSTER_RADIUS = 56;
const CLUSTER_MAX_ZOOM = 13;
const CLUSTERED_SOURCE_ATTRIBUTION = "Visitation household data";
const EMPTY_FEATURE_COLLECTION: VisitationGeographyFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
const ADDRESS_SEARCH_ZOOM = 15;

type NominatimSearchResult = {
  lat: string;
  lon: string;
  display_name?: string;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const cloneFeatureCollection = (featureCollection: VisitationGeographyFeatureCollection) =>
  JSON.parse(JSON.stringify(featureCollection)) as VisitationGeographyFeatureCollection;

const geocodeAddress = async (query: string, signal?: AbortSignal) => {
  const search = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    q: query,
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${search.toString()}`, {
    headers: {
      accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Address lookup failed with status ${response.status}.`);
  }

  const results = await response.json() as NominatimSearchResult[];
  const match = results[0];

  if (!match) {
    return null;
  }

  const latitude = Number(match.lat);
  const longitude = Number(match.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Address lookup returned invalid coordinates.");
  }

  return {
    coordinates: [longitude, latitude] as [number, number],
    label: match.display_name?.trim() || query,
  };
};

const getQueryPeriod = (params: URLSearchParams): ReportPeriod => {
  const period = params.get("period");

  if (
    period === "all_time"
    || period === "last_30_days"
    || period === "last_90_days"
    || period === "this_year"
    || period === "custom"
  ) {
    return period;
  }

  return "last_90_days";
};

const buildGeographyQueryParams = (params: URLSearchParams): VisitationGeographyReportParams => {
  const period = getQueryPeriod(params);
  const customFrom = params.get("from") || undefined;
  const customTo = params.get("to") || undefined;
  const range = getPeriodDateRange(period, customFrom, customTo);
  const type = params.get("type") || undefined;
  const visitorMode = params.get("visitorMode") || undefined;
  const visitorUserId = params.get("visitorUserId") || params.get("visitor") || undefined;

  return {
    from: range.from,
    to: range.to,
    sinceBeginning: range.sinceBeginning,
    type,
    visitorMode,
    visitorUserId,
  };
};

const formatMetricValue = (value: number) => new Intl.NumberFormat().format(value);

const formatOptionalDate = (value?: string) => {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
};

const formatHouseholdLabel = (memberNames: string[]) => {
  const names = memberNames.map((name) => name.trim()).filter(Boolean);
  if (!names.length) {
    return "Household members";
  }

  return names.join(", ");
};

const formatCompactAddress = (address?: string) => {
  const trimmed = address?.trim();
  return trimmed || "No address";
};

const formatLastVisitedBy = (name?: string) => {
  const trimmed = name?.trim();
  return trimmed ? ` by ${trimmed}` : "";
};

const renderMemberNameChips = (memberNames: string[]) => {
  const names = memberNames.map((name) => name.trim()).filter(Boolean);
  if (!names.length) {
    return "<span style=\"color:#64748b;font-size:0.76rem;\">No members</span>";
  }

  return names
    .map((name) => `
      <span style="
        display:inline-flex;
        align-items:center;
        border-radius:999px;
        background:#eff6ff;
        color:#1d4ed8;
        font-size:0.78rem;
        font-weight:500;
        line-height:1;
        padding:0.42rem 0.7rem;
        white-space:nowrap;
      ">
        ${escapeHtml(name)}
      </span>
    `)
    .join("");
};

const focusMapOnAreaHouseholds = (
  map: maplibregl.Map,
  areaFeatures: VisitationGeographyFeature[],
) => {
  if (!areaFeatures.length) {
    return;
  }

  if (areaFeatures.length === 1) {
    map.easeTo({
      center: areaFeatures[0].geometry.coordinates as [number, number],
      zoom: Math.max(map.getZoom(), 13),
      duration: 600,
    });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  for (const feature of areaFeatures) {
    bounds.extend(feature.geometry.coordinates as [number, number]);
  }

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: 64,
      duration: 700,
      maxZoom: 13.5,
    });
  }
};

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

  map.addSource(HOUSEHOLD_SOURCE_ID, {
    type: "geojson",
    attribution: CLUSTERED_SOURCE_ATTRIBUTION,
    data: EMPTY_FEATURE_COLLECTION,
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterProperties: {
      memberCount: ["+", ["coalesce", ["get", "memberCount"], 0]],
      visitedCount: ["+", ["coalesce", ["get", "visited"], 0]],
      visitCount: ["+", ["coalesce", ["get", "visitCount"], 0]],
    },
  });

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
        ["==", ["get", "visited"], 1],
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
  const [searchParams] = useSearchParams();
  const queryParams = useMemo(() => buildGeographyQueryParams(searchParams), [searchParams]);
  const reportQuery = useVisitationGeographyReport(queryParams);
  const report = reportQuery.data ?? null;
  const featureCollection = report?.households ?? EMPTY_FEATURE_COLLECTION;
  const areaSummaries = report?.areas ?? [];
  const hasMappedHouseholds = (report?.summary.mappedHouseholds ?? 0) > 0;
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const clusterMarkersRef = useRef<Record<string, maplibregl.Marker>>({});
  const activeClusterMarkersRef = useRef<Record<string, maplibregl.Marker>>({});
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSearchBusy, setAddressSearchBusy] = useState(false);
  const [addressSearchMessage, setAddressSearchMessage] = useState<string | null>(null);
  const [addressSearchError, setAddressSearchError] = useState<string | null>(null);
  const addressSearchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !hasMappedHouseholds) {
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

      const properties = householdFeature.properties as VisitationGeographyFeatureProperties | undefined;

      if (!properties) {
        return;
      }

      const popupHtml = `
        <div style="min-width:14rem; max-width:20rem; color:#10213d; padding:0.1rem 0;">
          <div style="font-size:0.82rem; font-weight:600; line-height:1.25; margin-bottom:0.55rem;">
            ${escapeHtml(formatCompactAddress(properties.normalizedAddress))}
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:0.42rem; margin-bottom:0.55rem;">
            ${renderMemberNameChips(properties.memberNames)}
          </div>
          <div style="color:#475569; font-size:0.74rem; line-height:1.25;">
            ${properties.memberCount} member${properties.memberCount === 1 ? "" : "s"} · ${properties.visited === 1 ? "Visited" : "Not visited"} · ${properties.visitCount} visit${properties.visitCount === 1 ? "" : "s"} · ${escapeHtml(formatOptionalDate(properties.lastVisitDate))}${escapeHtml(formatLastVisitedBy(properties.lastVisitedBy))}
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
      const householdSource = map.getSource(HOUSEHOLD_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      householdSource?.setData(cloneFeatureCollection(featureCollection));
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
  }, [featureCollection, hasMappedHouseholds]);

  useEffect(() => {
    if (!mapRef.current || !hasMappedHouseholds) {
      return;
    }

    const source = mapRef.current.getSource(HOUSEHOLD_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(cloneFeatureCollection(featureCollection));
  }, [featureCollection, hasMappedHouseholds]);

  const mappedFeaturesByAreaId = useMemo(() => {
    const areas = new Map<string, VisitationGeographyFeature[]>();

    for (const feature of featureCollection.features) {
      const areaId = feature.properties.areaId ?? "UNASSIGNED";
      const current = areas.get(areaId) ?? [];
      current.push(feature);
      areas.set(areaId, current);
    }

    return areas;
  }, [featureCollection]);

  const summary = report?.summary ?? null;
  const loadError = reportQuery.error
    ? getDisplayErrorMessage(reportQuery.error, "Unable to load the visitation geography report.")
    : null;

  const handleAddressZoom = async () => {
    const query = addressQuery.trim();
    if (!query || !mapRef.current) {
      return;
    }

    addressSearchAbortRef.current?.abort();
    const abortController = new AbortController();
    addressSearchAbortRef.current = abortController;

    setAddressSearchBusy(true);
    setAddressSearchError(null);
    setAddressSearchMessage(null);

    try {
      const result = await geocodeAddress(query, abortController.signal);

      if (!result) {
        setAddressSearchError("No matching address was found.");
        return;
      }

      mapRef.current.easeTo({
        center: result.coordinates,
        zoom: Math.max(mapRef.current.getZoom(), ADDRESS_SEARCH_ZOOM),
        duration: 700,
      });
      setSelectedAreaId(null);
      setAddressSearchMessage(`Zoomed to ${result.label}.`);
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      setAddressSearchError(getDisplayErrorMessage(error, "Unable to look up that address."));
    } finally {
      if (addressSearchAbortRef.current === abortController) {
        addressSearchAbortRef.current = null;
      }
      setAddressSearchBusy(false);
    }
  };

  useEffect(() => () => {
    addressSearchAbortRef.current?.abort();
  }, []);

  return (
    <ReportsLayout
      title="Visitation Geography Report"
      subtitle="Explore mapped households across Ottawa and Gatineau using visitation report data."
    >
      {!isApiConfigured ? (
        <ErrorState
          title="API configuration required"
          description="The visitation geography report needs a configured API endpoint before it can load mapped households."
        />
      ) : null}
      {summary ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <article className="rounded-lg border border-border bg-card p-4 panel-shadow">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Total Members</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{formatMetricValue(summary.totalMembers)}</div>
          </article>
          <article className="rounded-lg border border-border bg-card p-4 panel-shadow">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Total Households</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{formatMetricValue(summary.totalHouseholds)}</div>
          </article>
          <article className="rounded-lg border border-border bg-card p-4 panel-shadow">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Visited Households</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{formatMetricValue(summary.visitedHouseholds)}</div>
          </article>
          <article className="rounded-lg border border-border bg-card p-4 panel-shadow">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Not Visited</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{formatMetricValue(summary.notVisitedHouseholds)}</div>
          </article>
          <article className="rounded-lg border border-border bg-card p-4 panel-shadow">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Mapped / Unmapped</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {formatMetricValue(summary.mappedHouseholds)} / {formatMetricValue(summary.unmappedHouseholds)}
            </div>
          </article>
        </section>
      ) : null}
      {isApiConfigured && reportQuery.isLoading ? (
        <LoadingState
          title="Loading geography report"
          description="Preparing mapped households and visitation totals for the current report filters."
        />
      ) : null}
      {isApiConfigured && loadError ? (
        <ErrorState
          title="Unable to load geography report"
          description={loadError}
        />
      ) : null}
      {isApiConfigured && report && !hasMappedHouseholds ? (
        <EmptyState
          title="No mapped households yet"
          description="No households with saved coordinates matched the current report filters, so there is nothing to plot on the map."
        />
      ) : null}
      {isApiConfigured && report && hasMappedHouseholds ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card panel-shadow">
          <div className="border-b border-border/80 px-4 py-3 sm:px-5">
            <p className="text-sm text-muted-foreground">
              Zoom out to see clusters, zoom in to split them, and click a household marker to view visitation details.
            </p>
            <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
              <Input
                className="h-10"
                onChange={(event) => setAddressQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleAddressZoom();
                  }
                }}
                placeholder="Type an address to zoom the map"
                value={addressQuery}
              />
              <Button
                className="h-10 shrink-0 px-4 text-sm font-semibold"
                disabled={addressSearchBusy || !addressQuery.trim()}
                onClick={() => void handleAddressZoom()}
                type="button"
              >
                {addressSearchBusy ? "Finding address..." : "Zoom to address"}
              </Button>
            </div>
            {addressSearchError ? (
              <p className="mt-2 text-sm text-rose-600">{addressSearchError}</p>
            ) : null}
            {!addressSearchError && addressSearchMessage ? (
              <p className="mt-2 text-sm text-muted-foreground">{addressSearchMessage}</p>
            ) : null}
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
      ) : null}
      {isApiConfigured && report ? (
        <section className="rounded-lg border border-border bg-card panel-shadow">
          <div className="border-b border-border/80 px-4 py-3 sm:px-5">
            <p className="text-sm text-muted-foreground">
              Area summaries are currently classified by configurable postal-code FSA rules until verified polygon boundaries are available.
            </p>
          </div>
          <div className="p-3 sm:p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Area</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Households</TableHead>
                  <TableHead className="text-right">Visited</TableHead>
                  <TableHead className="text-right">Not Visited</TableHead>
                  <TableHead className="text-right">Visitations</TableHead>
                  <TableHead className="text-right">Coverage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {areaSummaries.map((area: VisitationAreaSummary) => {
                  const hasMappedAreaHouseholds = (mappedFeaturesByAreaId.get(area.areaId)?.length ?? 0) > 0;

                  return (
                    <TableRow
                      className={selectedAreaId === area.areaId ? "bg-muted/60" : undefined}
                      key={area.areaId}
                    >
                      <TableCell>
                        <button
                          className="text-left font-medium text-foreground transition hover:text-primary disabled:cursor-default disabled:text-foreground"
                          disabled={!hasMappedAreaHouseholds}
                          onClick={() => {
                            setSelectedAreaId(area.areaId);
                            if (!mapRef.current) {
                              return;
                            }

                            focusMapOnAreaHouseholds(mapRef.current, mappedFeaturesByAreaId.get(area.areaId) ?? []);
                          }}
                          type="button"
                        >
                          {area.areaName}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">{formatMetricValue(area.members)}</TableCell>
                      <TableCell className="text-right">{formatMetricValue(area.households)}</TableCell>
                      <TableCell className="text-right">{formatMetricValue(area.visited)}</TableCell>
                      <TableCell className="text-right">{formatMetricValue(area.notVisited)}</TableCell>
                      <TableCell className="text-right">{formatMetricValue(area.visitations)}</TableCell>
                      <TableCell className="text-right">{formatCoveragePercent(area.coverage)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </ReportsLayout>
  );
};
