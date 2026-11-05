export const DEFAULT_DEVICE_MODEL = "deepseek-flash";

export type DeviceModelSource = "shared" | "personal";

export interface DeviceModelConnection {
  credential: string;
  model: string;
  source: DeviceModelSource;
  capabilityLoaded: boolean;
  capabilityFailed: boolean;
  sharedAvailable: boolean;
  sharedModel: string | null;
}

let credential = "";
let model = DEFAULT_DEVICE_MODEL;
let personalModel = DEFAULT_DEVICE_MODEL;
let source: DeviceModelSource = "shared";
let capabilityLoaded = false;
let capabilityFailed = false;
let sharedAvailable = false;
let sharedModel: string | null = null;
let capabilityRequest: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function applyCapability(available: boolean, nextModel: string | null, failed: boolean) {
  capabilityLoaded = true;
  capabilityFailed = failed;
  sharedAvailable = available;
  sharedModel = nextModel;
  if (source === "shared") {
    if (available && nextModel) model = nextModel;
    else {
      source = "personal";
      model = personalModel;
    }
  }
  notifyListeners();
}

export function loadDeviceModelCapability(): Promise<void> {
  if (capabilityRequest) return capabilityRequest;
  capabilityRequest = fetch("/device/ai/connection", {
    credentials: "omit",
    cache: "no-store",
    redirect: "error"
  }).then(async (response) => {
    if (!response.ok) throw new Error("capability_unavailable");
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("capability_invalid");
    const capability = value as Record<string, unknown>;
    const available = capability.shared_available === true;
    const nextModel = capability.shared_model;
    if (typeof capability.shared_available !== "boolean"
      || (nextModel !== null && typeof nextModel !== "string")
      || capability.shared_available !== available
      || (available && (!nextModel || typeof nextModel !== "string"))
      || (!available && nextModel !== null)) throw new Error("capability_invalid");
    applyCapability(available, nextModel, false);
  }).catch(() => {
    applyCapability(false, null, true);
  });
  return capabilityRequest;
}

export function readDeviceModelConnection(): DeviceModelConnection {
  return {
    credential,
    model,
    source,
    capabilityLoaded,
    capabilityFailed,
    sharedAvailable,
    sharedModel
  };
}

export function selectDeviceModelSource(nextSource: DeviceModelSource) {
  if (nextSource === "shared") {
    if (!sharedAvailable || !sharedModel) return;
    if (source === "personal") personalModel = model;
    source = "shared";
    model = sharedModel;
  } else {
    if (source === "shared") model = personalModel;
    source = "personal";
  }
  notifyListeners();
}

export function rememberDeviceModelSubmission(nextCredential: string, nextModel: string, nextSource: DeviceModelSource) {
  source = nextSource;
  model = nextModel;
  if (nextSource === "personal") {
    credential = nextCredential;
    personalModel = nextModel;
  }
  notifyListeners();
}

export function clearDeviceModelConnection() {
  credential = "";
  personalModel = DEFAULT_DEVICE_MODEL;
  model = source === "shared" && sharedModel ? sharedModel : DEFAULT_DEVICE_MODEL;
  notifyListeners();
}

export function subscribeDeviceModelConnection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
