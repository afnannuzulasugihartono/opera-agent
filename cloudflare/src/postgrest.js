// @title: postgrest — one RPC call over fetch, with credentials validated before use.
// @state: 4 locks; endpoint shape, failure mapping, credential gate, deadline.
// @dependencies: none.

const DEFAULT_TIMEOUT_MS = 15000;

export function createPostgrest({ baseUrl, serviceKey, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return {
    async rpc(name, args) {
      if (typeof baseUrl !== 'string' || !baseUrl || typeof serviceKey !== 'string' || !serviceKey) {
        throw new Error('PostgREST credentials are missing.');
      }
      if (typeof name !== 'string' || !name) throw new Error('RPC needs a name.');
      const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response?.ok) throw new Error(`${name} failed.`);
      return response.json();
    }
  };
}
