import Map from "https://js.arcgis.com/5.1/@arcgis/core/Map.js";
import SceneView from "https://js.arcgis.com/5.1/@arcgis/core/views/SceneView.js";
import FeatureLayer from "https://js.arcgis.com/5.1/@arcgis/core/layers/FeatureLayer.js";
import TileLayer from "https://js.arcgis.com/5.1/@arcgis/core/layers/TileLayer.js";
import GraphicsLayer from "https://js.arcgis.com/5.1/@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "https://js.arcgis.com/5.1/@arcgis/core/Graphic.js";
import Polyline from "https://js.arcgis.com/5.1/@arcgis/core/geometry/Polyline.js";
import Point from "https://js.arcgis.com/5.1/@arcgis/core/geometry/Point.js";
import { createIcons, Flame, RotateCcw } from "https://esm.sh/lucide@0.468.0";
import Zoom from "https://js.arcgis.com/5.1/@arcgis/core/widgets/Zoom.js";
import * as geometryEngine from "https://js.arcgis.com/5.1/@arcgis/core/geometry/geometryEngine.js";
import esriConfig from "https://js.arcgis.com/5.1/@arcgis/core/config.js";
import OAuthInfo from "https://js.arcgis.com/5.1/@arcgis/core/identity/OAuthInfo.js";
import esriId from "https://js.arcgis.com/5.1/@arcgis/core/identity/IdentityManager.js";

/* ============================================================
   SIGN IN — OAuth 2.0 user auth, same-window redirect
   Register the app in ArcGIS Online (Content > New item >
   Developer credentials > OAuth 2.0) and add both redirect URLs:
     http://127.0.0.1:5500/index.html      (VS Code Live Server)
     https://ntodd90.github.io/supply-chain/
   ============================================================ */

const AUTH = {
  portalUrl: "https://esri-cgs.maps.arcgis.com",
  appId: "LZIeF68xC2wTZeEr"
};

esriConfig.portalUrl = AUTH.portalUrl;
esriId.registerOAuthInfos([
  new OAuthInfo({ appId: AUTH.appId, portalUrl: AUTH.portalUrl, popup: false })
]);
const SHARING_URL = AUTH.portalUrl + "/sharing";
try {
  await esriId.checkSignInStatus(SHARING_URL);
} catch {
  await esriId.getCredential(SHARING_URL); // redirects to ArcGIS sign-in, returns here signed in
}

/* ============================================================
   DATA SOURCES
   Nodes:       SupplyChainDataModel  (points — facilities)
   Connections: Thicc_lines2          (lines — trade flow, volume-weighted)
   (Enriched_connections is the same schema with flat styling —
   intentionally left out here since Thicc_lines2 already carries
   the volume-weighted look and an extra "Importance" field.)
   ============================================================ */

const NODES_URL =
  "https://services1.arcgis.com/VKXrirzMEEFbJou8/arcgis/rest/services/SupplyChainDataModel/FeatureServer/0";
const CONNECTIONS_URL =
  "https://services1.arcgis.com/VKXrirzMEEFbJou8/arcgis/rest/services/Thicc_lines2/FeatureServer/0";
const RISK_NODES_URL =
  "https://services1.arcgis.com/VKXrirzMEEFbJou8/arcgis/rest/services/SupplyChainDataModel_Risk_symbology/FeatureServer/0";

/* ============================================================
   VISUAL LANGUAGE — mirrors the CSS tokens in style.css
   ============================================================ */

const NODE_TYPES = [
  { value: "Tier 3 Supplier", label: "Tier 3 Supplier", color: "#27b58f", icon: "raw" },
  { value: "Tier 2 Supplier", label: "Tier 2 Supplier", color: "#a64ed1", icon: "component" },
  { value: "Tier 1 Supplier", label: "Tier 1 Supplier", color: "#27a7c7", icon: "assembly" },
  { value: "Plant", label: "Plant", color: "#e86f42", icon: "plant" },
  { value: "DC", label: "Distribution Center", color: "#8a9b55", icon: "warehouse" },
  { value: "Store", label: "Store", color: "#ff4f5e", icon: "store" },
];

const RISK_LEVELS = [
  { value: "Low", color: "#4fb6a8" },
  { value: "Medium", color: "#e8a33d" },
  { value: "High", color: "#e2603f" },
  { value: "Critical", color: "#d32f2f" },
];
const RISK_FALLBACK_COLOR = "#55617a";

const FLOW_BREAKS = [
  { max: 149625, color: [79, 182, 168, 0.72], width: 0.75, label: "Up to 150K" },
  { max: 499500, color: [91, 143, 214, 0.82], width: 1.5, label: "150K–500K" },
  { max: 1624999.95, color: [232, 163, 61, 0.9], width: 2.5, label: "500K–1.6M" },
  { max: 16999999.95, color: [226, 96, 63, 0.94], width: 3.5, label: "1.6M–17M" },
  { max: 62499999.9, color: [186, 63, 50, 1], width: 5, label: "17M+" },
];

function circleSymbol(color, size) {
  return {
    type: "simple-marker",
    style: "circle",
    color,
    size,
    outline: { color: "#0b1220", width: 0.75 },
  };
}

const NODE_ICON_PATHS = {
  raw: '<path d="M7 8h10v8H7zM9 6h6v2H9zM9 10v4M12 10v4M15 10v4"/>',
  component: '<path d="M6 9h12M8 6v12M16 6v12M6 15h12M9 9l6 6M15 9l-6 6"/>',
  assembly: '<path d="M6 7h5v5H6zM13 12h5v5h-5zM11 9h2v5h-2zM9 12h5"/>',
  plant: '<path d="M5 17V9l4 2V8l4 2V6l6 4v7H5zM8 14h2v3H8zM13 14h2v3h-2z"/>',
  warehouse: '<path d="M5 10l7-4 7 4v8H5zM8 12h2v3H8zM11 12h2v3h-2zM14 12h2v3h-2z"/>',
  store: '<path d="M6 9h12l-1 3H7L6 9zM8 12v5h8v-5M10 14h4v3h-4z"/>',
};

function nodeSymbol(nodeType) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
    <polygon points="7,1.5 17,1.5 22.5,12 17,22.5 7,22.5 1.5,12" fill="${nodeType.color}" stroke="#0b1220" stroke-width="1.5"/>
    <g fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${NODE_ICON_PATHS[nodeType.icon]}</g>
  </svg>`;
  return {
    type: "picture-marker",
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: 20,
    height: 20,
  };
}

function riskSymbol(color, icon) {
  const iconPath = icon === "check"
    ? '<path d="M7 12l3 3 7-7"/>'
    : icon === "alert"
      ? '<path d="M12 6v7M12 16v1"/>'
      : '<path d="M12 6v8M12 17v1"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
    <polygon points="7,1.5 17,1.5 22.5,12 17,22.5 7,22.5 1.5,12" fill="${color}" stroke="#0b1220" stroke-width="1.5"/>
    <g fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>
  </svg>`;
  return {
    type: "picture-marker",
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: 24,
    height: 24,
  };
}

function nodeTypeColor(nodeType) {
  return NODE_TYPES.find((type) => type.value === nodeType)?.color ?? "#edeff3";
}

const typeRenderer = {
  type: "unique-value",
  field: "NodeType",
  defaultSymbol: circleSymbol("#55617a", 6),
  uniqueValueInfos: NODE_TYPES.map((t) => ({
    value: t.value,
    symbol: nodeSymbol(t),
  })),
};

const riskRenderer = {
  type: "unique-value",
  field: "Risk_Symbol",
  defaultSymbol: riskSymbol(RISK_FALLBACK_COLOR, "?"),
  uniqueValueInfos: RISK_LEVELS.map((r) => ({
    value: r.value,
    symbol: riskSymbol(r.color, r.value === "Low" ? "check" : "alert"),
  })),
};

const flowRenderer = {
  type: "class-breaks",
  field: "Transfer_Volume",
  defaultSymbol: { type: "simple-line", color: [232, 163, 61, 0.2], width: 0.5 },
  classBreakInfos: FLOW_BREAKS.map((b, i) => ({
    minValue: i === 0 ? 0 : FLOW_BREAKS[i - 1].max,
    maxValue: b.max,
    symbol: { type: "simple-line", color: b.color, width: b.width, cap: "round" },
  })),
};

/* ============================================================
   POPUPS
   ============================================================ */

const MONEY_FIELDS = new Set(["NodePrice", "Transfer_Cost"]);

function popRow(label, value, className = "") {
  if (value === null || value === undefined || value === "") return "";
  return `<div class="row"><span class="k">${label}</span><span class="v ${className}">${value}</span></div>`;
}

function popupLabel(field) {
  return field.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function popupValue(field, value) {
  if (value === null || value === undefined || value === "") return null;
  if (MONEY_FIELDS.has(field)) {
    return {
      value: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)),
      className: "money",
    };
  }
  return {
    value: typeof value === "number" ? value.toLocaleString("en-US") : value,
    className: "",
  };
}

const nodesPopupTemplate = {
  title: "{NodeName}",
  content: async (feature) => {
    const a = feature.graphic.attributes;
    const div = document.createElement("div");
    div.className = "pop-grid";
    div.innerHTML = Object.entries(a)
      .filter(([field]) => !/^OBJECTID(?:_\d+)?$/i.test(field))
      .map(([field, value]) => {
        const formatted = popupValue(field, value);
        return formatted ? popRow(popupLabel(field), formatted.value, formatted.className) : "";
      }).join("");

    try {
      const relatedRoutes = await routeLayer.queryFeatures({
        geometry: geometryEngine.buffer(feature.graphic.geometry, 0.5, "kilometers"),
        spatialRelationship: "intersects",
        where: "1=1",
        outFields: ["OBJECTID", "Transfer_Volume", "Transfer_Cost"],
        returnGeometry: false,
      });
      const routeRows = relatedRoutes.features.map((route, index) => {
        const routeAttributes = route.attributes;
        const volume = routeAttributes.Transfer_Volume != null
          ? routeAttributes.Transfer_Volume.toLocaleString("en-US")
          : "N/A";
        const cost = routeAttributes.Transfer_Cost != null
          ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(routeAttributes.Transfer_Cost)
          : "N/A";
        return `<div class="transfer-row"><span>Transfer ${index + 1}</span><span>${volume} units · <b class="money">${cost}</b></span></div>`;
      }).join("");
      const totals = relatedRoutes.features.reduce((summary, route) => {
        summary.volume += Number(route.attributes.Transfer_Volume) || 0;
        summary.cost += Number(route.attributes.Transfer_Cost) || 0;
        return summary;
      }, { volume: 0, cost: 0 });
      div.insertAdjacentHTML("beforeend", `<div class="transfer-section"><div class="transfer-title">Related transfers</div><div class="transfer-total"><span>Total</span><span>${totals.volume.toLocaleString("en-US")} units · <b class="money">${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totals.cost)}</b></span></div>${routeRows || '<div class="transfer-empty">No transfer values available</div>'}</div>`);
    } catch (error) {
      div.insertAdjacentHTML("beforeend", '<div class="transfer-section"><div class="transfer-title">Related transfers</div><div class="transfer-empty">Transfer values unavailable</div></div>');
    }
    return div;
  },
};

const connectionsPopupTemplate = {
  title: "Transfer route",
  content: (feature) => {
    const a = feature.graphic.attributes;
    const div = document.createElement("div");
    div.className = "pop-grid";
    const transferCost = popupValue("Transfer_Cost", a.Transfer_Cost);
    div.innerHTML = [
      popRow("Transfer volume", a.Transfer_Volume?.toLocaleString?.() ?? a.Transfer_Volume),
      transferCost ? popRow("Transfer cost", transferCost.value, transferCost.className) : "",
      popRow("Importance", a.Importance),
    ].join("");
    return div;
  },
};

/* ============================================================
   LAYERS
   ============================================================ */

const nodesLayer = new FeatureLayer({
  url: NODES_URL,
  title: "Facilities",
  renderer: typeRenderer,
  popupTemplate: nodesPopupTemplate,
  outFields: ["*"],
  minScale: 0,
  maxScale: 0,
  elevationInfo: { mode: "relative-to-ground", offset: 8, unit: "meters" },
});

const riskNodesLayer = new FeatureLayer({
  url: RISK_NODES_URL,
  title: "Risk-scored facilities",
  renderer: riskRenderer,
  popupTemplate: nodesPopupTemplate,
  visible: false,
  outFields: ["*"],
  minScale: 0,
  maxScale: 0,
  elevationInfo: { mode: "relative-to-ground", offset: 8, unit: "meters" },
});

const generatedStoreLinksLayer = new GraphicsLayer({
  title: "DC-to-store transfers",
  visible: false,
  elevationInfo: { mode: "relative-to-ground", offset: 20, unit: "meters" },
  renderer: {
    type: "class-breaks",
    field: "Transfer_Volume",
    defaultSymbol: { type: "simple-line", color: [255, 79, 94, 0.95], width: 3 },
    classBreakInfos: [
      { minValue: 0, maxValue: 5000, symbol: { type: "simple-line", color: [255, 79, 94, 0.9], width: 3 } },
      { minValue: 5000, maxValue: 25000, symbol: { type: "simple-line", color: [255, 79, 94, 0.95], width: 5 } },
      { minValue: 25000, maxValue: 999999999, symbol: { type: "simple-line", color: [255, 79, 94, 1], width: 8 } },
    ],
  },
  popupTemplate: {
    title: "Generated DC-to-store transfer",
    content: (feature) => {
      const attributes = feature.graphic.attributes;
      return `<div class="pop-grid"><div class="row"><span class="k">Transfer volume</span><span class="v">${attributes.Transfer_Volume.toLocaleString("en-US")}</span></div><div class="row"><span class="k">Transfer cost</span><span class="v money">$${attributes.Transfer_Cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div><div class="row"><span class="k">Data status</span><span class="v">Estimated</span></div></div>`;
    },
  },
});

const connectionsLayer = new FeatureLayer({
  url: CONNECTIONS_URL,
  title: "Transfer routes",
  renderer: flowRenderer,
  popupTemplate: connectionsPopupTemplate,
  visible: false,
  outFields: ["*"],
});

let routeLayer = connectionsLayer;

const highwaysLayer = new TileLayer({
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer",
  title: "Major highways",
  opacity: 0.7,
});

/* ============================================================
   NARRATIVE — the manifest steps that drive the demo
   ============================================================ */

const ALL_TYPES = NODE_TYPES.map((t) => t.value);

const STEPS = [
  {
    code: "MF-01",
    title: "The Network",
    body:
      "Every facility in the network — from raw-material suppliers to storefronts — plotted at once. Nothing is connected yet; this is simply where the business exists in the world.",
    tag: "REVEALS · All facility types",
    types: ALL_TYPES,
    connections: false,
    risk: false,
  },
  {
    code: "MF-02",
    title: "Upstream Supply",
    body:
      "Three tiers of suppliers feed the plants: raw materials at Tier 3, sub-components at Tier 2, and Tier 1 partners who assemble subsystems closest to manufacturing.",
    tag: "REVEALS · Tier 1–3 Suppliers",
    types: ["Tier 3 Supplier", "Tier 2 Supplier", "Tier 1 Supplier"],
    connections: false,
    risk: false,
  },
  {
    code: "MF-03",
    title: "Manufacturing",
    body:
      "Tier 1 suppliers ship components into the plants. Line weight below reflects transfer volume — the heavier the route, the more moves through it.",
    tag: "REVEALS · Supplier → Plant flow",
    types: ["Tier 3 Supplier", "Tier 2 Supplier", "Tier 1 Supplier", "Plant"],
    connections: true,
    risk: false,
  },
  {
    code: "MF-04",
    title: "Distribution",
    body:
      "From the plant floor, product moves out through distribution centers and onward to customers.",
    tag: "REVEALS · Plant → DC",
    types: ["Plant", "DC"],
    connections: true,
    risk: false,
  },
  {
    code: "MF-05",
    title: "Last Mile",
    body: "The final leg of the journey: distribution centers to storefronts.",
    tag: "REVEALS · DC → Store",
    types: ["DC", "Store"],
    connections: true,
    risk: false,
  },
  {
    code: "MF-06",
    title: "Full Network",
    body:
      "Every tier, every leg, together — the complete flow of goods from raw material to shelf.",
    tag: "REVEALS · Full network",
    types: ALL_TYPES,
    connections: true,
    risk: false,
  },
  {
    code: "MF-07",
    title: "Risk Exposure",
    body:
      "Each facility carries a risk score built from four factors — infrastructure issues, natural hazards, transportation incidents, and civil unrest. Red nodes are where a contingency plan matters most.",
    tag: "REVEALS · Risk score by facility",
    types: ALL_TYPES,
    connections: true,
    risk: true,
  },
];

/* ============================================================
   STATE
   ============================================================ */

let currentStep = 0;
let activeTypes = new Set(STEPS[0].types);
let connectionsOn = STEPS[0].connections;
let riskMode = STEPS[0].risk;
let focusedNodeIds = null;
let focusedRouteIds = null;
let focusedNodePoint = null;
let manufacturingRouteIds = null;

async function generateStoreLinks() {
  const result = await nodesLayer.queryFeatures({
    where: "NodeType IN ('DC', 'Store')",
    outFields: ["OBJECTID", "NodeName", "NodeType"],
    returnGeometry: true,
  });
  const distributionCenters = result.features.filter((feature) => feature.attributes.NodeType === "DC");
  const stores = result.features.filter((feature) => feature.attributes.NodeType === "Store");

  stores.forEach((store, index) => {
    let nearestCenter;
    let nearestDistance = Infinity;
    distributionCenters.forEach((center) => {
      const distance = geometryEngine.distance(store.geometry, center.geometry, "kilometers");
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCenter = center;
      }
    });
    if (!nearestCenter) return;

    const volume = 2500 + ((store.attributes.OBJECTID * 7919) % 47500);
    const cost = volume * (1.25 + ((index * 17) % 160) / 100);
    generatedStoreLinksLayer.add(new Graphic({
      geometry: new Polyline({
        paths: [[
          [nearestCenter.geometry.x, nearestCenter.geometry.y],
          [store.geometry.x, store.geometry.y],
        ]],
        spatialReference: store.geometry.spatialReference,
      }),
      attributes: {
        OBJECTID: -(index + 1),
        Transfer_Volume: volume,
        Transfer_Cost: cost,
        Source: "Estimated DC-to-store link",
      },
    }));
  });
}

/* ============================================================
   RENDER: manifest rail
   ============================================================ */

const stepsEl = document.getElementById("manifest-steps");
const progressEl = document.getElementById("progress-label");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

function renderManifest() {
  stepsEl.innerHTML = STEPS.map((s, i) => {
    const cls = i === currentStep ? "active" : i < currentStep ? "done" : "";
    return `
      <div class="manifest-step ${cls}" data-index="${i}">
        <span class="checkpoint"></span>
        <div class="step-code">${s.code}</div>
        <div class="step-title">${s.title}</div>
        <div class="step-body">${s.body}</div>
        <div class="step-tag">${s.tag}</div>
      </div>`;
  }).join("");

  stepsEl.querySelectorAll(".manifest-step").forEach((el) => {
    el.addEventListener("click", () => goToStep(Number(el.dataset.index)));
  });

  progressEl.textContent = `STEP ${String(currentStep + 1).padStart(2, "0")} / ${String(
    STEPS.length
  ).padStart(2, "0")}`;
  prevBtn.disabled = currentStep === 0;
  nextBtn.disabled = currentStep === STEPS.length - 1;
}

/* ============================================================
   RENDER: layer toggle chips
   ============================================================ */

const chipsEl = document.getElementById("layer-chips");

function renderChips() {
  const typeChips = NODE_TYPES.map((t) => {
    const on = activeTypes.has(t.value);
    return `<div class="chip ${on ? "on" : ""}" data-type="${t.value}">
      <span class="swatch" style="background:${t.color}"></span>${t.label}
    </div>`;
  }).join("");

  const connChip = `<div class="chip ${connectionsOn ? "on" : ""}" data-conn="1">
    <span class="swatch" style="background:#e8a33d"></span>Transfer routes
  </div>`;

  chipsEl.innerHTML = typeChips + connChip;

  chipsEl.querySelectorAll("[data-type]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.dataset.type;
      activeTypes.has(v) ? activeTypes.delete(v) : activeTypes.add(v);
      applyState();
    });
  });
  chipsEl.querySelector("[data-conn]").addEventListener("click", () => {
    connectionsOn = !connectionsOn;
    applyState();
  });
}

/* ============================================================
   RENDER: legend
   ============================================================ */

const legendRowsEl = document.getElementById("legend-rows");
const volumeTotalEl = document.getElementById("volume-total");
const costTotalEl = document.getElementById("cost-total");
const statsScopeEl = document.getElementById("stats-scope");
const statsFootEl = document.getElementById("stats-foot");
const clearSelectionBtn = document.getElementById("clear-selection");

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return "NO DATA";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "NO DATA";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

let statsRequest = 0;

function clearSelection(preserveView = false) {
  focusedNodeIds = null;
  focusedRouteIds = null;
  focusedNodePoint = null;
  const step = STEPS[currentStep];
  activeTypes = new Set(step.types);
  connectionsOn = step.connections;
  riskMode = step.risk;
  applyState(preserveView);
}

async function refreshStats() {
  if (!view) return;

  const requestId = ++statsRequest;
  const extent = view.extent;
  const filterLabel = activeTypes.size === ALL_TYPES.length
    ? "ALL FACILITIES"
    : `${activeTypes.size} FACILITY TYPES`;
  statsScopeEl.textContent = filterLabel;

  if (!connectionsOn) {
    volumeTotalEl.textContent = "--";
    costTotalEl.textContent = "--";
    statsFootEl.textContent = "Transfer routes hidden";
    return;
  }

  statsFootEl.textContent = "Calculating visible routes...";

  try {
    const result = await routeLayer.queryFeatures({
      geometry: extent,
      spatialRelationship: "intersects",
      where: routeLayer.definitionExpression || "1=1",
      outFields: ["Transfer_Volume", "Transfer_Cost"],
      returnGeometry: false,
    });

    if (requestId !== statsRequest) return;

    const totals = result.features.reduce(
      (summary, feature) => {
        const attributes = feature.attributes;
        summary.volume += Number(attributes.Transfer_Volume) || 0;
        summary.cost += Number(attributes.Transfer_Cost) || 0;
        return summary;
      },
      { volume: 0, cost: 0 }
    );

    volumeTotalEl.textContent = formatCompactNumber(totals.volume);
    costTotalEl.textContent = formatCurrency(totals.cost);
    statsFootEl.textContent = `${result.features.length.toLocaleString()} visible route${result.features.length === 1 ? "" : "s"}`;
  } catch (e) {
    if (requestId !== statsRequest) return;
    volumeTotalEl.textContent = "NO DATA";
    costTotalEl.textContent = "NO DATA";
    statsFootEl.textContent = "Route totals unavailable";
  }
}

function renderLegend() {
  const rows = riskMode
    ? RISK_LEVELS.map((r) => `<div class="legend-row"><span class="dot" style="background:${r.color}"></span>${r.value} risk</div>`)
    : NODE_TYPES.filter((t) => activeTypes.has(t.value)).map(
        (t) => `<div class="legend-row"><span class="node-key" style="background:${t.color}"></span>${t.label}</div>`
      );
  const flowRows = connectionsOn
    ? FLOW_BREAKS.map((b) => `<div class="legend-row"><span class="line-key" style="--line-color:rgb(${b.color.slice(0, 3).join(",")});--line-width:${b.width}px"></span>${b.label}</div>`)
    : [];
  legendRowsEl.innerHTML = [...rows, ...flowRows].join("");
}

/* ============================================================
   APPLY STATE to the map
   ============================================================ */

let view;
let map;

const impactAreaLayer = new GraphicsLayer({
  title: "Shanghai impact area",
  elevationInfo: { mode: "on-the-ground" },
});
const impactedFacilitiesLayer = new GraphicsLayer({
  title: "Impacted facilities",
  elevationInfo: { mode: "relative-to-ground", offset: 12, unit: "meters" },
});
const shanghaiPoint = new Point({ longitude: 121.4737, latitude: 31.2304 });
const impactBtn = document.getElementById("impact-btn");
const resetImpactBtn = document.getElementById("reset-impact-btn");
const impactStatus = document.getElementById("impact-status");
const impactEffects = document.getElementById("impact-effects");
let impactController = null;
let preImpactState = null;

createIcons({ icons: { Flame, RotateCcw } });

function animateImpact(duration, signal, update) {
  return new Promise((resolve, reject) => {
    let frame;
    const started = performance.now();
    const abort = () => {
      cancelAnimationFrame(frame);
      reject(new DOMException("Simulation reset", "AbortError"));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    const tick = (now) => {
      const progress = Math.min((now - started) / duration, 1);
      update(progress);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        signal.removeEventListener("abort", abort);
        resolve();
      }
    };
    frame = requestAnimationFrame(tick);
  });
}

function resetImpact() {
  impactController?.abort();
  impactController = null;
  view.animation?.stop();
  impactAreaLayer.removeAll();
  impactedFacilitiesLayer.removeAll();
  impactEffects.replaceChildren();
  if (preImpactState) {
    const saved = preImpactState;
    preImpactState = null;
    currentStep = saved.currentStep;
    activeTypes = saved.activeTypes;
    connectionsOn = saved.connectionsOn;
    riskMode = saved.riskMode;
    focusedNodeIds = saved.focusedNodeIds;
    focusedRouteIds = saved.focusedRouteIds;
    focusedNodePoint = saved.focusedNodePoint;
    manufacturingRouteIds = saved.manufacturingRouteIds;
    renderManifest();
    applyState(true);
    view.goTo(saved.camera, { animate: false }).catch(() => {});
  }
  impactBtn.disabled = false;
  resetImpactBtn.disabled = true;
  impactStatus.textContent = "Ready / Shanghai";
}

async function simulateShanghaiImpact() {
  if (impactController) return;
  const controller = new AbortController();
  const { signal } = controller;
  impactController = controller;
  preImpactState = {
    camera: view.camera.clone(), currentStep, activeTypes: new Set(activeTypes),
    connectionsOn, riskMode, focusedNodeIds, focusedRouteIds,
    focusedNodePoint, manufacturingRouteIds,
  };
  impactBtn.disabled = true;
  resetImpactBtn.disabled = false;
  impactStatus.textContent = "Locating Shanghai facilities...";
  const queryLayer = new FeatureLayer({ url: NODES_URL });
  try {
    const polygon = geometryEngine.geodesicBuffer(shanghaiPoint, 60, "kilometers");
    const result = await queryLayer.queryFeatures({
      geometry: polygon,
      spatialRelationship: "intersects",
      where: "NodeType NOT IN ('Port', 'Airport')",
      outFields: ["*"],
      returnGeometry: true,
    }, { signal });
    if (signal.aborted) return;
    if (result.exceededTransferLimit) throw new Error("Facility query incomplete");
    focusedNodeIds = null;
    focusedRouteIds = null;
    focusedNodePoint = null;
    activeTypes = new Set(ALL_TYPES);
    await applyState(true);
    if (signal.aborted) return;
    await view.goTo({ center: shanghaiPoint, zoom: 9, tilt: 0 }, { duration: 1400 });
    if (signal.aborted) return;
    view.popup.close();
    impactStatus.textContent = "Meteor inbound / Shanghai";
    const meteor = document.createElement("div");
    meteor.className = "meteor";
    impactEffects.appendChild(meteor);
    await animateImpact(1900, signal, (progress) => {
      const target = view.toScreen(shanghaiPoint);
      if (!target) return;
      const start = { x: -220, y: -60 };
      const travel = progress * progress;
      const angle = Math.atan2(target.y - start.y, target.x - start.x);
      meteor.style.left = `${start.x + (target.x - start.x) * travel}px`;
      meteor.style.top = `${start.y + (target.y - start.y) * travel}px`;
      meteor.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    });
    meteor.remove();
    impactAreaLayer.add(new Graphic({
      geometry: polygon,
      symbol: {
        type: "simple-fill", color: [255, 65, 65, 0.18],
        outline: { color: "#ff6060", width: 2 },
      },
      popupTemplate: {
        title: "Shanghai impact area",
        content: `Simulated impact / 60 km radius / ${result.features.length} facilities affected`,
      },
    }));
    const markers = result.features.map((feature) => {
      const type = NODE_TYPES.find((entry) => entry.value === feature.attributes.NodeType);
      return new Graphic({
        geometry: feature.geometry, attributes: feature.attributes,
        symbol: type ? nodeSymbol({ ...type, color: "#ffbf69" }) : circleSymbol("#ffbf69", 20),
        popupTemplate: nodesPopupTemplate,
      });
    });
    impactedFacilitiesLayer.addMany(markers);
    const flash = document.createElement("div");
    flash.className = "impact-flash";
    impactEffects.appendChild(flash);
    impactStatus.textContent = `Impact / ${markers.length} facilities pulsing`;
    await animateImpact(1800, signal, (progress) => {
      const target = view.toScreen(shanghaiPoint);
      if (target) {
        flash.style.left = `${target.x}px`;
        flash.style.top = `${target.y}px`;
      }
      flash.style.transform = `translate(-50%, -50%) scale(${1 + progress * 10})`;
      flash.style.opacity = `${1 - progress}`;
      const size = 24 + Math.sin(progress * Math.PI * 6) * 10;
      markers.forEach((marker) => {
        const symbol = marker.symbol.clone();
        if (symbol.type === "picture-marker") {
          symbol.width = size;
          symbol.height = size;
        } else {
          symbol.size = size;
        }
        marker.symbol = symbol;
      });
    });
    flash.remove();
    markers.forEach((marker) => {
      const type = NODE_TYPES.find((entry) => entry.value === marker.attributes.NodeType);
      marker.symbol = type ? nodeSymbol({ ...type, color: "#ff303f" }) : circleSymbol("#ff303f", 20);
    });
    impactStatus.textContent = `${markers.length} facilities impacted / 60 km area`;
  } catch (error) {
    if (signal.aborted) return;
    console.error("Shanghai simulation failed", error);
    resetImpact();
    impactStatus.textContent = "Simulation unavailable. Please retry.";
  } finally {
    queryLayer.destroy();
  }
}

impactBtn.addEventListener("click", simulateShanghaiImpact);
resetImpactBtn.addEventListener("click", resetImpact);

function activeNodeLayer() {
  return riskMode ? riskNodesLayer : nodesLayer;
}

async function createView(center, zoom) {
  view = new SceneView({
    container: "viewDiv",
    map,
    center,
    zoom,
    viewingMode: "global",
    qualityProfile: "high",
    ui: { components: [] },
  });

  view.ui.add(new Zoom({ view }), "top-left");
  const activeView = view;
  activeView.when().then(() => {
    if (view !== activeView) return;
    activeView.watch("extent", refreshStats);
    activeView.on("click", handleMapClick);
  });
}

function playNodeRipple(screenPoint, nodeType) {
  const ripple = document.createElement("div");
  ripple.className = "node-ripple";
  ripple.style.setProperty("--ripple-color", nodeTypeColor(nodeType));
  ripple.style.left = `${screenPoint.x}px`;
  ripple.style.top = `${screenPoint.y}px`;
  ripple.innerHTML = "<span></span><span></span><span></span>";
  document.getElementById("viewDiv").appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
}

function objectIdExpression(field, ids) {
  return ids?.length ? `${field} IN (${ids.join(",")})` : "1=0";
}

async function focusNode(nodeGraphic) {
  try {
    focusedNodePoint = nodeGraphic.geometry;
    const searchGeometry = geometryEngine.buffer(nodeGraphic.geometry, 0.5, "kilometers");
    const routeResult = await routeLayer.queryFeatures({
      geometry: searchGeometry,
      spatialRelationship: "intersects",
      where: "1=1",
      outFields: ["OBJECTID"],
      returnGeometry: true,
    });
    const routeGeometries = routeResult.features.map((feature) => feature.geometry).filter(Boolean);
    const routeIds = routeResult.features.map((feature) => feature.attributes.OBJECTID);

    if (!routeGeometries.length) {
      focusedNodeIds = [nodeGraphic.attributes.OBJECTID];
      focusedRouteIds = [];
      connectionsOn = true;
      applyState();
      return;
    }

    const connectedGeometry = geometryEngine.union(routeGeometries);
    const nodeSearchGeometry = geometryEngine.buffer(connectedGeometry, 25, "kilometers");
    const nodeResult = await activeNodeLayer().queryFeatures({
      geometry: nodeSearchGeometry,
      spatialRelationship: "intersects",
      where: "1=1",
      outFields: ["OBJECTID"],
      returnGeometry: true,
    });
    const connectedNodeIds = new Set([nodeGraphic.attributes.OBJECTID]);
    const candidateNodes = nodeResult.features;
    const findNearestNodeId = (endpoint) => {
      let nearestId;
      let nearestDistance = Infinity;
      candidateNodes.forEach((feature) => {
        const distance = geometryEngine.distance(endpoint, feature.geometry, "kilometers");
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = feature.attributes.OBJECTID;
        }
      });
      if (nearestId !== undefined && nearestDistance <= 25) connectedNodeIds.add(nearestId);
    };
    routeGeometries.forEach((routeGeometry) => {
      const lastPath = routeGeometry.paths[routeGeometry.paths.length - 1];
      findNearestNodeId(routeGeometry.getPoint(0, 0));
      findNearestNodeId(routeGeometry.getPoint(routeGeometry.paths.length - 1, lastPath.length - 1));
    });
    focusedNodeIds = [...connectedNodeIds];
    focusedRouteIds = routeIds;
    connectionsOn = true;
    applyState();
  } catch (e) {
    // non-fatal — a node can still open its popup if the relationship query fails
  }
}

async function getRouteIdsBetweenTypes(allowedTypes) {
  const [nodeResult, routeResult] = await Promise.all([
    nodesLayer.queryFeatures({
      where: `NodeType IN (${allowedTypes.map((type) => `'${type}'`).join(",")})`,
      outFields: ["OBJECTID", "NodeType"],
      returnGeometry: true,
    }),
    routeLayer.queryFeatures({
      where: "1=1",
      outFields: ["OBJECTID"],
      returnGeometry: true,
    }),
  ]);
  const allowedNodes = nodeResult.features.filter((feature) => feature.geometry);
  const nearestAllowedNode = (point) => {
    let nearest;
    let distance = Infinity;
    allowedNodes.forEach((node) => {
      const candidateDistance = geometryEngine.distance(point, node.geometry, "kilometers");
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearest = node;
      }
    });
    return distance <= 25 ? nearest : null;
  };
  return routeResult.features.filter((route) => {
    if (!route.geometry?.paths?.length) return false;
    const lastPath = route.geometry.paths[route.geometry.paths.length - 1];
    const start = nearestAllowedNode(route.geometry.getPoint(0, 0));
    const end = nearestAllowedNode(route.geometry.getPoint(route.geometry.paths.length - 1, lastPath.length - 1));
    return start && end && start.attributes.OBJECTID !== end.attributes.OBJECTID
      && (allowedTypes.length > 2 || new Set([start.attributes.NodeType, end.attributes.NodeType]).size === 2);
  }).map((route) => route.attributes.OBJECTID);
}

async function handleMapClick(event) {
  const response = await view.hitTest(event, { include: [activeNodeLayer()] });
  const nodeHit = response.results.find((result) => result.graphic?.attributes?.NodeType);
  if (nodeHit) {
    playNodeRipple(event, nodeHit.graphic.attributes.NodeType);
    if (currentStep === 0 || currentStep === 1) focusNode(nodeHit.graphic);
  } else {
    view.popup.close();
    clearSelection(true);
  }
}

async function applyState(preserveView = false) {
  const nodeLayer = activeNodeLayer();
  nodesLayer.visible = !riskMode;
  riskNodesLayer.visible = riskMode;
  nodeLayer.renderer = riskMode ? riskRenderer : typeRenderer;

  const typesArr = [...activeTypes];
  const selectedTypeExpression =
    typesArr.length && typesArr.length < ALL_TYPES.length
      ? `NodeType IN (${typesArr.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")})`
      : null;
  const typeExpression = selectedTypeExpression
    ? `NodeType NOT IN ('Port', 'Airport') AND (${selectedTypeExpression})`
    : "NodeType NOT IN ('Port', 'Airport')";
  if (focusedNodeIds) {
    const focusExpression = objectIdExpression("OBJECTID", focusedNodeIds);
    nodeLayer.definitionExpression = focusExpression;
  } else {
    nodeLayer.definitionExpression = typeExpression;
  }

  routeLayer.visible = connectionsOn;
  if ((currentStep === 2 || currentStep === 3 || currentStep === 4) && connectionsOn) {
    const routeTypes = currentStep === 2
      ? ["Tier 3 Supplier", "Tier 2 Supplier", "Tier 1 Supplier", "Plant"]
      : currentStep === 3
        ? ["Plant", "DC"]
        : ["DC", "Store"];
    manufacturingRouteIds = manufacturingRouteIds || await getRouteIdsBetweenTypes(routeTypes);
  } else {
    manufacturingRouteIds = null;
  }
  const visibleRouteIds = focusedRouteIds || manufacturingRouteIds;
  routeLayer.definitionExpression = visibleRouteIds
    ? objectIdExpression("OBJECTID", visibleRouteIds)
    : null;
  clearSelectionBtn.disabled = !focusedNodeIds;

  renderChips();
  renderLegend();
  refreshStats();

  try {
    const result = await nodeLayer.queryExtent();
    if (!preserveView && result?.extent && view) {
      if (focusedNodePoint) {
        view.goTo({ center: focusedNodePoint }, { duration: 700 });
      } else {
        view.goTo(result.extent.expand(1.35), { duration: 700 });
      }
    }
  } catch (e) {
    // non-fatal — extent query can fail on an empty selection
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */

function goToStep(i) {
  currentStep = Math.max(0, Math.min(STEPS.length - 1, i));
  focusedNodeIds = null;
  focusedRouteIds = null;
  focusedNodePoint = null;
  manufacturingRouteIds = null;
  const s = STEPS[currentStep];
  activeTypes = new Set(s.types);
  connectionsOn = s.connections;
  riskMode = s.risk;
  renderManifest();
  applyState();
}

prevBtn.addEventListener("click", () => goToStep(currentStep - 1));
nextBtn.addEventListener("click", () => goToStep(currentStep + 1));
clearSelectionBtn.addEventListener("click", clearSelection);

/* ============================================================
   BOOT
   ============================================================ */

async function boot() {
  map = new Map({
    basemap: "dark-gray-vector",
    ground: "world-elevation",
  });

  await connectionsLayer.load();
  await generateStoreLinks();
  const originalRoutes = await connectionsLayer.queryFeatures({
    where: "1=1",
    outFields: ["*"],
    returnGeometry: true,
  });
  routeLayer = new FeatureLayer({
    title: "Transfer routes",
    source: [...originalRoutes.features, ...generatedStoreLinksLayer.graphics.toArray()],
    objectIdField: "OBJECTID",
    fields: Array.from(connectionsLayer.fields),
    geometryType: "polyline",
    spatialReference: connectionsLayer.spatialReference,
    renderer: flowRenderer,
    popupTemplate: connectionsPopupTemplate,
    visible: false,
    outFields: ["*"],
  });
  map.addMany([highwaysLayer, routeLayer, nodesLayer, riskNodesLayer, impactAreaLayer, impactedFacilitiesLayer]);
  createView([10, 15], 2);
  await view.when();

  renderManifest();
  await applyState();
  impactBtn.disabled = false;
  impactStatus.textContent = "Ready / Shanghai";
}

boot();
