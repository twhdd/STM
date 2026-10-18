const jwt = require("jsonwebtoken");
const User = require("../models/User");

const validRoles = User.schema.path("role").enumValues;

const verifyAccessToken = (token) => {
    const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET,
        { algorithms: ["HS256"] }
    );

    if (!decoded.userId || !validRoles.includes(decoded.role)) {
        throw new Error("Invalid or expired token");
    }

    return {
        userId: decoded.userId,
        role: decoded.role
    };
};

const authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: "Access token required"
            });
        }

        const parts = authHeader.split(" ");

        if (parts.length !== 2 || parts[0] !== "Bearer") {
            return res.status(401).json({
                success: false,
                message: "Invalid authorization format"
            });
        }

        const token = parts[1];

        req.user = verifyAccessToken(token);

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }
};


const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to access this resource"
            });
        }

        next();
    };
};


module.exports = {
    authenticateToken,
    authorizeRoles,
    verifyAccessToken
};