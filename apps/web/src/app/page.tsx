import './globals.css';

type RunSummary = {
  readonly id: string;
  readonly state: string;
  readonly result: string | null;
  readonly resourceScope: { readonly resourceId: string };
  readonly evidenceWindow: { readonly from: string; readonly to: string };
  readonly createdAt: string;
  readonly terminalAt: string | null;
};

function Result({ value }: { readonly value: string | null }) {
  const cls = value === 'PASS' || value === 'FAIL' || value === 'UNKNOWN' ? value : 'none';
  return <span className={`result result-${cls}`}>{value ?? 'pending'}</span>;
}

export default async function RunListPage() {
  const api = process.env['GROUNDS_API_BASE_URL'] ?? 'http://127.0.0.1:3000';
  const response = await fetch(`${api}/v1/runs`, { cache: 'no-store' });
  const body = (await response.json()) as { runs?: RunSummary[] };
  const runs = body.runs ?? [];
  return (
    <section>
      <h1>Assurance runs</h1>
      <table>
        <thead>
          <tr>
            <th>State</th>
            <th>Result</th>
            <th>Service</th>
            <th>Window</th>
            <th>Created</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <a href={`/runs/${run.id}`}>{run.state}</a>
              </td>
              <td>
                <Result value={run.result} />
              </td>
              <td>{run.resourceScope.resourceId}</td>
              <td>
                {run.evidenceWindow.from} → {run.evidenceWindow.to}
              </td>
              <td>{run.createdAt}</td>
              <td>
                {run.terminalAt
                  ? `${String(Math.round((Date.parse(run.terminalAt) - Date.parse(run.createdAt)) / 1000))}s`
                  : 'in progress'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
