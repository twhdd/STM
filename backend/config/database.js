
const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const options = {};

        if (process.env.STM_TEST_DATABASE_NAME) {
            if (!/test/i.test(process.env.STM_TEST_DATABASE_NAME)) {
                throw new Error("STM_TEST_DATABASE_NAME must contain 'test'.");
            }

            options.dbName = process.env.STM_TEST_DATABASE_NAME;
            console.log(`Using test database: ${options.dbName}`);
        }

        await mongoose.connect(process.env.MONGO_URI, options);
        console.log("MongoDB connected successfully");
    } catch (error) {
        console.error("MongoDB connection failed:");
        console.error(error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
