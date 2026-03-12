import { afterEach, describe, expect, it } from "vitest";
import i18n from "./index";

describe("i18n", () => {
  afterEach(async () => {
    // Reset to English after each test
    await i18n.changeLanguage("en");
  });

  it("initializes with English as fallback language", () => {
    expect(i18n.options.fallbackLng).toEqual(["en"]);
  });

  it("loads English common namespace", () => {
    expect(i18n.t("nav.map", { ns: "common" })).toBe("Cockpit");
    expect(i18n.t("nav.fleet", { ns: "common" })).toBe("Fleet");
    expect(i18n.t("topbar.signIn", { ns: "common" })).toBe("Sign in");
  });

  it("loads English identity namespace", () => {
    expect(i18n.t("gate.connecting", { ns: "identity" })).toBe(
      "Establishing secure connection to Nostr network...",
    );
    expect(i18n.t("creator.title", { ns: "identity" })).toBe("Launch Your Airline");
  });

  it("loads English game namespace", () => {
    expect(i18n.t("leaderboard.fleetSize", { ns: "game" })).toBe("Fleet Size");
    expect(i18n.t("flightBoard.departures", { ns: "game" })).toBe("Departures");
    expect(i18n.t("corporate.pageTitle", { ns: "game" })).toBe("Corporate");
    expect(i18n.t("routeManager.suspended.title", { ns: "game" })).toBe("Suspended Routes");
    expect(i18n.t("fleet.searchPlaceholder", { ns: "game" })).toBe("Search active fleet…");
    expect(i18n.t("fleet.purchaseUsedTitle", { ns: "game" })).toBe("Purchase used aircraft?");
    expect(i18n.t("airportPanel.openHubConfirm", { ns: "game" })).toBe("Open Hub");
    expect(i18n.t("aircraftPanel.title", { ns: "game" })).toBe("Aircraft");
    expect(i18n.t("corporate.hubContractReview", { ns: "game" })).toBe("Hub Contract Review");
  });

  it("switches to Spanish", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.language).toBe("es");
    expect(i18n.t("nav.map", { ns: "common" })).toBe("Cabina");
    expect(i18n.t("nav.fleet", { ns: "common" })).toBe("Flota");
    expect(i18n.t("topbar.signIn", { ns: "common" })).toBe("Iniciar sesión");
  });

  it("loads Spanish identity namespace", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.t("creator.title", { ns: "identity" })).toBe("Lanza Tu Aerolínea");
    expect(i18n.t("guest.playFree", { ns: "identity" })).toBe(
      "Juega gratis — sin registro requerido",
    );
    expect(i18n.t("access.corporateLockedTitle", { ns: "identity" })).toBe(
      "Acceso corporativo bloqueado",
    );
  });

  it("loads Spanish common and game additions for interface flows", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.t("panel.closeAria", { ns: "common" })).toBe("Cerrar panel y volver a cabina");
    expect(i18n.t("actions.cancel", { ns: "common" })).toBe("Cancelar");
    expect(i18n.t("topbar.openPanel", { ns: "common", panel: "cabina de vuelo" })).toBe(
      "Abrir cabina de vuelo",
    );
    expect(i18n.t("join.features.realTimeFlights.title", { ns: "common" })).toBe(
      "Vuelos en tiempo real",
    );
    expect(i18n.t("hubPicker.dialogTitle", { ns: "game" })).toBe("Elegir un aeropuerto hub");
    expect(i18n.t("fleet.searchPlaceholder", { ns: "game" })).toBe("Buscar flota activa…");
    expect(i18n.t("fleet.purchaseUsedTitle", { ns: "game" })).toBe("¿Comprar aeronave usada?");
    expect(i18n.t("airportPanel.openHubConfirm", { ns: "game" })).toBe("Abrir hub");
    expect(i18n.t("aircraftPanel.title", { ns: "game" })).toBe("Aeronave");
    expect(i18n.t("corporate.hubContractReview", { ns: "game" })).toBe(
      "Revisión del contrato del hub",
    );
    expect(i18n.t("backup.localKeyAccessFailed", { ns: "identity" })).toBe(
      "No se pudo acceder a tu clave de cuenta almacenada localmente.",
    );
  });

  it("falls back to English for unsupported language", async () => {
    await i18n.changeLanguage("xx");
    expect(i18n.t("nav.map", { ns: "common" })).toBe("Cockpit");
  });

  it("handles interpolation", () => {
    expect(i18n.t("topbar.relaysOnline", { ns: "common", count: 3 })).toBe("3 relays online");
    expect(i18n.t("topbar.relaysOnline", { ns: "common", count: 1 })).toBe("1 relay online");
  });

  it("updates HTML lang attribute on language change", async () => {
    await i18n.changeLanguage("es");
    expect(document.documentElement.lang).toBe("es");
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("has all supported languages defined", () => {
    const supportedLngs = i18n.options.supportedLngs;
    expect(supportedLngs).toContain("en");
    expect(supportedLngs).toContain("es");
  });
});
