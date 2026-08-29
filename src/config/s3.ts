import { randomUUID } from "crypto";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AuthRequest } from "../middleware/auth.middleware";
import { IUpload, Upload } from "../models/upload.model";
function getS3Config() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region) {
    throw new Error("AWS_REGION is missing in .env");
  }

  if (!bucket) {
    throw new Error("AWS_S3_BUCKET is missing in .env");
  }

  if (!accessKeyId) {
    throw new Error("AWS_ACCESS_KEY_ID is missing in .env");
  }

  if (!secretAccessKey) {
    throw new Error("AWS_SECRET_ACCESS_KEY is missing in .env");
  }

  return {
    region,
    bucket,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  };
}

function sanitizeFileName(fileName: string) {
  const cleaned = fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "file";
}

export function buildFileKey(userId: string, fileName: string) {
  const safeFileName = sanitizeFileName(fileName);

  return `uploads/${userId}/${Date.now()}-${randomUUID()}-${safeFileName}`;
}

export function getS3Client() {
  const { region, credentials } = getS3Config();

  return new S3Client({
    region,
    credentials,
  });
}

export function getBucketName() {
  return getS3Config().bucket;
}

export function buildPublicFileUrl(fileKey: string) {
  const { bucket, region } = getS3Config();
  const encodedKey = fileKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export async function createPresignedUploadUrl(options: {
  userId: string;
  fileName: string;
  contentType?: string;
}) {
  const client = getS3Client();
  const bucket = getBucketName();
  const fileKey = buildFileKey(options.userId, options.fileName);
  const expiresIn = Number(process.env.S3_PRESIGN_EXPIRES_IN || 900);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fileKey,
    ContentType: options.contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn,
  });

  return {
    fileKey,
    uploadUrl,
    fileUrl: buildPublicFileUrl(fileKey),
    expiresIn,
  };
}

export async function createPresignedDownloadUrl(fileKey: string) {
  const client = getS3Client();
  const bucket = getBucketName();
  const expiresIn = Number(process.env.S3_DOWNLOAD_EXPIRES_IN || 900);

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: fileKey,
  });

  return getSignedUrl(client, command, {
    expiresIn,
  });
}

export async function deleteObjectFromS3(fileKey: string) {
  await deleteObjectsFromS3([fileKey]);
}

export async function deleteObjectsFromS3(fileKeys: string[]) {
  const uniqueKeys = [...new Set(fileKeys.filter(Boolean))];

  if (!uniqueKeys.length) {
    return;
  }

  const client = getS3Client();
  const bucket = getBucketName();

  for (let index = 0; index < uniqueKeys.length; index += 1000) {
    const chunk = uniqueKeys.slice(index, index + 1000);

    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );
  }
}

export async function deleteObjectsFromS3ByPrefix(prefix: string) {
  const client = getS3Client();
  const bucket = getBucketName();
  let continuationToken: string | undefined;
  let deletedCount = 0;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (response.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));

    if (keys.length > 0) {
      await deleteObjectsFromS3(keys);
      deletedCount += keys.length;
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return deletedCount;
}
