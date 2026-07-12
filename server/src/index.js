import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import restaurantRoutes from "./routes/restaurants.js";
import freelancerRoutes from "./routes/freelancers.js";
import userRoutes from "./routes/users.js";
import availabilityRoutes from "./routes/availability.js";
import assignmentRoutes from "./routes/assignments.js";
import scoreRoutes from "./routes/score.js";
import schedulingRoutes from "./routes/scheduling.js";
import dashboardRoutes from "./routes/dashboard.js";
import attendanceRoutes from "./routes/attendance.js";
import calendarRoutes from "./routes/calendar.js";
import swapRoutes from "./routes/swaps.js";
import feedbackRoutes from "./routes/feedback.js";
import payrollRoutes from "./routes/payroll.js";
import vacancyRoutes from "./routes/vacancies.js";
import notificationRoutes from "./routes/notifications.js";
import extraShiftRoutes from "./routes/extraShifts.js";
import settingsRoutes from "./routes/settings.js";
import { startScheduler } from "./scheduler.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("select now() as now");
    res.json({ ok: true, db: "postgresql", now: rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/freelancers", freelancerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/score", scoreRoutes);
app.use("/api/scheduling", schedulingRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/swaps", swapRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/vacancies", vacancyRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/extra-shifts", extraShiftRoutes);
app.use("/api/settings", settingsRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

// Safety net: a rejected promise in an un-try/catch'd async route must never take
// the whole server down. Log it and keep serving (the offending request 500s/aborts).
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`SkalaUp API (PostgreSQL) listening on http://localhost:${PORT}`);
  startScheduler();
});
