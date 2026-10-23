import assert from "node:assert/strict";
import test from "node:test";
import {
  RatingsService,
  type RatingReview,
} from "../server/services/ratings";
import {
  isEventReviewable,
  isValidRating,
} from "../server/services/review-policy";

const review = (value: number): RatingReview => ({
  mechanics: value,
  professionalism: value,
  positioning: value,
  stalling: value,
  consistency: value,
  appearance: value,
});

test("rating breakdown uses only repository-approved reviews", async () => {
  const persisted: Array<{ averageRating: number; totalReviews: number }> = [];
  const service = new RatingsService({
    getApprovedRatingReviews: async () => [review(5), review(3)],
    persistOfficialRating: async (_officialId, values) => {
      persisted.push(values);
    },
  });

  const breakdown = await service.recalculateOfficial(42);

  assert.equal(breakdown.overall, 4);
  assert.equal(breakdown.approvedReviewCount, 2);
  assert.deepEqual(persisted, [{ averageRating: 4, totalReviews: 2 }]);
});

test("rating breakdown resets an official with no approved reviews", async () => {
  let persisted: { averageRating: number; totalReviews: number } | undefined;
  const service = new RatingsService({
    getApprovedRatingReviews: async () => [],
    persistOfficialRating: async (_officialId, values) => {
      persisted = values;
    },
  });

  const breakdown = await service.recalculateOfficial(42);

  assert.equal(breakdown.overall, 0);
  assert.equal(breakdown.approvedReviewCount, 0);
  assert.deepEqual(persisted, { averageRating: 0, totalReviews: 0 });
});

test("category and overall averages round to one decimal place", () => {
  const breakdown = RatingsService.calculateBreakdown([
    {
      mechanics: 5,
      professionalism: 4,
      positioning: 3,
      stalling: 2,
      consistency: 1,
      appearance: 5,
    },
    review(4),
    review(4),
  ]);

  assert.equal(breakdown.mechanics, 4.3);
  assert.equal(breakdown.appearance, 4.3);
  assert.equal(breakdown.overall, 3.8);
});

test("review ratings must be integer values from one through five", () => {
  assert.equal(isValidRating(1), true);
  assert.equal(isValidRating(5), true);
  assert.equal(isValidRating(0), false);
  assert.equal(isValidRating(6), false);
  assert.equal(isValidRating(2.5), false);
  assert.equal(isValidRating(Number.NaN), false);
});

test("review eligibility allows current/past dates and rejects future dates", () => {
  const now = new Date("2026-08-30T16:00:00.000Z");

  assert.equal(
    isEventReviewable(new Date("2026-08-30T23:59:00.000Z"), now),
    true,
  );
  assert.equal(
    isEventReviewable(new Date("2026-08-29T12:00:00.000Z"), now),
    true,
  );
  assert.equal(
    isEventReviewable(new Date("2026-08-31T12:00:00.000Z"), now),
    false,
  );
});