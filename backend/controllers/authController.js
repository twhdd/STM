const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Role given to every account created through public registration
const PUBLIC_REGISTRATION_ROLE = "CITIZEN";

// Create a user account with an already-authorized role
const createAccount = async (req, res, role) => {
    try {
        const { fullName, email, password } = req.body;

        // Check required fields
        if (!fullName || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "fullName, email and password are required"
            });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Email already registered"
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = await User.create({
            fullName,
            email,
            password: hashedPassword,
            role
        });

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Registration error:", error);

        res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    }
};


// Public registration: always creates a CITIZEN account.
// A client may not choose a privileged role.
const register = async (req, res) => {
    const requestedRole = req.body && req.body.role;

    if (
        requestedRole !== undefined &&
        requestedRole !== null &&
        requestedRole !== "" &&
        requestedRole !== PUBLIC_REGISTRATION_ROLE
    ) {
        return res.status(403).json({
            success: false,
            message: `Public registration can only create ${PUBLIC_REGISTRATION_ROLE} accounts`
        });
    }

    return createAccount(req, res, PUBLIC_REGISTRATION_ROLE);
};


// Authorized provisioning (ADMIN only, enforced in the route):
// creates an account with any valid role, e.g. staff accounts.
const createUser = async (req, res) => {
    const requestedRole = req.body && req.body.role;
    const validRoles = User.schema.path("role").enumValues;

    if (!validRoles.includes(requestedRole)) {
        return res.status(400).json({
            success: false,
            message: `role must be one of: ${validRoles.join(", ")}`
        });
    }

    return createAccount(req, res, requestedRole);
};


// Login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        // Find user
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        // Compare password
        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        if (!User.schema.path("role").enumValues.includes(user.role)) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        // Create JWT
        const token = jwt.sign(
            {
                userId: user._id,
                role: user.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d"
            }
        );

        res.json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
};

module.exports = {
    register,
    createUser,
    login
};