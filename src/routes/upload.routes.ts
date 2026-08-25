import { Router } from "express";
import {
  createPresignedUpload,
  createUpload,
  deleteUpload,
  getDownload,
  getSharedUpload,
  getUploadById,
  getUploads,
  updateUpload,
} from "../controllers/upload.controller";
import { auth, optionalAuth } from "../middleware/auth.middleware";
import { authorize } from "../middleware/authorize.middleware";

const router = Router();

router.post("/presign", auth, createPresignedUpload);
router.post("/", auth, createUpload);
router.get("/", auth, authorize("user"), getUploads);
router.get("/share/:token", getSharedUpload);
router.get("/:id/download", optionalAuth, getDownload);
router.get("/:id", optionalAuth, getUploadById);
router.patch("/:id", auth, updateUpload);
router.delete("/:id", auth, deleteUpload);

export default router;
