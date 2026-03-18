import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/utils/env.server";

const s3 = new S3Client({
  region: env.TIGRIS_REGION,
  endpoint: env.TIGRIS_ENDPOINT_URL,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.TIGRIS_ACCESS_KEY_ID,
    secretAccessKey: env.TIGRIS_SECRET_ACCESS_KEY,
  },
});

const bucket = env.TIGRIS_BUCKET_NAME;

export const tigris = {
  /**
   * Generate a presigned PUT URL for direct client upload.
   */
  async presignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn = 600,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(s3, command, { expiresIn });
  },

  /**
   * Generate a presigned GET URL for downloading/viewing a file.
   */
  async presignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return getSignedUrl(s3, command, { expiresIn });
  },

  /**
   * Upload a buffer or stream directly from the server.
   */
  async upload(
    key: string,
    body: Buffer | Uint8Array | ReadableStream,
    contentType: string,
  ) {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    return s3.send(command);
  },

  /**
   * Download a file as a readable stream.
   */
  async download(key: string) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const response = await s3.send(command);
    return response.Body;
  },

  /**
   * Delete a file from storage.
   */
  async remove(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return s3.send(command);
  },

  /**
   * Configure CORS on the bucket. Run once after bucket creation.
   */
  async configureCors(allowedOrigins: string[]) {
    const command = new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "HEAD"],
            AllowedOrigins: allowedOrigins,
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    });
    return s3.send(command);
  },
};
