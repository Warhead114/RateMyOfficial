import { pool } from "../server/db";
import { storage } from "../server/storage";

const EXPECTED_PRODUCTION_DATABASE = "neondb";
const REQUIRED_CONFIRMATION = "repair-current-production-ratings";
const OFFICIAL_IDS = [1, 2, 10, 11, 16] as const;

async function main() {
  if (process.env.REPLIT_DEPLOYMENT !== "1") {
    throw new Error(
      "Refusing rating repair outside a published Replit deployment",
    );
  }
  if (process.env.RATINGS_REPAIR_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Set RATINGS_REPAIR_CONFIRM=${REQUIRED_CONFIRMATION} to authorize this one-time repair`,
    );
  }

  const {
    rows: [{ current_database: currentDatabase }],
  } = await pool.query<{ current_database: string }>(
    "SELECT current_database()",
  );

  if (currentDatabase !== EXPECTED_PRODUCTION_DATABASE) {
    throw new Error(
      `Refusing rating repair outside ${EXPECTED_PRODUCTION_DATABASE}; connected to ${currentDatabase}`,
    );
  }

  for (const officialId of OFFICIAL_IDS) {
    const before = await storage.getOfficialById(officialId);
    if (!before) {
      throw new Error(`Authorized official ${officialId} no longer exists`);
    }

    const currentBreakdown =
      await storage.getOfficialRatingBreakdown(officialId);
    await storage.updateOfficialRating(officialId);
    const after = await storage.getOfficialById(officialId);

    console.log({
      officialId,
      officialName: `${before.firstName} ${before.lastName}`,
      before: {
        averageRating: before.averageRating,
        totalReviews: before.totalReviews,
      },
      approvedReviewCount: currentBreakdown.approvedReviewCount,
      calculatedAverageRating: currentBreakdown.overall,
      after: {
        averageRating: after?.averageRating,
        totalReviews: after?.totalReviews,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });