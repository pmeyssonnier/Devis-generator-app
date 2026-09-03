import { defineConfig, devices } from "@playwright/test";

/*
 * Deux parcours navigateur, joues a chaque PR au meme titre que les tests unitaires.
 * Ils repondent a ce que core.test.js ne peut pas verifier : que l'application
 * assemblee — DOM, IndexedDB, telechargements — fasse bien ce qu'elle promet.
 */
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: /.*\.spec\.mjs/,
  // Un test de bout en bout qui echoue par intermittence ne prouve rien : aucune
  // reprise automatique, un echec est un echec.
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8123",
    // Environnement fournissant deja un Chromium (conteneur de developpement) :
    // PLAYWRIGHT_CHROMIUM evite d'en telecharger un second. La CI, elle, installe
    // celui qui correspond a la version de @playwright/test.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node test/e2e/serveur.mjs",
    url: "http://127.0.0.1:8123/index.html",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
