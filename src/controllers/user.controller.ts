import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { User } from "../models/user.model";
import { statusUpdateSchema } from "../schemas/auth.schema";
import mongoose from "mongoose";

export async function getProfile(req: AuthRequest, res: Response) {
  try {
    const userData = await User.findById(req.user?.userId);

    if (!userData) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      message: "Profile fetched successfully",
      user: userData,
    });
  } catch (error) {
    console.error("Get upload error:", error);

    return res.status(500).json({
      message: "Unable to get file",
    });
  }
}

export async function getUserList(req: AuthRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const userList = await User.find().sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    users: userList,
  });
}

export async function updateStatus(req: AuthRequest, res: Response) {
  const parsed = statusUpdateSchema.safeParse(req.body);

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
      message: "Invalid user id",
    });
  }

  const user = await User.findById(id);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  if (parsed.data.status !== undefined) {
    user.status = parsed.data.status;
  }

  await user.save();

  return res.json({
    message: "Status updated successfully",
    success: true,
  });
}
