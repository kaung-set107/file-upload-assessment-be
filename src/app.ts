import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

dns.setDefaultResultOrder("ipv4first");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    message: "Senior Fullstack Test API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);

export default app;
