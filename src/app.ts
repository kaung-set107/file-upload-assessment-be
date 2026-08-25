import "./config/env";
import cookieParser from "cookie-parser";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import uploadRoutes from "./routes/upload.routes";
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

dns.setDefaultResultOrder("ipv4first");

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
app.use(cookieParser());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/uploads", uploadRoutes);

export default app;
