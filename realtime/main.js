// Import necessary libraries
const { MongoClient } = require("mongodb");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { getAISShips, getAISShip, searchAISShips, getAISShipsHistory, getHistoricalPathsBetweenTimestamps } = require("./mongodb");
const { logError, logInfo, logSuccess, logWarning } = require("./logger");

// Configurations
const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING || "mongodb://root:root@localhost:27778/?directConnection=true&authMechanism=DEFAULT";

console.info("Connecting to MongoDB:", MONGODB_CONNECTION_STRING);

// MongoDB client
const mongoClient = new MongoClient(MONGODB_CONNECTION_STRING);

// Socket CORS origin
const NUMBER_OF_EMITS = process.env.NUMBER_OF_EMITS || 25;
const TIMEOUT_LOOP = process.env.TIMEOUT_LOOP || 500;

// Create an Express app and an HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
  },
});

// Create a route to handle the root URL
let messages = new Map();
const messageQueue = [];
let dispatchTimeout = null;

app.use(express.json());
app.use(cors());

server.listen(8080, () => {
  logSuccess("Server running on port 8080");
});

// Default route
app.get("/", (_, res) => {
  res.json("Geoglify Naval API");
});

//
app.get("/ships", async (_, res) => {
  const ships = await getAISShips();
  res.json(ships);
});

app.get("/ship/:id", async (req, res) => {
  const _id = req.params.id;
  const ais_ship = await getAISShip(_id);
  res.json(ais_ship);
});

app.get("/history/:timestamp", async (req, res) => {
  const timestamp = req.params.timestamp;
  const ships = await getAISShipsHistory(timestamp);
  res.json(ships);
});

app.get("/paths/:start/:end", async (req, res) => {
  const start = req.params.start;
  const end = req.params.end;
  const paths = await getHistoricalPathsBetweenTimestamps(start, end);
  res.json(paths);
});

app.post("/ships/search", async (req, res) => {
  const page = parseInt(req.body.page) || 1;
  const itemsPerPage = parseInt(req.body.itemsPerPage) || 20;
  const searchText = req.body.searchText || "";
  const cargos = req.body.cargos || [];
  const geom = req.body.geom || null;
  const ships = await searchAISShips(page, itemsPerPage, searchText, cargos, geom);
  res.json(ships);
});

// This overrides the default error handler
app.use(function customErrorHandler(err, req, res, next) {
  res.status(400).send("Not allowed by CORS");
});

// Function to connect to MongoDB with retry mechanism
async function connectToMongoDBWithRetry() {
  try {
    logWarning("Connecting to MongoDB...");
    await mongoClient.connect(MONGODB_CONNECTION_STRING);
    logSuccess("MongoDB Connected");
    startApplication();
  } catch (err) {
    logError("Failed to connect to MongoDB, retrying...");
    setTimeout(connectToMongoDBWithRetry, 5000);
  }
}

// Define the run function
async function startApplication() {
  try {
    // Connect to the "geoglify" database and the "realtime" collection
    const database = mongoClient.db("geoglify");
    const realtimeMessagesCollection = database.collection("realtime");
    const shipsCollection = database.collection("ships");

    io.on("connection", (socket) => {
      logSuccess(`Client connected: \x1b[32m${socket.id}\x1b[0m`);
      socket.on("disconnect", () => logError(`Client disconnected: \x1b[31m${socket.id}\x1b[0m`));
    });

    const options = { fullDocument: "updateLookup" };
    const changeStream = realtimeMessagesCollection.watch([], options);

    // Listen for changes on the "realtime" collection
    changeStream.on("change", async (change) => {
      let ship = change.fullDocument;

      // Check if the ship object is valid
      if (!ship || !ship?.location) return;

      // Fetch ship details from the "ships" collection
      let shipDetails = await shipsCollection.findOne({ mmsi: ship.mmsi });

      if (!shipDetails) return;

      // Merge ship data from both collections into a single object
      let message = {
        _id: ship._id,
        mmsi: ship.mmsi,
        shipname: shipDetails.shipname || "N/A",
        cargo: shipDetails.cargo || ship.cargo,
        hdg: ship.hdg,
        location: ship.location,
        utc: ship.utc,
        dimA: shipDetails.dimA,
        dimB: shipDetails.dimB,
        dimC: shipDetails.dimC,
        dimD: shipDetails.dimD,
        length: shipDetails.length,
        width: shipDetails.width,
      };

      messages.set(message.mmsi, message);

      if (message && !messageQueue.includes(message.mmsi)) {
        messageQueue.push(message.mmsi);
      }
    });

    startDispatchLoop();
  } catch (error) {
    logError("Error running the application: " + error);
    await mongoClient.close();
  }
}

// Define the startDispatchLoop function
async function startDispatchLoop() {
  if (dispatchTimeout) {
    clearTimeout(dispatchTimeout);
  }

  let currentLength = messageQueue.length;
  let chunk = messageQueue.splice(0, NUMBER_OF_EMITS);

  logInfo(`Dispatching \x1b[32m${chunk.length}\x1b[0m. Remaining: \x1b[31m${currentLength - chunk.length}\x1b[0m`);

  let messagesToEmit = [];

  // Dispatch the messages
  for (let i = 0; i < chunk.length; i++) {
    let key = chunk[i];
    let message = messages.get(key);
    if (!message) continue;
    messagesToEmit.push(message);
    messages.delete(key);
  }

  await emitMessageChunk(messagesToEmit);

  // Schedule the next dispatch loop
  dispatchTimeout = setTimeout(startDispatchLoop.bind(this), TIMEOUT_LOOP);
}

// Define the emitMessage function
function emitMessage(msg) {
  return new Promise((resolve) => {
    io.sockets.emit("message", msg, () => {
      resolve();
    });
  });
}

// Define the emitMessageChunk function
function emitMessageChunk(msgs) {
  return new Promise((resolve) => {
    io.sockets.emit("messagesChunk", msgs, () => {
      resolve();
    });
  });
}

// Start the application
connectToMongoDBWithRetry();
