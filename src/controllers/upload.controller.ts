import { Request, Response } from "express";
import { randomUUID } from "crypto";
import mongoose, { HydratedDocument } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { IUpload, Upload } from "../models/upload.model";

import {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  deleteObjectFromS3,
  deleteObjectsFromS3,
  deleteObjectsFromS3ByPrefix,
} from "../config/s3";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  cancelBatchUploadSchema,
  createBatchUploadSchema,
  createUploadSchema,
  presignBatchUploadSchema,
  presignUploadSchema,
  updateUploadSchema,
} from "../schemas/upload.schema";
import { getObjectFromS3 } from "../services/s3.service";

function buildShareLink(req: Request, shareToken: string) {
  const protocolHeader = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(protocolHeader)
    ? protocolHeader[0]
    : protocolHeader?.split(",")[0] || req.protocol || "http";
  const host = req.get("host") || `localhost:${process.env.PORT || 5000}`;

  return `${protocol}://${host}/api/uploads/share/${shareToken}`;
}

type UploadDocument = HydratedDocument<IUpload>;

function formatUpload(upload: UploadDocument) {
  return {
    id: upload._id.toString(),
    user: upload.user.toString(),
    file: upload.file,
    s3Key: upload.s3Key,
    description: upload.description,
    date: upload.date,
    status: upload.status,
    shareLink: upload.shareLink,
    shareToken: upload.shareToken,
    originalName: upload.originalName,
    mimeType: upload.mimeType,
    size: upload.size,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
  };
}

function canAccessUpload(req: AuthRequest, upload: UploadDocument) {
  return (
    req.user?.role === "admin" || upload.user.toString() === req.user?.userId
  );
}

type QuotaCheckResult =
  | {
      ok: true;
      usedStorageBytes: number;
      remainingStorageBytes: number;
    }
  | {
      ok: false;
      status: 413;
      message: string;
      maxFileSizeBytes: number;
      usedStorageBytes: number;
      remainingStorageBytes: number;
    };

type BatchUploadFile = {
  fileName: string;
  contentType?: string;
  size: number;
};

type BatchQuotaCheckResult =
  | {
      ok: true;
      usedStorageBytes: number;
      remainingStorageBytes: number;
      batchSizeBytes: number;
    }
  | {
      ok: false;
      status: 413;
      message: string;
      maxFileSizeBytes: number;
      usedStorageBytes: number;
      remainingStorageBytes: number;
      batchSizeBytes: number;
    };

async function getUserStorageUsageBytes(
  userId: string,
  excludedUploadId?: string,
) {
  const match: Record<string, unknown> = {
    user: new mongoose.Types.ObjectId(userId),
  };

  if (excludedUploadId && mongoose.isValidObjectId(excludedUploadId)) {
    match._id = { $ne: new mongoose.Types.ObjectId(excludedUploadId) };
  }

  const [result] = await Upload.aggregate<{
    _id: null;
    totalSize: number;
  }>([
    {
      $match: match,
    },
    {
      $group: {
        _id: null,
        totalSize: {
          $sum: {
            $ifNull: ["$size", 0],
          },
        },
      },
    },
  ]);

  return result?.totalSize ?? 0;
}

async function validateUploadQuota(options: {
  userId: string;
  fileSizeBytes: number;
  excludedUploadId?: string;
}): Promise<QuotaCheckResult> {
  const usedStorageBytes = await getUserStorageUsageBytes(
    options.userId,
    options.excludedUploadId,
  );
  const remainingStorageBytes =
    MAX_UPLOAD_FILE_SIZE_BYTES - usedStorageBytes;

  if (options.fileSizeBytes > remainingStorageBytes) {
    return {
      ok: false,
      status: 413,
      message: "File exceeds the remaining 5 GB storage quota",
      maxFileSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
      usedStorageBytes,
      remainingStorageBytes: Math.max(remainingStorageBytes, 0),
    };
  }

  return {
    ok: true,
    usedStorageBytes,
    remainingStorageBytes: Math.max(remainingStorageBytes, 0),
  };
}

async function validateBatchUploadQuota(options: {
  userId: string;
  files: BatchUploadFile[];
}): Promise<BatchQuotaCheckResult> {
  const usedStorageBytes = await getUserStorageUsageBytes(options.userId);
  const batchSizeBytes = options.files.reduce((total, file) => total + file.size, 0);
  const remainingStorageBytes = MAX_UPLOAD_FILE_SIZE_BYTES - usedStorageBytes;

  if (batchSizeBytes > remainingStorageBytes) {
    return {
      ok: false,
      status: 413,
      message: "Batch exceeds the remaining 5 GB storage quota",
      maxFileSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
      usedStorageBytes,
      remainingStorageBytes: Math.max(remainingStorageBytes, 0),
      batchSizeBytes,
    };
  }

  return {
    ok: true,
    usedStorageBytes,
    remainingStorageBytes: Math.max(remainingStorageBytes, 0),
    batchSizeBytes,
  };
}

export async function createPresignedUpload(req: AuthRequest, res: Response) {
  const parsed = presignUploadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  if (parsed.data.fileId && !mongoose.isValidObjectId(parsed.data.fileId)) {
    return res.status(400).json({
      message: "Invalid upload id",
    });
  }

  const uploadSize = parsed.data.size;

  if (typeof uploadSize !== "number") {
    return res.status(400).json({
      message: "File size is required",
    });
  }

  const quotaCheck = await validateUploadQuota({
    userId: req.user.userId,
    fileSizeBytes: uploadSize!,
    excludedUploadId: parsed.data.fileId,
  });

  if (!quotaCheck.ok) {
    return res.status(quotaCheck.status).json({
      message: quotaCheck.message,
      maxFileSizeBytes: quotaCheck.maxFileSizeBytes,
      usedStorageBytes: quotaCheck.usedStorageBytes,
      remainingStorageBytes: quotaCheck.remainingStorageBytes,
    });
  }

  const { fileName, contentType } = parsed.data;
  const presigned = await createPresignedUploadUrl({
    userId: req.user.userId,
    fileName,
    contentType,
  });

  return res.status(200).json({
    message: "Presigned upload URL generated successfully",
    success: true,
    s3Key: presigned.fileKey,
    maxFileSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
    usedStorageBytes: quotaCheck.usedStorageBytes,
    remainingStorageBytes: quotaCheck.remainingStorageBytes,
    ...presigned,
  });
}

export async function createUpload(req: AuthRequest, res: Response) {
  const parsed = createUploadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const quotaCheck = await validateUploadQuota({
    userId: req.user.userId,
    fileSizeBytes: parsed.data.size!,
  });

  if (!quotaCheck.ok) {
    return res.status(quotaCheck.status).json({
      message: quotaCheck.message,
      maxFileSizeBytes: quotaCheck.maxFileSizeBytes,
      usedStorageBytes: quotaCheck.usedStorageBytes,
      remainingStorageBytes: quotaCheck.remainingStorageBytes,
    });
  }

  const shareToken = randomUUID();
  const shareLink = buildShareLink(req, shareToken);
  const upload = await Upload.create({
    user: req.user.userId,
    file: parsed.data.file,
    description: parsed.data.description || "",
    date: parsed.data.date || new Date(),
    status: parsed.data.status || "private",
    shareLink,
    s3Key: parsed.data.s3Key,
    shareToken,
    originalName: parsed.data.originalName,
    mimeType: parsed.data.mimeType,
    size: parsed.data.size!,
  });

  return res.status(201).json({
    message: "Upload created successfully",
    success: true,
    upload: formatUpload(upload),
  });
}

export async function createBatchPresignedUpload(
  req: AuthRequest,
  res: Response,
) {
  const parsed = presignBatchUploadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const quotaCheck = await validateBatchUploadQuota({
    userId: req.user.userId,
    files: parsed.data.files,
  });

  if (!quotaCheck.ok) {
    return res.status(quotaCheck.status).json({
      message: quotaCheck.message,
      maxFileSizeBytes: quotaCheck.maxFileSizeBytes,
      usedStorageBytes: quotaCheck.usedStorageBytes,
      remainingStorageBytes: quotaCheck.remainingStorageBytes,
      batchSizeBytes: quotaCheck.batchSizeBytes,
    });
  }

  const uploads = await Promise.all(
    parsed.data.files.map(async (file) => {
      const presigned = await createPresignedUploadUrl({
        userId: req.user!.userId,
        fileName: file.fileName,
        contentType: file.contentType,
      });

      return {
        fileName: file.fileName,
        contentType: file.contentType,
        size: file.size,
        s3Key: presigned.fileKey,
        uploadUrl: presigned.uploadUrl,
        fileUrl: presigned.fileUrl,
        expiresIn: presigned.expiresIn,
      };
    }),
  );

  return res.status(200).json({
    message: "Batch presigned upload URLs generated successfully",
    success: true,
    maxFileSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
    usedStorageBytes: quotaCheck.usedStorageBytes,
    remainingStorageBytes: quotaCheck.remainingStorageBytes,
    batchSizeBytes: quotaCheck.batchSizeBytes,
    uploads,
  });
}

export async function createBatchUpload(req: AuthRequest, res: Response) {
  const parsed = createBatchUploadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const quotaCheck = await validateBatchUploadQuota({
    userId: req.user.userId,
    files: parsed.data.uploads.map((upload) => ({
      fileName: upload.file,
      size: upload.size,
    })),
  });

  if (!quotaCheck.ok) {
    return res.status(quotaCheck.status).json({
      message: quotaCheck.message,
      maxFileSizeBytes: quotaCheck.maxFileSizeBytes,
      usedStorageBytes: quotaCheck.usedStorageBytes,
      remainingStorageBytes: quotaCheck.remainingStorageBytes,
      batchSizeBytes: quotaCheck.batchSizeBytes,
    });
  }

  const uploadsToCreate = parsed.data.uploads.map((upload) => {
    const shareToken = randomUUID();

    return {
      user: req.user!.userId,
      file: upload.file,
      description: upload.description || "",
      date: upload.date || new Date(),
      status: upload.status || "private",
      shareLink: buildShareLink(req, shareToken),
      s3Key: upload.s3Key,
      shareToken,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.size,
    };
  });

  const uploads = (await Upload.insertMany(uploadsToCreate)) as unknown as UploadDocument[];

  return res.status(201).json({
    message: "Batch uploads created successfully",
    success: true,
    uploads: uploads.map(formatUpload),
  });
}

export async function cancelBatchUpload(req: AuthRequest, res: Response) {
  const parsed = cancelBatchUploadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  if (
    req.user.role !== "admin" &&
    !parsed.data.s3Key.startsWith(`uploads/${req.user.userId}/`)
  ) {
    return res.status(403).json({
      message: "You do not have permission to remove this upload",
    });
  }

  const query =
    req.user.role === "admin"
      ? { s3Key: parsed.data.s3Key }
      : {
          s3Key: parsed.data.s3Key,
          user: req.user.userId,
        };

  const upload = await Upload.findOneAndDelete(query);

  await deleteObjectFromS3(parsed.data.s3Key);

  return res.status(200).json({
    success: true,
    message: "Pending upload removed successfully",
    deletedRecord: Boolean(upload),
  });
}

export async function getUserUploadsLeftFileSize(
  req: AuthRequest,
  res: Response,
) {
  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const usedStorageBytes = await getUserStorageUsageBytes(req.user.userId);
  const remainingStorageBytes = Math.max(
    MAX_UPLOAD_FILE_SIZE_BYTES - usedStorageBytes,
    0,
  );

  return res.json({
    success: true,
    maxFileSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
    usedStorageBytes,
    remainingStorageBytes,
  });
}

export async function getUploads(req: AuthRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const query = req.user.role === "admin" ? {} : { user: req.user.userId };
  const uploads = await Upload.find(query).sort({ createdAt: -1 });

  return res.json({
    success: true,
    uploads: uploads.map(formatUpload),
  });
}

export async function getUploadById(req: AuthRequest, res: Response) {
  try {
    const upload = await Upload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        message: "Upload not found",
      });
    }

    if (upload.status === "public") {
      return res.json({
        success: true,
        upload: {
          id: upload._id.toString(),
          originalName: upload.originalName,
          mimeType: upload.mimeType,
          status: upload.status,
        },
      });
    }

    if (!req.user) {
      return res.status(401).json({
        message: "Login required to access this private file",
      });
    }

    // Owner check
    if (upload.user.toString() !== req.user.userId) {
      return res.status(403).json({
        message: "You do not have permission to access this file",
      });
    }

    return res.json({
      success: true,
      upload: {
        id: upload._id.toString(),
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        status: upload.status,
      },
    });
  } catch (error) {
    console.error("Get upload error:", error);

    return res.status(500).json({
      message: "Unable to get file",
    });
  }
}

export async function updateUpload(req: AuthRequest, res: Response) {
  const parsed = updateUploadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({
      message: "Invalid upload id",
    });
  }

  const upload = await Upload.findById(id);

  if (!upload) {
    return res.status(404).json({
      message: "Upload not found",
    });
  }

  if (!canAccessUpload(req, upload)) {
    return res.status(403).json({
      message: "Forbidden",
    });
  }

  if (parsed.data.size !== undefined) {
    const uploadSize = parsed.data.size;

    const quotaCheck = await validateUploadQuota({
      userId: req.user.userId,
      fileSizeBytes: uploadSize!,
      excludedUploadId: upload._id.toString(),
    });

    if (!quotaCheck.ok) {
      return res.status(quotaCheck.status).json({
        message: quotaCheck.message,
        maxFileSizeBytes: quotaCheck.maxFileSizeBytes,
        usedStorageBytes: quotaCheck.usedStorageBytes,
        remainingStorageBytes: quotaCheck.remainingStorageBytes,
      });
    }
  }

  const previousFileKey = upload.s3Key || upload.file;
  const nextFileKey = parsed.data.s3Key || parsed.data.file;

  if (parsed.data.file !== undefined) {
    upload.file = parsed.data.file;
  }

  if (parsed.data.description !== undefined) {
    upload.description = parsed.data.description;
  }

  if (parsed.data.date !== undefined) {
    upload.date = parsed.data.date;
  }

  if (parsed.data.status !== undefined) {
    upload.status = parsed.data.status;
  }

  if (parsed.data.originalName !== undefined) {
    upload.originalName = parsed.data.originalName;
  }

  if (parsed.data.mimeType !== undefined) {
    upload.mimeType = parsed.data.mimeType;
  }

  if (parsed.data.size !== undefined) {
    upload.size = parsed.data.size!;
  }

  await upload.save();

  if (nextFileKey && nextFileKey !== previousFileKey) {
    await deleteObjectFromS3(previousFileKey);
  }

  return res.json({
    message: "Upload updated successfully",
    success: true,
    upload: formatUpload(upload),
  });
}

export async function deleteUpload(req: AuthRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({
      message: "Invalid upload id",
    });
  }

  const upload = await Upload.findById(id);

  if (!upload) {
    return res.status(404).json({
      message: "Upload not found",
    });
  }

  if (!canAccessUpload(req, upload)) {
    return res.status(403).json({
      message: "Forbidden",
    });
  }

  await deleteObjectFromS3(upload.s3Key);
  await upload.deleteOne();

  return res.json({
    message: "Upload deleted successfully",
    success: true,
  });
}

export async function deleteAllUploads(req: AuthRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const deletedFromS3 = await deleteObjectsFromS3ByPrefix(
    `uploads/${req.user.userId}/`,
  );

  const result = await Upload.deleteMany({ user: req.user.userId });

  return res.json({
    message: "All uploads deleted successfully",
    success: true,
    deletedCount: result.deletedCount ?? deletedFromS3,
    deletedFromS3,
  });
}

export async function getSharedUpload(req: Request, res: Response) {
  const shareToken = req.params.token;

  if (!shareToken) {
    return res.status(400).json({
      message: "Share token is required",
    });
  }

  const upload = await Upload.findOne({ shareToken });

  if (!upload) {
    return res.status(404).json({
      message: "Upload not found",
    });
  }
  const downloadUrl = await createPresignedDownloadUrl(upload.s3Key);

  return res.json({
    success: true,
    upload: formatUpload(upload),
    downloadUrl,
  });
}

export async function getDownload(req: AuthRequest, res: Response) {
  try {
    const upload = await Upload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        message: "Upload not found",
      });
    }

    if (upload.status === "private") {
      if (!req.user) {
        return res.status(401).json({
          message: "Login required",
        });
      }

      if (upload.user.toString() !== req.user.userId) {
        return res.status(403).json({
          message: "You do not have permission to access this file",
        });
      }
    }

    const s3Object = await getObjectFromS3(upload.s3Key);

    if (!s3Object.Body) {
      return res.status(404).json({
        message: "File not found in S3",
      });
    }

    const contentLength = s3Object.ContentLength || upload.size;

    if (contentLength) {
      res.setHeader("Content-Length", contentLength.toString());
    }

    res.setHeader("Access-Control-Expose-Headers", "Content-Length");

    res.setHeader(
      "Content-Type",
      upload.mimeType || "application/octet-stream",
    );

    res.setHeader("Cache-Control", "private, no-cache, no-store");

    const body = s3Object.Body;

    if (body && "pipe" in body) {
      (body as NodeJS.ReadableStream).pipe(res);
    }
  } catch (error) {
    console.error("Get upload content error:", error);

    return res.status(500).json({
      message: "Unable to retrieve file",
    });
  }
}
