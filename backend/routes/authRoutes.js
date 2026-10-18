const express = require("express");

const {
    register,
    createUser,
    login
} = require("../controllers/authController");

const {
    authenticateToken,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

// POST /api/auth/register  (PUBLIC: creates CITIZEN accounts only)
router.post("/register", register);

// POST /api/auth/login  (PUBLIC: this is how a token is obtained)
router.post("/login", login);

// POST /api/auth/users  (ADMIN only: provision an account with any role)
router.post(
    "/users",
    authenticateToken,
    authorizeRoles("ADMIN"),
    createUser
);

module.exports = router;
