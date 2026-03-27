import { env } from "~/utils/env.server";

export type RunPodEndpointStatus = {
  id: string;
  workersMin: number;
  workersMax: number;
  idleTimeout: number;
  name: string;
  // Mapped from REST /health
  workers: Array<{ status: string }>; 
};

const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";

async function runpodGraphQL<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY is missing from environment");

  const res = await fetch(RUNPOD_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`RunPod GraphQL error (${res.status}): ${txt}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`RunPod GraphQL returned errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

export const runpodApi = {
  /**
   * Modifies the Endpoint configuration directly.
   * To safely wake a worker without overwriting User configurations, we strictly
   * query the existing setup, and spread it into the dangerous saveEndpoint mutation,
   * isolating the update to just workersMin.
   */
  async scaleMinWorkers(endpointId: string, minWorkers: number): Promise<void> {
    console.log(`[runpod-api] Querying existing config to scale endpoint ${endpointId} to min workers: ${minWorkers}`);
    
    // 1. Fetch current safe parameters
    const query = `
      query getSafeParams($id: String!) {
        myself {
          endpoint(id: $id) {
            id name templateId gpuIds networkVolumeId idleTimeout workersMin
          }
        }
      }
    `;
    const data = await runpodGraphQL<any>(query, { id: endpointId });
    const currentConfig = data?.myself?.endpoint;
    if (!currentConfig) throw new Error("Could not find endpoint on RunPod Account!");

    const safeInput = currentConfig;
    // 2. Perform safe mutated save
    console.log(`[runpod-api] Pushing saveEndpoint with Min Workers => ${minWorkers}`);
    const mutation = `
      mutation saveEndpoint($input: EndpointInput!) {
        saveEndpoint(input: $input) {
          id
          workersMin
        }
      }
    `;

    await runpodGraphQL<{ saveEndpoint: { id: string; workersMin: number } }>(mutation, {
      input: {
        ...safeInput,
        workersMin: minWorkers,
      }
    });
  },

  /**
   * Fetches the Endpoint state via GraphQL and pulls actual worker counts via REST /health API
   */
  async getEndpointStatus(endpointId: string): Promise<RunPodEndpointStatus | null> {
    const apiKey = env.RUNPOD_API_KEY;
    if (!apiKey) return null;

    // Call Both APIs concurrently
    const [gqlData, healthRes] = await Promise.all([
      runpodGraphQL<any>(`
        query getConfig($id: String!) {
          myself {
            endpoint(id: $id) {
              id workersMin workersMax idleTimeout name
            }
          }
        }
      `, { id: endpointId }),
      fetch(`https://api.runpod.ai/v2/${endpointId}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
    ]);

    const endpointConfig = gqlData?.myself?.endpoint;
    if (!endpointConfig) return null;

    let runningWorkersCount = 0;
    if (healthRes.ok) {
        const healthJson = await healthRes.json();
        // healthJson.workers = { idle, initializing, ready, running, throttled, unhealthy }
        const w = healthJson.workers;
        if (w) {
            runningWorkersCount = (w.running || 0) + (w.initializing || 0) + (w.ready || 0) + (w.idle || 0);
        }
    }

    // Faux structure mapping for the previously built dashboard expectation
    const fauxWorkersArray = Array.from({ length: runningWorkersCount }).map(() => ({ status: "RUNNING" }));

    return {
      ...endpointConfig,
      workers: fauxWorkersArray
    };
  },

  /**
   * Waits actively until at least one worker is RUNNING.
   */
  async waitForWorkerReady(endpointId: string, timeoutMs: number = 180000): Promise<void> {
    const apiKey = env.RUNPOD_API_KEY;
    if (!apiKey) return;
    
    const start = Date.now();
    console.log(`[runpod-api] Polling REST /health of endpoint ${endpointId} until ready...`);

    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`https://api.runpod.ai/v2/${endpointId}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      
      if (res.ok) {
          const health = await res.json();
          if (health?.workers && (health.workers.running > 0 || health.workers.ready > 0 || health.workers.initializing > 0 || health.workers.idle > 0)) {
              console.log(`[runpod-api] Worker instantiated! Took ${((Date.now() - start) / 1000).toFixed(1)}s`);
              return;
          }
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error(`Timeout waiting for RunPod worker on endpoint ${endpointId} to spin up.`);
  }
};
