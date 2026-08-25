import { Request, Response } from "express";
import { randomUUID } from "crypto";
import mongoose, { HydratedDocument } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { IUpload, Upload } from "../models/upload.model";

import {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  deleteObjectFromS3,
} from "../config/s3";
import {
  createUploadSchema,
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
    size: parsed.data.size,
  });

  return res.status(201).json({
    message: "Upload created successfully",
    success: true,
    upload: formatUpload(upload),
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
    upload.size = parsed.data.size;
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
