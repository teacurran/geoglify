// Description: MongoDB operations for Geoglify API.
const { MongoClient } = require("mongodb");
const { ObjectId } = require("mongodb");

// MongoDB Connection String
const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING || "mongodb://root:root@localhost:27778/?directConnection=true&authMechanism=DEFAULT";

console.info("Connecting to MongoDBX:", MONGODB_CONNECTION_STRING);

const mongoClient = new MongoClient(MONGODB_CONNECTION_STRING);

/*
 * Get the list of ships.
 * */
async function getAISShips() {
  const results = await mongoClient
    .db("geoglify")
    .collection("realtime")
    .aggregate([
      {
        $lookup: {
          from: "ships",
          localField: "mmsi",
          foreignField: "mmsi",
          as: "ship_details",
        },
      },
      {
        $unwind: "$ship_details",
      },
      {
        $project: {
          _id: 1,
          mmsi: 1,
          shipname: "$ship_details.shipname",
          cargo: "$ship_details.cargo",
          hdg: 1,
          location: 1,
          utc: 1,
          dimA: "$ship_details.dimA",
          dimB: "$ship_details.dimB",
          dimC: "$ship_details.dimC",
          dimD: "$ship_details.dimD",
          length: "$ship_details.length",
          width: "$ship_details.width",
        },
      },
    ])
    .toArray();

  return results;
}

/*
 * Get the list of ships with optional search parameters.
 * */
async function searchAISShips(page, itemsPerPage, searchText, cargos = [], geometry = null) {
  let match = {};

  if (!!searchText && searchText.length > 0) {
    match.$or = [{ mmsi: { $regex: searchText, $options: "i" } }, { shipname: { $regex: searchText, $options: "i" } }];
  }

  if (cargos.length > 0) {
    match["cargo"] = { $in: cargos };
  } else {
    return { items: [], total: 0 };
  }

  if (geometry) {
    match.location = {
      $geoIntersects: {
        $geometry: geometry,
      },
    };
  }

  let pipeline = [
    {
      $lookup: {
        from: "ships",
        localField: "mmsi",
        foreignField: "mmsi",
        as: "ship_details",
      },
    },
    {
      $unwind: "$ship_details",
    },
    {
      $project: {
        _id: 1,
        mmsi: 1,
        shipname: "$ship_details.shipname",
        cargo: { $ifNull: ["$ship_details.cargo", 0] },
        hdg: 1,
        location: 1,
        utc: 1,
        dimA: "$ship_details.dimA",
        dimB: "$ship_details.dimB",
        dimC: "$ship_details.dimC",
        dimD: "$ship_details.dimD",
        length: "$ship_details.length",
        width: "$ship_details.width",
        lat: { $arrayElemAt: ["$location.coordinates", 1] },
        lon: { $arrayElemAt: ["$location.coordinates", 0] },
      },
    },
    { $match: match },
    { $skip: (page - 1) * itemsPerPage },
    { $limit: itemsPerPage },
  ];

  let countPipeline = [
    {
      $lookup: {
        from: "ships",
        localField: "mmsi",
        foreignField: "mmsi",
        as: "ship_details",
      },
    },
    {
      $unwind: "$ship_details",
    },
    {
      $project: {
        _id: 1,
        mmsi: 1,
        shipname: "$ship_details.shipname",
        cargo: { $ifNull: ["$ship_details.cargo", 0] },
        hdg: 1,
        location: 1,
        utc: 1,
        dimA: "$ship_details.dimA",
        dimB: "$ship_details.dimB",
        dimC: "$ship_details.dimC",
        dimD: "$ship_details.dimD",
        length: "$ship_details.length",
        width: "$ship_details.width",
        lat: { $arrayElemAt: ["$location.coordinates", 1] },
        lon: { $arrayElemAt: ["$location.coordinates", 0] },
      },
    },
    { $match: match },
    { $count: "total" },
  ];

  try {
    let ships = await mongoClient.db("geoglify").collection("realtime").aggregate(pipeline).toArray();
    let countResult = await mongoClient.db("geoglify").collection("realtime").aggregate(countPipeline).toArray();
    let total = countResult.length > 0 ? countResult[0].total : 0;

    return { items: ships, total: total };
  } catch (error) {
    console.error("Error executing searchAISShips pipeline:", error);
    return { items: [], total: 0 };
  }
}

/*
 * Get the details of a ship by its ID.
 * */
async function getAISShip(shipId) {
  // Convert the ship ID to an ObjectId
  const objectId = new ObjectId(shipId);

  // Fetch ship data from MongoDB
  let data = await mongoClient
    .db("geoglify")
    .collection("realtime")
    .aggregate([
      {
        $match: { _id: objectId },
      },
      {
        $lookup: {
          from: "ships",
          localField: "mmsi",
          foreignField: "mmsi",
          as: "ship_details",
        },
      },
      {
        $unwind: "$ship_details",
      },
      {
        $project: {
          _id: 1,
          mmsi: 1,
          shipname: "$ship_details.shipname",
          callsign: 1,
          cargo: "$ship_details.cargo",
          dimA: "$ship_details.dimA",
          dimB: "$ship_details.dimB",
          dimC: "$ship_details.dimC",
          dimD: "$ship_details.dimD",
          length: "$ship_details.length",
          width: "$ship_details.width",
          cog: 1,
          hdg: 1,
          sog: 1,
          utc: 1,
          eta: 1,
          destination: 1,
          draught: 1,
        },
      },
    ])
    .toArray();

  // Check if data was found
  if (data.length === 0) return null;

  // Extract the first element of the data array
  data = data[0];

  // Add the historical path to the data object
  data.path = await getHistoricalPath(data.mmsi);

  return data;
}

/*
 * Get the historical path of a ship by MMSI.
 */
async function getHistoricalPath(mmsi) {
  // Fetch historical data from MongoDB
  let data = await mongoClient
    .db("geoglify")
    .collection("historical")
    .find(
      { mmsi: mmsi },
      {
        projection: {
          _id: 0, // Exclude the _id field from the projection
          location: 1,
          cog: 1,
          hdg: 1,
          sog: 1,
          updated_at: 1,
        },
      }
    )
    .toArray();

  // Check if data was found
  if (data.length === 0) {
    // Return an empty FeatureCollection if no data found
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  // Create an array to hold GeoJSON features
  const features = [];

  // Extract coordinates from each location point and filter points with valid sog
  const validPoints = data.filter((d) => d.sog !== null && d.sog > 0).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  // Create GeoJSON Point features for each location point with valid sog
  validPoints.forEach((d) => {
    const pointFeature = {
      type: "Feature",
      properties: {
        cog: d.cog,
        hdg: d.hdg,
        sog: d.sog,
        updated_at: d.updated_at,
      },
      geometry: {
        type: "Point",
        coordinates: d.location.coordinates,
      },
    };

    // Push each Point feature to the features array
    features.push(pointFeature);
  });

  // Return the GeoJSON FeatureCollection
  return {
    type: "FeatureCollection",
    features: features,
  };
}

/*
 * Get the historical positions of all ships before the given timestamp.
 * The positions are the last known positions of each ship before the given timestamp.
 * The positions are filtered to exclude ships whose last update was more than 30 minutes before the given timestamp.
 */
async function getAISShipsHistory(timestamp) {
  try {
    const timeout = 30 * 60 * 1000; // 30 minutes in milliseconds
    const timestampDate = new Date(parseInt(timestamp));
    const halfHourAgoDate = new Date(timestampDate.getTime() - timeout);

    // Find the last position of each ship before the given timestamp and exclude those older than 30 minutes
    let data = await mongoClient
      .db("geoglify")
      .collection("historical")
      .aggregate([
        {
          $match: {
            updated_at: { $lte: timestampDate }, // Consider only positions before or at the given timestamp
          },
        },
        {
          $sort: {
            updated_at: -1, // Sort by date in descending order to get the most recent position first
          },
        },
        {
          $group: {
            _id: "$mmsi", // Group by MMSI to get the last position of each ship
            doc: { $first: "$$ROOT" }, // Select the first document of each group, which is the most recent one
          },
        },
        {
          $replaceRoot: { newRoot: "$doc" }, // Replace the root document with the selected document
        },
        {
          $match: {
            updated_at: { $gte: halfHourAgoDate }, // Exclude ships whose last update was more than 30 minutes before the given timestamp
          },
        },
        {
          $lookup: {
            from: "ships",
            localField: "mmsi",
            foreignField: "mmsi",
            as: "ship_details",
          },
        },
        {
          $unwind: "$ship_details",
        },
        {
          $project: {
            _id: 0,
            mmsi: 1,
            shipname: "$ship_details.shipname",
            cargo: { $ifNull: ["$ship_details.cargo", 0] },
            hdg: 1,
            location: 1,
            cog: 1,
            sog: 1,
            utc: 1,
            dimA: "$ship_details.dimA",
            dimB: "$ship_details.dimB",
            dimC: "$ship_details.dimC",
            dimD: "$ship_details.dimD",
            length: "$ship_details.length",
            width: "$ship_details.width",
            updated_at: 1,
          },
        },
      ])
      .toArray();

    return data;
  } catch (error) {
    console.error("Error fetching historical ships:", error);
    throw error;
  }
}

/*
 * Get all ship paths between two timestamps.
 * The paths are constructed from historical data between the given timestamps.
 */
async function getHistoricalPathsBetweenTimestamps(startTime, endTime) {
  try {
    const startDate = new Date(parseInt(startTime));
    const endDate = new Date(parseInt(endTime));

    // Fetch historical data between the given timestamps from MongoDB
    let data = await mongoClient
      .db("geoglify")
      .collection("historical")
      .find(
        {
          updated_at: { $gte: startDate, $lte: endDate },
        },
        {
          projection: {
            _id: 0, // Exclude the _id field from the projection
            mmsi: 1,
            location: 1,
            cog: 1,
            hdg: 1,
            sog: 1,
            updated_at: 1,
          },
        }
      )
      .toArray();

    // Check if data was found
    if (data.length === 0) {
      // Return an empty FeatureCollection if no data found
      return {
        type: "FeatureCollection",
        features: [],
      };
    }

    // Group data by MMSI
    const groupedData = data.reduce((acc, item) => {
      acc[item.mmsi] = acc[item.mmsi] || [];
      acc[item.mmsi].push(item);
      return acc;
    }, {});

    // Create an array to hold GeoJSON features
    const features = [];

    // Iterate through each group of data (by MMSI)
    Object.keys(groupedData).forEach((mmsi) => {
      const shipData = groupedData[mmsi];

      // Extract coordinates from each location point and filter points with valid sog
      const validPoints = shipData.filter((d) => d.sog !== null && d.sog > 0).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      const coordinates = validPoints.map((d) => d.location.coordinates);

      // Create the GeoJSON LineString feature if there are valid coordinates
      if (coordinates.length > 1) {
        const lineFeature = {
          type: "Feature",
          properties: {
            mmsi: mmsi,
          },
          geometry: {
            type: "LineString",
            coordinates: coordinates,
          },
        };

        // Push the LineString feature to the features array
        features.push(lineFeature);
      }
    });

    // Return the GeoJSON FeatureCollection
    return {
      type: "FeatureCollection",
      features: features,
    };
  } catch (error) {
    console.error("Error fetching historical paths between timestamps:", error);
    throw error;
  }
}

module.exports = {
  getAISShips,
  getAISShip,
  searchAISShips,
  getHistoricalPath,
  getAISShipsHistory,
  getHistoricalPathsBetweenTimestamps,
};
