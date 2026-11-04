export const DEFAULT_DEVICE_MODEL = "deepseek-flash";

export interface DeviceModelConnection {
  credential: string;
  model: string;
}

let credential = "";
let model = DEFAULT_DEVICE_MODEL;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function readDeviceModelConnection(): DeviceModelConnection {
  return { credential, model };
}

export function rememberDeviceModelSubmission(nextCredential: string, nextModel: string) {
  credential = nextCredential;
  model = nextModel;
  notifyListeners();
}

export function clearDeviceModelConnection() {
  credential = "";
  model = DEFAULT_DEVICE_MODEL;
  notifyListeners();
}

export function subscribeDeviceModelConnection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
