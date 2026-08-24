import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "../models/user.model";

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: UserRole;
  };
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const token = authHeader.split(" ")[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({
      message: "JWT secret is missing",
    });
  }

  try {
    const decoded = jwt.verify(token, secret) as {
      userId: string;
      role: UserRole;
    };

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}
