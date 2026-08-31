import type { CollectContext, ResourceInventoryPort, TelemetryPort } from '@grounds/application';
import {
  FAKE_ADAPTER,
  FAKE_INVENTORY_KIND,
  FAKE_INVENTORY_OPERATION,
  FAKE_TELEMETRY_KIND,
  FAKE_TELEMETRY_OPERATION,
  inaccessiblePayload,
  requestDigest,
  type JsonValue,
  type ResourceRef,
} from '@grounds/domain';

export class FakeInventory implements ResourceInventoryPort {
  public calls = 0;

  public constructor(
    private readonly behaviour: 'ok' | 'fail' | 'inaccessible' | 'throw' | 'huge' = 'ok',
  ) {}

  public async collect(context: CollectContext) {
    this.calls += 1;
    await context.onPage();
    if (this.behaviour === 'inaccessible') {
      return [
        observation(
          context.scope,
          context,
          FAKE_INVENTORY_KIND,
          FAKE_INVENTORY_OPERATION,
          inaccessiblePayload('unavailable'),
          true,
        ),
      ];
    }
    if (this.behaviour === 'throw') {
      throw new Error('inventory unavailable');
    }
    if (this.behaviour === 'huge') {
      return [
        observation(context.scope, context, FAKE_INVENTORY_KIND, FAKE_INVENTORY_OPERATION, {
          blob: 'x'.repeat(1_048_577),
        }),
      ];
    }
    const payload: JsonValue = {
      fixtureResult: this.behaviour === 'fail' ? 'FAIL' : 'PASS',
    };
    return [
      observation(context.scope, context, FAKE_INVENTORY_KIND, FAKE_INVENTORY_OPERATION, payload),
    ];
  }
}

export class FakeTelemetry implements TelemetryPort {
  public calls = 0;

  public constructor(private readonly behaviour: 'ok' | 'inaccessible' = 'ok') {}

  public async collect(context: CollectContext) {
    this.calls += 1;
    await context.onPage();
    if (this.behaviour === 'inaccessible') {
      return [
        observation(
          context.scope,
          context,
          FAKE_TELEMETRY_KIND,
          FAKE_TELEMETRY_OPERATION,
          inaccessiblePayload('unavailable'),
          true,
        ),
      ];
    }
    return [
      observation(context.scope, context, FAKE_TELEMETRY_KIND, FAKE_TELEMETRY_OPERATION, {
        datapoints: 3,
      }),
    ];
  }
}

export class CountingInventory implements ResourceInventoryPort {
  public calls = 0;
  public constructor(private readonly inner: ResourceInventoryPort) {}
  public collect(context: CollectContext) {
    this.calls += 1;
    return this.inner.collect(context);
  }
}

function observation(
  scope: ResourceRef,
  context: CollectContext,
  kind: string,
  operation: string,
  payload: JsonValue,
  inaccessible = false,
) {
  return {
    kind,
    payload,
    inaccessible,
    operation,
    adapter: FAKE_ADAPTER,
    requestDigest: requestDigest({
      operation,
      resource: scope,
      window: context.window,
    }),
  };
}
