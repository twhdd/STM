
const mongoose = require("mongoose");
const DEVELOPMENT_DATABASE_NAME = "stm_test";

function getConnectionOptions(environment = process.env) {
    const databaseName = environment.STM_TEST_DATABASE_NAME ||
        (environment.NODE_ENV === "production" ? undefined : DEVELOPMENT_DATABASE_NAME);

    if (!databaseName) return {};

    if (!/test/i.test(databaseName)) {
        throw new Error("STM_TEST_DATABASE_NAME must contain 'test'.");
    }

    return { dbName: databaseName };
}

const connectDB = async ({
    environment = process.env,
    mongooseInstance = mongoose,
    logger = console,
    exitProcess = process.exit,
} = {}) => {
    try {
        const options = getConnectionOptions(environment);

        if (options.dbName) {
            logger.log(`Using test database: ${options.dbName}`);
        }

        await mongooseInstance.connect(environment.MONGO_URI, options);
        logger.log(
            `MongoDB connected successfully (database: ${mongooseInstance.connection.name})`
        );
    } catch (error) {
        logger.error("MongoDB connection failed:");
        logger.error(error.message);
        exitProcess(1);
    }
};

module.exports = connectDB;
module.exports.DEVELOPMENT_DATABASE_NAME = DEVELOPMENT_DATABASE_NAME;
module.exports.getConnectionOptions = getConnectionOptions;
