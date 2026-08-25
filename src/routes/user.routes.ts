import { Router } from "express";
import { getProfile, getUserList, updateStatus } from "../controllers/user.controller";
import { auth } from "../middleware/auth.middleware";
import { authorize } from "../middleware/authorize.middleware";

const router = Router();

router.get("/profile", auth, getProfile);
router.get("/", auth, authorize("admin"), getUserList);
router.patch("/:id/status", auth, authorize("admin"), updateStatus);


export default router;
