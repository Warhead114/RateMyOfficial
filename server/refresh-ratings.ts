import { storage } from "./storage";

async function refreshAllOfficialRatings() {
  console.log("Starting admin utility to refresh all official ratings");
  
  try {
    await storage.refreshAllOfficialRatings();
    console.log("Successfully refreshed all official ratings");
  } catch (error) {
    console.error("Error refreshing official ratings:", error);
  } finally {
    process.exit(0);
  }
}

refreshAllOfficialRatings();