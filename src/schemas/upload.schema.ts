import { z } from "zod";

const uploadStatusSchema = z.enum(["public", "private"]);
export const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

const batchUploadItemSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  contentType: z.string().min(1).optional(),
  size: z.coerce.number().int().nonnegative(),
});

export const presignUploadSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  contentType: z.string().min(1).optional(),
  size: z.coerce.number().int().nonnegative(),
  fileId: z.string().min(1).optional(),
});

export const createUploadSchema = z.object({
  file: z.string().min(1, "File key is required"),
  description: z.string().max(2000).optional(),
  date: z.coerce.date().optional(),
  status: uploadStatusSchema.optional(),
  originalName: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  size: z.coerce.number().int().nonnegative(),
  s3Key: z.string().min(1),
});

export const updateUploadSchema = createUploadSchema.partial();

export const presignBatchUploadSchema = z.object({
  files: z.array(batchUploadItemSchema).min(1, "At least one file is required"),
});

export const createBatchUploadSchema = z.object({
  uploads: z
    .array(
      z.object({
        file: z.string().min(1, "File key is required"),
        s3Key: z.string().min(1),
        description: z.string().max(2000).optional(),
        date: z.coerce.date().optional(),
        status: uploadStatusSchema.optional(),
        originalName: z.string().min(1).optional(),
        mimeType: z.string().min(1).optional(),
        size: z.coerce.number().int().nonnegative(),
      }),
    )
    .min(1, "At least one upload is required"),
});

export const cancelBatchUploadSchema = z.object({
  s3Key: z.string().min(1, "S3 key is required"),
});

export const shareTokenParamSchema = z.object({
  token: z.string().min(1, "Share token is required"),
});
