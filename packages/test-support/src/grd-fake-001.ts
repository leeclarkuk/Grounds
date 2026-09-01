import type { Detector, DetectorInput, DetectorOutput } from '@grounds/application';
import {
  FAKE_DETECTOR_ID,
  FAKE_DETECTOR_VERSION,
  FAKE_INVENTORY_KIND,
  detectorParametersDigest,
  findingFingerprint,
  isJsonObject,
  severityFor,
} from '@grounds/domain';

export class GrdFake001 implements Detector {
  public readonly id = FAKE_DETECTOR_ID;
  public readonly version = FAKE_DETECTOR_VERSION;

  public evaluate(input: DetectorInput): DetectorOutput {
    const inventory = input.observations.filter((item) => item.kind === FAKE_INVENTORY_KIND);
    const cited = inventory.length > 0 ? inventory : input.observations;
    const observationIds = cited.map((item) => item.id);
    if (observationIds.length === 0) {
      throw new Error('GRD-FAKE-001 cannot emit a finding without an observation');
    }
    const required = inventory[0];
    let result: DetectorOutput['result'] = 'PASS';
    if (
      !required ||
      required.inaccessible ||
      required.truncated ||
      required.freshness === 'STALE'
    ) {
      result = 'UNKNOWN';
    } else if (isJsonObject(required.payload) && required.payload['fixtureResult'] === 'FAIL') {
      result = 'FAIL';
    }
    const condition = { fixtureResult: result };
    return {
      detectorId: this.id,
      detectorVersion: this.version,
      result,
      severity: severityFor(result),
      title:
        result === 'FAIL'
          ? 'Fixture inventory reported FAIL'
          : result === 'UNKNOWN'
            ? 'Required fixture inventory is missing, stale, truncated or inaccessible'
            : 'Fixture inventory is acceptable',
      explanation:
        result === 'UNKNOWN'
          ? 'GRD-FAKE-001 returns UNKNOWN when required fake.inventory evidence is not usable.'
          : 'GRD-FAKE-001 evaluates the fixture inventory payload only.',
      fingerprint: findingFingerprint({
        organisationId: input.run.organisationId,
        detectorId: this.id,
        detectorVersion: this.version,
        detectorParametersDigest: detectorParametersDigest(input.detectorParameters),
        resource: input.run.resourceScope,
        result,
        condition,
      }),
      observationIds,
    };
  }
}
