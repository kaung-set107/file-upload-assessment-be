import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getBucketName, getS3Client } from "../config/s3";

export async function getObjectFromS3(fileKey: string) {
  const client = getS3Client();
  const bucket = getBucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: fileKey,
  });

  return client.send(command);
}
