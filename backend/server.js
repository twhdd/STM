const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/database");
const authRoutes = require("./routes/authRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Authentication routes
app.use("/api/auth", authRoutes);

// Root endpoint
app.get("/", (req, res) => {
    res.json({
        message: "Smart Traffic Management System API",
        status: "running"
    });
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        status: "OK",
        service: "STM Backend"
    });
});

// Start server
const startServer = async () => {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`STM Backend running on http://localhost:${PORT}`);
    });
};

startServer();