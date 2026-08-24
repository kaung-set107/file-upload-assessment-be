import { Router } from "express";
import { getAdminDashboard, getMessage, getProfile } from "../controllers/user.controller";
import { auth } from "../middleware/auth.middleware";
import { authorize } from "../middleware/authorize.middleware";

const router = Router();

router.get("/message",getMessage)
router.get("/profile", auth, getProfile);
router.get("/admin/dashboard", auth, authorize("admin"), getAdminDashboard);

export default router;
