import { env } from "~/utils/env.server";

export type RunPodStatus = {
  id: string;
  name?: string;
  desiredStatus: string;
  runtime?: {
    uptimeInSeconds: number;
    ports?: Array<{ privatePort: number; isIpPublic: boolean; publicPort: number; ip: string }>;
  };
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
   * Resumes an existing Pod. 
   * This instantly starts billing for GPU compute and initializes the container via FlashBoot.
   */
  async startPod(podId: string): Promise<void> {
    console.log(`[runpod-api] Waking up On-Demand Pod ${podId}...`);
    await runpodGraphQL(`
      mutation podResume($input: PodResumeInput!) {
        podResume(input: $input) { id desiredStatus }
      }
    `, { input: { podId } });
  },

  /**
   * Stops an existing Pod.
   * This immediately detaches the GPU and freezes billing down to just Disk Storage.
   */
  async stopPod(podId: string): Promise<void> {
    console.log(`[runpod-api] Stopping On-Demand Pod ${podId}...`);
    await runpodGraphQL(`
      mutation podStop($input: PodStopInput!) {
        podStop(input: $input) { id desiredStatus }
      }
    `, { input: { podId } });
  },

  /**
   * Fetches the Pod state via GraphQL.
   */
  async getPodStatus(podId: string): Promise<RunPodStatus | null> {
    const apiKey = env.RUNPOD_API_KEY;
    if (!apiKey) return null;

    const data = await runpodGraphQL<any>(`
      query getPods {
        myself {
          pods {
            id name desiredStatus
            runtime { uptimeInSeconds ports { privatePort isIpPublic publicPort ip } }
          }
        }
      }
    `);

    return data?.myself?.pods?.find((p: any) => p.id === podId) || null;
  },

  /**
   * Polls the Pod status until `runtime` is fully injected with exposed Ports.
   */
  async waitForPodReady(podId: string, timeoutMs: number = 180000): Promise<void> {
    const start = Date.now();
    console.log(`[runpod-api] Polling getPodStatus for ${podId} until RUNNING...`);
    
    while (Date.now() - start < timeoutMs) {
      const pod = await this.getPodStatus(podId);
      
      // Pod is considered awake when desiredStatus == 'RUNNING' and runtime initialization succeeded
      if (pod && pod.desiredStatus === "RUNNING" && pod.runtime) {
        console.log(`[runpod-api] Pod is completely initialized! Took ${((Date.now() - start) / 1000).toFixed(1)}s`);
        return;
      }
      
      await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error(`Timeout waiting for RunPod On-Demand Pod ${podId} to boot up.`);
  }
};
