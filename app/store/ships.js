// Import necessary modules and libraries
import configs from "@/helpers/configs";

export const state = () => ({
  list: [],
  selected: null,
  selectedDetails: null,
  selectedCargos: configs.getCargos(),
  listOpened: false,
});

export const actions = {
  // Action to fetch the ship list
  async FETCH({ commit }) {
    return new Promise(async (resolve) => {
      const ships = await $fetch("/api/ships");
      commit("createOrReplace", ships);
      resolve(ships);
    });
  },

  // Action to create or replace the ship list
  async CREATE_OR_REPLACE({ commit }, ships) {
    commit("createOrReplace", ships);
  },

  // Action to set the selected ship
  async SET_SELECTED({ commit }, ship) {
    return new Promise(async (resolve) => {
      if (ship?._id) {
        const data = await $fetch("/api/ship/" + ship?._id);
        data.countryCode = configs.getCountryCode(data.mmsi);
        commit("setSelectedShip", data);
        resolve();
      } else {
        commit("setSelectedShip", null);
        resolve();
      }
    });
  },

  // Action to search for ships
  async SEARCH(_, payload) {
    return new Promise(async (resolve) => {
      // Fetch the search results from the server
      const results = await $fetch("/api/ships/search", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Process the ship data and add country code
      results.items = results.items.map((ship) => {
        ship.countrycode = configs.getCountryCode(ship.mmsi);
        return ship;
      });

      // Resolve the promise with the search results
      resolve(results);
    });
  },
};

export const mutations = {
  // Action to set the selected ship
  setSelectedShip(state, ship) {
    state.selected = ship;
  },

  // Action to create or replace the ship list
  createOrReplace(state, ships) {
    // Check if ships is a valid array
    if (!Array.isArray(ships)) {
      state.list = [];
    }

    // Process ship data and filter out invalid entries
    const processedShips = ships.map(processShipData).filter(Boolean);

    // Create a copy of the existing ship list to avoid direct mutations
    const list = [...state.list];

    // Update or add new ships to the ship list
    processedShips.forEach((newShip) => {
      const index = list.findIndex((ship) => ship._id === newShip._id);
      if (index !== -1) {
        list[index] = newShip; // Replace existing ship
      } else {
        list.push(newShip); // Add new ship
      }
    });

    state.list = list;
  },
};

function processShipData(ship) {
  const { hdg, cargo, mmsi } = ship;

  const isHeadingValid = !!(hdg && hdg !== 511);

  if (isHeadingValid) {
    ship.icon = "models/boat.svg";
    ship.size = 22;
    ship.width = 41;
    ship.height = 96;
    
  } else {
    ship.icon = "models/circle.png";
    ship.size = 10;
    ship.width = 20;
    ship.height = 20;
  }

  const cargoType = configs.getCargoType(cargo);

  ship.color = configs.hexToRgb(cargoType.color);
  ship.priority = -(isHeadingValid ? cargoType.priority * -100 : -100);

  if (!!mmsi) ship.countrycode = configs.getCountryCode(mmsi);

  //geojson 
  ship.geojson = configs.processGeoJSON(ship);

  return ship;
}