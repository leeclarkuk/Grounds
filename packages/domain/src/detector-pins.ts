import {
  ECS_DETECTOR_IDS,
  ECS_OBS_DETECTOR_ID,
  ECS_OBS_DETECTOR_VERSION,
  ECS_SERVICE_DETECTOR_ID,
  ECS_SERVICE_DETECTOR_VERSION,
  FAKE_DETECTOR_ID,
  FAKE_DETECTOR_VERSION,
} from './constants.js';

export type DetectorVersions = { readonly [detectorId: string]: string };

export type DetectorPinSet = 'fake' | 'ecs';

export function assertDetectorPinSet(versions: DetectorVersions): DetectorPinSet {
  const ids = Object.keys(versions).sort();
  const fake =
    ids.length === 1 &&
    ids[0] === FAKE_DETECTOR_ID &&
    versions[FAKE_DETECTOR_ID] === FAKE_DETECTOR_VERSION;
  const ecs =
    ids.length === 2 &&
    ids[0] === ECS_SERVICE_DETECTOR_ID &&
    ids[1] === ECS_OBS_DETECTOR_ID &&
    versions[ECS_SERVICE_DETECTOR_ID] === ECS_SERVICE_DETECTOR_VERSION &&
    versions[ECS_OBS_DETECTOR_ID] === ECS_OBS_DETECTOR_VERSION;
  if (fake) {
    return 'fake';
  }
  if (ecs) {
    return 'ecs';
  }
  throw new Error('detector pin set is mixed, empty or unknown');
}

export function ecsDetectorVersions(): DetectorVersions {
  return {
    [ECS_SERVICE_DETECTOR_ID]: ECS_SERVICE_DETECTOR_VERSION,
    [ECS_OBS_DETECTOR_ID]: ECS_OBS_DETECTOR_VERSION,
  };
}

export function fakeDetectorVersions(): DetectorVersions {
  return { [FAKE_DETECTOR_ID]: FAKE_DETECTOR_VERSION };
}

export function isPinnedDetector(
  versions: DetectorVersions,
  detectorId: string,
  detectorVersion: string,
): boolean {
  return versions[detectorId] === detectorVersion;
}

export { ECS_DETECTOR_IDS };
