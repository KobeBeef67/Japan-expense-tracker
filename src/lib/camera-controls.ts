// Image Capture properties are not yet included in every TypeScript DOM version.
export interface CameraRange {
  min: number;
  max: number;
  step?: number;
}
export interface CameraCapabilities {
  focusMode?: string[];
  exposureMode?: string[];
  focusDistance?: CameraRange;
  exposureCompensation?: CameraRange;
  brightness?: CameraRange;
  zoom?: CameraRange;
}
export interface CameraSettings {
  focusMode?: string;
  exposureMode?: string;
  focusDistance?: number;
  exposureCompensation?: number;
  brightness?: number;
  zoom?: number;
  pointsOfInterest?: { x: number; y: number }[];
}
export function cameraCapabilities(track: MediaStreamTrack): CameraCapabilities {
  try {
    return (track.getCapabilities?.() as CameraCapabilities) || {};
  } catch {
    return {};
  }
}
export function cameraSettings(track: MediaStreamTrack): CameraSettings {
  return track.getSettings() as CameraSettings;
}
export function adjustableRange(value: CameraRange | undefined): value is CameraRange {
  return (
    !!value && Number.isFinite(value.min) && Number.isFinite(value.max) && value.max > value.min
  );
}
/** Map clicks to the actual contained video, excluding letterbox margins. */
export function focusPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  videoWidth: number,
  videoHeight: number,
) {
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const w = videoWidth * scale,
    h = videoHeight * scale;
  const left = (width - w) / 2,
    top = (height - h) / 2;
  if (x < left || y < top || x > left + w || y > top + h || !scale) return null;
  return { x: (x - left) / w, y: (y - top) / h };
}
export async function applyCameraSetting(track: MediaStreamTrack, values: CameraSettings) {
  // Applying constraints replaces the previous set. Preserve resolution and manual
  // focus mode when adjusting another control such as focus distance.
  const constraints = track.getConstraints?.() || {};
  const previous = Object.assign({}, ...(constraints.advanced || []));
  await track.applyConstraints({
    ...constraints,
    advanced: [{ ...previous, ...values } as MediaTrackConstraintSet],
  });
  const actual = cameraSettings(track);
  // Optional constraints can be silently ignored. Never equate acceptance with confirmation.
  return Object.entries(values).every(
    ([key, value]) => JSON.stringify(actual[key as keyof CameraSettings]) === JSON.stringify(value),
  );
}
