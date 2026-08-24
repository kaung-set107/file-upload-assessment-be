import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";

export async function getProfile(req: AuthRequest, res: Response) {
  return res.json({
    message: "Profile fetched successfully",
    user: req.user,
  });
}

export async function getMessage(req: AuthRequest, res: Response) {
  res.json({
    message: "Hello",
  });
}

export async function getAdminDashboard(req: AuthRequest, res: Response) {
  return res.json({
    message: "Admin dashboard data",
    user: req.user,
  });
}
