'use client';

import { useEffect, useState } from 'react';

type Profile = {
  readonly id: string;
  readonly profileId: string;
  readonly version: number;
  readonly scope: {
    readonly accountId: string;
    readonly region: string;
    readonly resourceId: string;
  };
};

export default function NewRunPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [from, setFrom] = useState(() => new Date(Date.now() - 3_600_000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [message, setMessage] = useState('');
  const selected = profiles.find((item) => item.id === profileId);

  useEffect(() => {
    void fetch('/v1/profiles')
      .then((response) => response.json())
      .then((body: { profiles?: Profile[] }) => {
        const list = body.profiles ?? [];
        setProfiles(list);
        const first = list[0];
        if (first) {
          setProfileId(first.id);
        }
      });
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    const grantResponse = await fetch('/v1/authorisations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        profileVersionId: selected.id,
        resourceScope: {
          provider: 'aws',
          accountId: selected.scope.accountId,
          region: selected.scope.region,
          service: 'ecs',
          resourceType: 'service',
          resourceId: selected.scope.resourceId,
        },
        evidenceWindow: { from, to },
      }),
    });
    const grant = (await grantResponse.json()) as { id?: string; detail?: string };
    if (!grantResponse.ok || !grant.id) {
      setMessage(grant.detail ?? 'authorisation failed');
      return;
    }
    const runResponse = await fetch('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ grantId: grant.id }),
    });
    const run = (await runResponse.json()) as { id?: string; detail?: string };
    if (!runResponse.ok || !run.id) {
      setMessage(run.detail ?? 'enqueue failed');
      return;
    }
    window.location.href = `/runs/${run.id}`;
  }

  return (
    <section>
      <h1>New assurance run</h1>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          Profile
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.profileId} v{String(profile.version)}
              </option>
            ))}
          </select>
        </label>
        {selected ? (
          <p>
            Account {selected.scope.accountId}, region {selected.scope.region}, service{' '}
            {selected.scope.resourceId}. Window is historical and at most one hour.
          </p>
        ) : null}
        <label>
          From
          <input value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button type="submit">Authorise and run</button>
      </form>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
