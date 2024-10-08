// https://nuxt.com/docs/api/configuration/nuxt-config
import vuetify, { transformAssetUrls } from "vite-plugin-vuetify";

export default defineNuxtConfig({
  $production: {
    build: {
      transpile: ["vuetify"],
    },
    experimental: {
      watcher: "chokidar",
    },
    css: ["maplibre-gl/dist/maplibre-gl.css", "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css", "maplibre-gl-basemaps/lib/basemaps.css"],
    runtimeConfig: {
      public: {
        REALTIME_URL: process.env.REALTIME_URL || "http://geoglify.com",
        EXP_API_URL: process.env.EXP_API_URL || "http://geoglify.com",
        API_URL: process.env.API_URL || "http://geoglify.com/php/api",
        TILESERVER_URL: process.env.TILESERVER_URL || "http://geoglify.com/tileserver",
        MAPBOX_TOKEN: process.env.MAPBOX_TOKEN,
        OPENWEATHERMAP_API_KEY: process.env.OPENWEATHERMAP_API_KEY,
      },
    },
    modules: [
      "@sidebase/nuxt-auth",
      "nuxt3-vuex-module",
      "nuxt-gtag",
      "nuxt-svgo",
      "@nuxtjs/google-fonts",
      (_options, nuxt) => {
        nuxt.hooks.hook("vite:extendConfig", (config) => {
          // @ts-expect-error
          config.plugins.push(vuetify({ autoImport: true }));
        });
      },
    ],
    auth: {
      baseURL: "http://localhost:8082/auth",
      provider: {
        type: "local",
        endpoints: {
          signIn: { path: "/login", method: "post" },
          signOut: { path: "/logout", method: "get" },
          signUp: { path: "/register", method: "post" },
          getSession: { path: "/me", method: "get" },
        },
        token: {
          signInResponseTokenPointer: "/accessToken",
        },
        sessionDataType: {},
      },
    },
    svgo: {
      autoImportPath: "../../../node_modules/circle-flags/flags/",
    },
    ssr: false,
    vite: {
      vue: {
        template: {
          transformAssetUrls,
        },
      },
    },
    googleFonts: {
      families: {
        Nunito: {
          // weights
          wght: "200..1000",
          ital: "200..1000",
        },
      },
    },
  },
  $development: {
    devtools: { enabled: true },
    build: {
      transpile: ["vuetify"],
    },
    experimental: {
      watcher: "chokidar",
    },
    css: ["maplibre-gl/dist/maplibre-gl.css", "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css", "maplibre-gl-basemaps/lib/basemaps.css"],
    runtimeConfig: {
      public: {
        REALTIME_URL: process.env.REALTIME_URL || "http://localhost:8080",
        EXP_API_URL: process.env.EXP_API_URL || "http://localhost:8080",
        API_URL: process.env.API_URL || "http://localhost:8082/api",
        TILESERVER_URL: process.env.TILESERVER_URL || "http://localhost:3001",
        MAPBOX_TOKEN: process.env.MAPBOX_TOKEN,
        OPENWEATHERMAP_API_KEY: process.env.OPENWEATHERMAP_API_KEY,
      },
    },
    modules: [
      "@sidebase/nuxt-auth",
      "nuxt3-vuex-module",
      "nuxt-gtag",
      "nuxt-svgo",
      "@nuxtjs/google-fonts",
      (_options, nuxt) => {
        nuxt.hooks.hook("vite:extendConfig", (config) => {
          // @ts-expect-error
          config.plugins.push(vuetify({ autoImport: true }));
        });
      },
    ],
    auth: {
      baseURL: process.env.NUXT_AUTH_URL || "http://localhost:8082/api/auth",
      provider: {
        type: "local",
        endpoints: {
          signIn: { path: "/login", method: "post" },
          signOut: { path: "/logout", method: "get" },
          signUp: { path: "/register", method: "post" },
          getSession: { path: "/me", method: "get" },
        },
        token: {
          signInResponseTokenPointer: "/accessToken",
        },
        sessionDataType: {},
      },
    },
    gtag: {
      id: "G-DX7RJHR1G4",
    },
    svgo: {
      autoImportPath: "../../../node_modules/circle-flags/flags/",
    },
    ssr: false,
    vite: {
      vue: {
        template: {
          transformAssetUrls,
        },
      },
    },
    googleFonts: {
      families: {
        Nunito: {
          // weights
          wght: "200..1000",
          ital: "200..1000",
        },
      },
    },
  },
});
