import {
  S3Client,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import "dotenv/config";

const s3 = new S3Client({
  region: process.env.TIGRIS_REGION ?? "auto",
  endpoint: process.env.TIGRIS_ENDPOINT_URL!,
  credentials: {
    accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY!,
  },
});

async function main() {
  const bucket = process.env.TIGRIS_BUCKET_NAME!;

  console.log(`Setting CORS policy on bucket: ${bucket}`);

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "HEAD"],
            AllowedOrigins: ["http://localhost:5173", "http://localhost:3000", process.env.APP_URL!],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );

  console.log("CORS policy set successfully.");
}

main().catch((err) => {
  console.error("Failed to set CORS:", err);
  process.exit(1);
});
