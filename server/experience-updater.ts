
import { storage } from './storage';
import cron from 'node-cron';

interface SeasonYearTracker {
  lastUpdateYear: number;
}

let seasonTracker: SeasonYearTracker = {
  lastUpdateYear: new Date().getFullYear()
};

export async function initializeExperienceUpdater() {
  console.log('Initializing automatic experience updater...');
  
  // Load the last update year from settings
  try {
    const lastUpdateYear = await storage.getSetting('lastExperienceUpdateYear');
    if (lastUpdateYear) {
      seasonTracker.lastUpdateYear = parseInt(lastUpdateYear, 10);
    }
  } catch (error) {
    console.log('No previous experience update year found, using current year');
  }

  // Check if we need to update immediately (in case the server was down on Nov 1st)
  await checkAndUpdateExperience();

  // Schedule the cron job to run daily at 6:00 AM
  // This checks every day but only updates once per season
  cron.schedule('0 6 * * *', async () => {
    console.log('Running daily experience update check...');
    await checkAndUpdateExperience();
  });

  console.log('Experience updater initialized successfully');
}

async function checkAndUpdateExperience(): Promise<void> {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-based: 0 = January, 10 = November
    const currentDay = now.getDate();

    // Check if it's November 1st or later in the current season year
    // and we haven't updated for this season year yet
    if (currentMonth >= 10 && // November or later (10 = November in 0-based)
        currentYear > seasonTracker.lastUpdateYear) {
      
      console.log(`Season change detected! Updating all officials' experience from year ${seasonTracker.lastUpdateYear} to ${currentYear}`);
      
      await updateAllOfficialsExperience();
      
      // Update the tracker and save to database
      seasonTracker.lastUpdateYear = currentYear;
      await storage.updateSetting('lastExperienceUpdateYear', currentYear.toString());
      
      console.log(`Successfully updated all officials' experience for season ${currentYear}`);
    } else if (currentMonth >= 10) {
      console.log(`Already updated experience for season ${currentYear}`);
    } else {
      console.log(`Not yet November - current season update will occur on November 1st, ${currentYear}`);
    }
  } catch (error) {
    console.error('Error checking/updating experience:', error);
  }
}

async function updateAllOfficialsExperience(): Promise<void> {
  try {
    // Get all officials
    const { data: officials } = await storage.getOfficials();
    
    console.log(`Updating experience for ${officials.length} officials...`);
    
    // Update each official's years of experience
    for (const official of officials) {
      const newExperience = official.yearsExperience + 1;
      
      await storage.updateOfficial(official.id, {
        yearsExperience: newExperience
      });
      
      console.log(`Updated ${official.firstName} ${official.lastName}: ${official.yearsExperience} → ${newExperience} years`);
    }
    
    console.log('All officials experience updated successfully');
  } catch (error) {
    console.error('Error updating officials experience:', error);
    throw error;
  }
}

// Manual trigger function for testing or admin use
export async function manuallyUpdateExperience(): Promise<{ success: boolean; message: string; officialsUpdated: number }> {
  try {
    const { data: officials } = await storage.getOfficials();
    await updateAllOfficialsExperience();
    
    // Update the tracker
    const currentYear = new Date().getFullYear();
    seasonTracker.lastUpdateYear = currentYear;
    await storage.updateSetting('lastExperienceUpdateYear', currentYear.toString());
    
    return {
      success: true,
      message: `Successfully updated experience for ${officials.length} officials`,
      officialsUpdated: officials.length
    };
  } catch (error) {
    console.error('Manual experience update failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      officialsUpdated: 0
    };
  }
}
