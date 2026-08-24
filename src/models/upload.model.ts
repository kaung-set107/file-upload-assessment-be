import mongoose, { Document, Schema, Types } from "mongoose";

export type UploadStatus = "public" | "private";

export interface IUpload extends Document {
  user: Types.ObjectId;
  file: string;
  description?: string;
  date: Date;
  status: UploadStatus;
  shareLink: string;
  shareToken: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const uploadSchema = new Schema<IUpload>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    file: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["public", "private"],
      default: "private",
      required: true,
    },
    shareLink: {
      type: String,
      required: true,
      trim: true,
    },
    shareToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    originalName: {
      type: String,
      trim: true,
    },
    mimeType: {
      type: String,
      trim: true,
    },
    size: {
      type: Number,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

export const Upload = mongoose.model<IUpload>("Upload", uploadSchema);
