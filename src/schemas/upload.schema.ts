import { z } from "zod";

const uploadStatusSchema = z.enum(["public", "private"]);

export const presignUploadSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  contentType: z.string().min(1).optional(),
});

export const createUploadSchema = z.object({
  file: z.string().min(1, "File key is required"),
  description: z.string().max(2000).optional(),
  date: z.coerce.date().optional(),
  status: uploadStatusSchema.optional(),
  originalName: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  size: z.coerce.number().int().nonnegative().optional(),
});

export const updateUploadSchema = createUploadSchema.partial();

export const shareTokenParamSchema = z.object({
  token: z.string().min(1, "Share token is required"),
});
