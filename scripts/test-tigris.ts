import { S3Client, PutObjectCommand, ListBucketsCommand } from "@aws-sdk/client-s3";
import "dotenv/config";

const endpoint = process.env.TIGRIS_ENDPOINT_URL!;
const bucket = process.env.TIGRIS_BUCKET_NAME!;
const accessKeyId = process.env.TIGRIS_ACCESS_KEY_ID!;
const secretAccessKey = process.env.TIGRIS_SECRET_ACCESS_KEY!;

console.log("Endpoint:", endpoint);
console.log("Bucket:", bucket);
console.log("Access Key ID:", accessKeyId.slice(0, 10) + "...");

const s3 = new S3Client({
  region: process.env.TIGRIS_REGION ?? "auto",
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

async function main() {
  // Test 1: List buckets
  console.log("\n--- Test 1: ListBuckets ---");
  try {
    const res = await s3.send(new ListBucketsCommand({}));
    console.log("Buckets:", res.Buckets?.map((b) => b.Name));
  } catch (e: any) {
    console.error("ListBuckets failed:", e.Code ?? e.message);
  }

  // Test 2: PutObject
  console.log("\n--- Test 2: PutObject ---");
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "test-write.txt",
        Body: "hello",
        ContentType: "text/plain",
      }),
    );
    console.log("PutObject succeeded!");
  } catch (e: any) {
    console.error("PutObject failed:", e.Code ?? e.message);
    console.error("Full error:", e);
  }
}

main();
