const readline = require("readline");
const { MongoClient } = require("mongodb");
const net = require("net");
const { log } = require("console");
const exp = require("constants");
const AisDecode = require("ggencoder").AisDecode;
const session = {};

// Configurations
const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING || "mongodb://root:root@localhost:27778/?directConnection=true&authMechanism=DEFAULT";
const AIS_SERVER_HOST = process.env.AIS_SERVER_HOST || "153.44.253.27";
const AIS_SERVER_PORT = process.env.AIS_SERVER_PORT || 5631;

// MongoDB client
const mongoClient = new MongoClient(MONGODB_CONNECTION_STRING);

// Variables to store AIS messages and ships list
let aisMessageBuffer = [];
let aisMessageDB = new Map();
let isIndexCreated = false;
let isProcessing = false;

// Logging function for information messages
function logInfo(message) {
  console.info(`\x1b[33m[${new Date().toLocaleString({ timeZone: "UTC" })}]\x1b[0m ${message}`);
}

// Logging function for error messages
function logError(message) {
  console.error(`\x1b[31m[${new Date().toLocaleString({ timeZone: "UTC" })}]\x1b[0m ${message}`);
}

// Logging function for success messages
function logSuccess(message) {
  console.info(`\x1b[32m[${new Date().toLocaleString({ timeZone: "UTC" })}]\x1b[0m ${message}`);
}

// Loggin function for warning messages
function logWarning(message) {
  console.info(`\x1b[90m[${new Date().toLocaleString({ timeZone: "UTC" })}]\x1b[0m ${message}`);
}

// Function to connect to MongoDB with retry mechanism
async function connectToMongoDBWithRetry() {
  try {
    logWarning("Connecting to MongoDB...");
    await mongoClient.connect();
    logSuccess("MongoDB Connected");
  } catch (err) {
    logError("Failed to connect to MongoDB, retrying...");
    setTimeout(connectToMongoDBWithRetry, 5000);
  }
}

// Main processing function
async function startProcessing() {
  const database = mongoClient.db("geoglify");
  const realtimeMessagesCollection = database.collection("realtime");
  const historicalMessagesCollection = database.collection("historical");

  // Function to process and save messages in the database
  async function processAndSaveMessages() {
    if (!isProcessing && aisMessageBuffer.length > 0) {
      isProcessing = true;

      const bulkRealtimeOperations = [];
      const bulkHistoricalOperations = [];

      const bufferSize = Math.min(aisMessageBuffer.length, 200);

      for (let i = 0; i < bufferSize; i++) {
        const mmsi = aisMessageBuffer[i];
        const message = aisMessageDB.get(mmsi);

        delete message._id;

        // Iterate through each attribute and delete if empty or null
        for (const key in message) {
          if (message.hasOwnProperty(key) && (message[key] === null || message[key] === undefined || message[key] === "")) {
            delete message[key];
          }
        }

        // Create a location field if lat and lon are present
        if (!!message["lat"] && !!message["lon"]) {
          message["location"] = {
            type: "Point",
            coordinates: [message.lon, message.lat],
          };
        }

        // Save realtime messages (all attributes)
        bulkRealtimeOperations.push({
          updateOne: {
            filter: { mmsi: mmsi },
            update: { $set: message },
            upsert: true,
          },
        });

        let now = new Date();
        
        // insert all messages (only mmsi and location) and set expiration time to 7 days
        bulkHistoricalOperations.push({
          insertOne: {
            mmsi: message.mmsi,
            location: message.location,
            cog: message.cog,
            hdg: message.hdg,
            sog: message.sog,
            expire_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            updated_at: new Date(),
          },
        });
      }

      aisMessageBuffer.splice(0, bufferSize);

      try {
        logInfo(`Inserting or Updating ${bulkRealtimeOperations.length} operations into the realtime collection...`);
        await realtimeMessagesCollection.bulkWrite(bulkRealtimeOperations, {
          ordered: false,
        });
        logSuccess("Realtime messages saved successfully!");

        logInfo(`Inserting or Updating ${bulkHistoricalOperations.length} operations into the historical collection...`);
        await historicalMessagesCollection.bulkWrite(bulkHistoricalOperations, {
          ordered: false,
        });
        logSuccess("Historical messages saved successfully!");

        logInfo(`Remaining in aisMessageBuffer: ${aisMessageBuffer.length}`);
      } catch (error) {
        logError("Error while processing bulk operations");
      }

      isProcessing = false;
    } else {
      logError("No messages to process or already processing...");
    }
  }

  // Set interval to process and save messages every 5 seconds
  setInterval(processAndSaveMessages, 5000);

  // Create an index for expire_at field if not already created
  if (!isIndexCreated) {

    realtimeMessagesCollection.createIndex({ expire_at: 1 }, { expireAfterSeconds: 0 });
    historicalMessagesCollection.createIndex({ expire_at: 1 }, { expireAfterSeconds: 0 });

    realtimeMessagesCollection.createIndex({ location: "2dsphere" });
    historicalMessagesCollection.createIndex({ location: "2dsphere" });

    isIndexCreated = true;
  }
}

// Function to connect to AIS server with retry mechanism
async function connectToAisServerWithRetry() {
  try {
    let aisSocket = new net.Socket();
    logWarning("Connecting to AIS server...\n");

    aisSocket.connect(AIS_SERVER_PORT, AIS_SERVER_HOST, function () {
      logSuccess("Connected to AIS server\n");
      startProcessing();
    });

    var lineReader = readline.createInterface({
      input: aisSocket,
      output: aisSocket,
      terminal: false,
    });

    lineReader.on("line", function (message) {
      const regex = /\\([^\\]+)\\/g;
      const inputString = message.toString();
      const outputString = inputString.replace(regex, "");
      logInfo("Received AIS message: " + outputString);
      processAisMessage(outputString);
    });

    aisSocket.on("error", function (err) {
      logError("Error while connecting to AIS server: " + err);
      setTimeout(connectToAisServerWithRetry, 5000);
    });
  } catch (err) {
    logError("Failed to connect to AIS server, retrying...");
    setTimeout(connectToAisServerWithRetry, 5000);
  }
}

// Function to process AIS and NMEA messages
function processAisMessage(message) {
  var decMsg = new AisDecode(message, session);
  if (decMsg.valid) logSuccess("Decoded AIS message \x1b[32m MMSI: " + decMsg.mmsi + ", Lat: " + decMsg?.lat + ", Lon: " + decMsg?.lon + "\n\x1b[0m");

  if (decMsg.valid) {
    let now = new Date();

    message = {
      ...decMsg,
      utc: new Date(now.getTime() - decMsg.utc),
      expire_at: new Date(now.getTime() + 30 * 60 * 1000), // Set expiration time to 30 minutes in the future
      updated_at: new Date(),
      ais_server_host: AIS_SERVER_HOST,
    };

    delete message.bitarray;
    delete message.valid;
    delete message.payload;
    delete message.mmsikey;

    aisMessageDB.set(message.mmsi, message);

    if (!aisMessageBuffer.includes(message.mmsi)) aisMessageBuffer.push(message.mmsi);
  }
}

// Start the process by connecting to MongoDB and AIS server
connectToMongoDBWithRetry();
connectToAisServerWithRetry();
