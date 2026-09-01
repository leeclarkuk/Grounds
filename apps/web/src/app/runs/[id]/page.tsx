type Finding = {
  readonly id: string;
  readonly detectorId: string;
  readonly result: string;
  readonly title: string;
  readonly explanation: string;
  readonly observationIds: readonly string[];
};

type Observation = {
  readonly id: string;
  readonly kind: string;
  readonly freshness: string;
  readonly inaccessible: boolean;
  readonly payload: unknown;
  readonly collectedAt: string;
};

type EventRow = {
  readonly sequence: number;
  readonly type: string;
  readonly occurredAt: string;
  readonly payload?: { readonly stepType?: string };
};

type RunStep = {
  readonly id: string;
  readonly stepType: 'collect' | 'evaluate';
  readonly state: string;
  readonly attempt: number;
  readonly leaseEpoch: number;
  readonly errorClass: string | null;
  readonly errorMessage: string | null;
};

function Result({ value }: { readonly value: string | null }) {
  const cls = value === 'PASS' || value === 'FAIL' || value === 'UNKNOWN' ? value : 'none';
  return <span className={`result result-${cls}`}>{value ?? 'pending'}</span>;
}

function stepLabel(stepType: RunStep['stepType']): string {
  return stepType === 'collect' ? 'Evidence collection' : 'Detector evaluation';
}

function collectionCompletedAt(
  observations: readonly Observation[],
  events: readonly EventRow[],
): string | null {
  const collectSucceeded = events.find(
    (event) =>
      event.type === 'step_succeeded' &&
      event.payload !== undefined &&
      event.payload.stepType === 'collect',
  );
  if (collectSucceeded) {
    return collectSucceeded.occurredAt;
  }
  if (observations.length === 0) {
    return null;
  }
  return observations.reduce(
    (latest, observation) => (observation.collectedAt > latest ? observation.collectedAt : latest),
    observations[0]?.collectedAt ?? '',
  );
}

export default async function RunDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const api = process.env['GROUNDS_API_BASE_URL'] ?? 'http://127.0.0.1:3000';
  const response = await fetch(`${api}/v1/runs/${id}`, { cache: 'no-store' });
  if (!response.ok) {
    return <p>Run not found.</p>;
  }
  const body = (await response.json()) as {
    run: {
      id: string;
      state: string;
      result: string | null;
      profileVersionId: string;
      resourceScope: { resourceId: string };
      evidenceWindow: { from: string; to: string };
      startedAt: string | null;
    };
    steps: RunStep[];
    findings: Finding[];
    observations: Observation[];
    events: EventRow[];
  };
  const collectedAt = collectionCompletedAt(body.observations, body.events);
  return (
    <section>
      <h1>Run {body.run.id}</h1>
      <p>
        State {body.run.state} <Result value={body.run.result} />
      </p>
      <p>Pinned profile {body.run.profileVersionId}</p>
      <p>Service {body.run.resourceScope.resourceId}</p>
      <p>
        Evidence window {body.run.evidenceWindow.from} → {body.run.evidenceWindow.to}
      </p>
      <p>
        {collectedAt
          ? `Collection completed at ${collectedAt}`
          : `Started at ${body.run.startedAt ?? 'not started'}`}
      </p>
      <h2>Steps</h2>
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>State</th>
            <th>Attempt</th>
            <th>Lease epoch</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {body.steps.map((step) => (
            <tr key={step.id}>
              <td>{stepLabel(step.stepType)}</td>
              <td>{step.state}</td>
              <td>{step.attempt}</td>
              <td>{step.leaseEpoch}</td>
              <td>
                {step.errorClass
                  ? `${step.errorClass}${step.errorMessage ? `: ${step.errorMessage}` : ''}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Findings</h2>
      {body.findings.map((finding) => (
        <article className="card" key={finding.id}>
          <h3>
            {finding.detectorId} <Result value={finding.result} />
          </h3>
          <p>{finding.title}</p>
          <p>{finding.explanation}</p>
          <p>Citations: {finding.observationIds.join(', ')}</p>
        </article>
      ))}
      <h2>Cited observations</h2>
      {body.observations.map((observation) => (
        <details className="card" key={observation.id}>
          <summary>
            {observation.kind} {observation.freshness}
            {observation.inaccessible ? ' inaccessible' : ''} {observation.collectedAt}
          </summary>
          <pre>{JSON.stringify(observation.payload, null, 2)}</pre>
        </details>
      ))}
      <h2>Timeline</h2>
      <ol>
        {body.events.map((event) => (
          <li key={String(event.sequence)}>
            {event.occurredAt} {event.type}
          </li>
        ))}
      </ol>
    </section>
  );
}
