const { Server } = require("socket.io");
const { verifyAccessToken } = require("../middleware/authMiddleware");
const { AUTHENTICATED_ROOM } = require("../services/realtimeService");

function authenticateSocket(socket, next) {
  const token = socket.handshake?.auth?.token;
  if (typeof token !== "string" || !token) {
    const error = new Error("Authentication required");
    error.data = { code: "UNAUTHORIZED" };
    next(error);
    return;
  }

  try {
    socket.data.user = verifyAccessToken(token);
    next();
  } catch {
    const error = new Error("Invalid or expired token");
    error.data = { code: "UNAUTHORIZED" };
    next(error);
  }
}

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ["GET", "POST"],
    },
  });

  io.use(authenticateSocket);
  io.on("connection", (socket) => {
    socket.join(AUTHENTICATED_ROOM);
  });

  return io;
}

module.exports = {
  authenticateSocket,
  createSocketServer,
};
