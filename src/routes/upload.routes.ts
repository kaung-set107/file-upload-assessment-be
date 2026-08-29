import { Router } from "express";
import {
  createBatchPresignedUpload,
  createBatchUpload,
  cancelBatchUpload,
  createPresignedUpload,
  createUpload,
  deleteAllUploads,
  deleteUpload,
  getDownload,
  getSharedUpload,
  getUploadById,
  getUploads,
  getUserUploadsLeftFileSize,
  updateUpload,
} from "../controllers/upload.controller";
import { auth, optionalAuth } from "../middleware/auth.middleware";
import { authorize } from "../middleware/authorize.middleware";

const router = Router();

router.post("/presign", auth, createPresignedUpload);
router.post("/", auth, createUpload);
router.post("/presign-batch", auth, createBatchPresignedUpload);
router.post("/batch", auth, createBatchUpload);
router.post("/batch/cancel", auth, cancelBatchUpload);
router.delete("/all", auth, authorize("admin", "user"), deleteAllUploads);
router.get("/quota", auth, authorize("admin", "user"), getUserUploadsLeftFileSize);
router.get("/", auth, authorize("admin", "user"), getUploads);
router.get("/share/:token", getSharedUpload);
router.get("/:id/download", optionalAuth, getDownload);
router.get("/:id", optionalAuth, getUploadById);
router.patch("/:id", auth, updateUpload);
router.delete("/:id", auth, deleteUpload);

export default router;
