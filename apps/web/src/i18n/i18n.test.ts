import { describe, expect, it, afterEach } from "vitest";
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
    expect(i18n.t("nav.map", { ns: "common" })).toBe("Map");
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
  });

  it("switches to Spanish", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.language).toBe("es");
    expect(i18n.t("nav.map", { ns: "common" })).toBe("Mapa");
    expect(i18n.t("nav.fleet", { ns: "common" })).toBe("Flota");
    expect(i18n.t("topbar.signIn", { ns: "common" })).toBe("Iniciar sesión");
  });

  it("loads Spanish identity namespace", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.t("creator.title", { ns: "identity" })).toBe("Lanza Tu Aerolínea");
    expect(i18n.t("guest.playFree", { ns: "identity" })).toBe(
      "Juega gratis — sin registro requerido",
    );
  });

  it("falls back to English for unsupported language", async () => {
    await i18n.changeLanguage("xx");
    expect(i18n.t("nav.map", { ns: "common" })).toBe("Map");
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
