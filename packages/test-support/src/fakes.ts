import type { ResourceInventoryPort, TelemetryPort } from '@grounds/application';
import type { JsonValue, ResourceRef } from '@grounds/domain';

export class FakeInventory implements ResourceInventoryPort {
  public calls = 0;

  public constructor(
    private readonly behaviour: 'ok' | 'fail' | 'inaccessible' | 'throw' | 'huge' = 'ok',
  ) {}

  public describeInventory(_scope: ResourceRef) {
    this.calls += 1;
    if (this.behaviour === 'inaccessible') {
      return Promise.resolve({ ok: false as const });
    }
    if (this.behaviour === 'throw') {
      return Promise.reject(new Error('inventory unavailable'));
    }
    if (this.behaviour === 'huge') {
      return Promise.resolve({ ok: true as const, payload: { blob: 'x'.repeat(1_048_577) } });
    }
    const payload: JsonValue = {
      fixtureResult: this.behaviour === 'fail' ? 'FAIL' : 'PASS',
    };
    return Promise.resolve({ ok: true as const, payload });
  }
}

export class FakeTelemetry implements TelemetryPort {
  public calls = 0;

  public constructor(private readonly behaviour: 'ok' | 'inaccessible' = 'ok') {}

  public getTelemetry(_scope: ResourceRef) {
    this.calls += 1;
    if (this.behaviour === 'inaccessible') {
      return Promise.resolve({ ok: false as const });
    }
    return Promise.resolve({ ok: true as const, payload: { datapoints: 3 } });
  }
}

export class CountingInventory implements ResourceInventoryPort {
  public calls = 0;
  public constructor(private readonly inner: ResourceInventoryPort) {}
  public describeInventory(scope: ResourceRef) {
    this.calls += 1;
    return this.inner.describeInventory(scope);
  }
}
