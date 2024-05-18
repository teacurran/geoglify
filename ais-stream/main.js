const { log } = require("console");
const { MongoClient } = require("mongodb");
const net = require("net");
const WebSocket = require("ws");

// Configurations
const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING || "mongodb://root:root@localhost:27778/?directConnection=true&authMechanism=DEFAULT";
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY || "7fb1e16f93a4d520d83a95e325c55e69b3b4fc0b";
const AIS_SERVER_HOST = process.env.AIS_SERVER_HOST || "aisstream.io";

const TIMEOUT_LOOP = process.env.TIMEOUT_LOOP || 1000;
const NUMBER_OF_EMITS = process.env.NUMBER_OF_EMITS || 1000;

// MongoDB client
const mongoClient = new MongoClient(MONGODB_CONNECTION_STRING);

// Variables to store AIS messages and ships list
let aisMessageBuffer = [];
let aisMessageDB = new Map();
let isIndexCreated = false;
let isProcessing = false;

// Logging function for information messages
function logInfo(message) {
  console.info(`\x1b[33m[${new Date().toLocaleString("en-GB", { timeZone: "UTC" })}]\x1b[0m ${message}`);
}

// Logging function for error messages
function logError(message) {
  console.error(`\x1b[31m[${new Date().toLocaleString("en-GB", { timeZone: "UTC" })}]\x1b[0m ${message}`);
}

// Logging function for success messages
function logSuccess(message) {
  console.info(`\x1b[32m[${new Date().toLocaleString("en-GB", { timeZone: "UTC" })}]\x1b[0m ${message}`);
}

// Loggin function for warning messages
function logWarning(message) {
  console.info(`\x1b[90m[${new Date().toLocaleString("en-GB", { timeZone: "UTC" })}]\x1b[0m ${message}`);
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

  // Function to process and save messages in the database
  async function processAndSaveMessages() {
    if (!isProcessing && aisMessageBuffer.length > 0) {
      isProcessing = true;

      const bulkOperations = [];

      const bufferSize = Math.min(aisMessageBuffer.length, NUMBER_OF_EMITS);

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

        bulkOperations.push({
          updateOne: {
            filter: { mmsi: mmsi },
            update: { $set: message },
            upsert: true,
          },
        });
      }

      try {
        logInfo(`Inserting or Updating ${bulkOperations.length} operations into the realtime collection...`);
        await realtimeMessagesCollection.bulkWrite(bulkOperations, {
          ordered: false,
        });
        aisMessageBuffer.splice(0, bufferSize);
        logInfo(`Remaining in aisMessageBuffer: ${aisMessageBuffer.length}`);
      } catch (error) {
        logError("Error while processing bulk operations");
      }

      isProcessing = false;
    } else {
      logError("No messages to process or already processing...");
    }
  }

  // Set interval to process and save messages every TIMEOUT_LOOP seconds
  setInterval(processAndSaveMessages, TIMEOUT_LOOP);

  // Create an index for expire_at field if not already created
  if (!isIndexCreated) {
    realtimeMessagesCollection.createIndex({ expire_at: 1 }, { expireAfterSeconds: 0 });
    isIndexCreated = true;
  }
}

// Function to connect to AIS stream with retry mechanism
async function connectToAisStreamWithRetry() {
  try {
    logWarning("Connecting to AIS stream...\n");
    const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");

    // WebSocket event handlers
    socket.onopen = function (_) {
      logInfo("Connected to AIS stream");
      let subscriptionMessage = {
        Apikey: AISSTREAM_API_KEY,
        //Portugal + Spain
        BoundingBoxes: [
          [
            [29.343875, -35.419922],
            [45.690833, 6.394043],
          ],
        ],
        /*BoundingBoxes: [
          [
            [-90, -180],
            [90, 180],
          ],
        ]*/
      };
      socket.send(JSON.stringify(subscriptionMessage));
    };

    socket.onclose = function (_) {
      logError("WebSocket Closed, retrying...");
      setTimeout(connectToAisStreamWithRetry, 5000);
    };

    socket.onmessage = async (event) => {
      let aisMessage = JSON.parse(event.data);
      logInfo("Received data from AIS stream!", aisMessage);
      processAisMessage(aisMessage);
    };

    startProcessing();
  } catch (err) {
    logError("Failed to connect to AIS stream, retrying...");
    setTimeout(connectToAisStreamWithRetry, 5000);
  }
}

// Function to process AIS and NMEA messages
function processAisMessage(message) {
  message = decodeStreamMessage(message);

  aisMessageDB.set(message.mmsi, message);

  if (!aisMessageBuffer.includes(message.mmsi)) aisMessageBuffer.push(message.mmsi);
}

function decodeStreamMessage(message) {
  let now = new Date();
  message.expire_at = new Date(now.getTime() + 30 * 60 * 1000); // Set expiration time to 30 minutes in the future

  logSuccess("Decoded AIS message MMSI: \x1b[32m" + message.MetaData.MMSI + "\n\x1b[0m");

  let ship = {
    immsi: parseInt(message.MetaData.MMSI),
    mmsi: message.MetaData.MMSI.toString(),
    shipname: message.MetaData.ShipName.trim(),
    utc: new Date(message.MetaData.time_utc),
    location: {
      type: "Point",
      coordinates: [message.MetaData.longitude, message.MetaData.latitude],
    },
    ais_server_host: AIS_SERVER_HOST,
    cog: message?.Message?.PositionReport?.Cog || message?.Message?.StandardClassBPositionReport?.Cog,
    sog: message?.Message?.PositionReport?.Sog || message?.Message?.StandardClassBPositionReport?.Sog,
    hdg: message?.Message?.PositionReport?.TrueHeading || message?.Message?.StandardClassBPositionReport?.TrueHeading,
    dimA: message?.Message?.ShipStaticData?.Dimension?.A,
    dimB: message?.Message?.ShipStaticData?.Dimension?.B,
    dimC: message?.Message?.ShipStaticData?.Dimension?.C,
    dimD: message?.Message?.ShipStaticData?.Dimension?.D,
    imo: message?.Message?.ShipStaticData?.ImoNumber,
    destination: message?.Message?.ShipStaticData?.Destination,
    cargo: message?.Message?.ShipStaticData?.Type,
    callsign: message?.Message?.ShipStaticData?.CallSign,
    draught: message?.Message?.ShipStaticData?.MaximumStaticDraught,
    imo: message?.Message?.ShipStaticData?.ImoNumber,
    expire_at: new Date(now.getTime() + 30 * 60 * 1000), // Set expiration time to 30 minutes in the future
  };

  let etaObj = message?.Message?.ShipStaticData?.Eta;
  let eta = etaObj ? new Date(etaObj.Year ?? new Date().getFullYear(), etaObj.Month, etaObj.Day, etaObj.Hour, etaObj.Minute) : null;

  ship.eta = eta;

  return ship;
}

// Start the process by connecting to MongoDB and AIS stream
connectToMongoDBWithRetry();
connectToAisStreamWithRetry();
