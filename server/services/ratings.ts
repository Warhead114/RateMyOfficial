export interface RatingReview {
  mechanics: number;
  professionalism: number;
  positioning: number;
  stalling: number;
  consistency: number;
  appearance: number;
}

export interface RatingBreakdown {
  mechanics: number;
  professionalism: number;
  positioning: number;
  stalling: number;
  consistency: number;
  appearance: number;
  overall: number;
  approvedReviewCount: number;
}

export interface RatingsRepository {
  getApprovedRatingReviews(officialId: number): Promise<RatingReview[]>;
  persistOfficialRating(
    officialId: number,
    values: { averageRating: number; totalReviews: number },
  ): Promise<void>;
}

const EMPTY_BREAKDOWN: RatingBreakdown = {
  mechanics: 0,
  professionalism: 0,
  positioning: 0,
  stalling: 0,
  consistency: 0,
  appearance: 0,
  overall: 0,
  approvedReviewCount: 0,
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export class RatingsService {
  constructor(private readonly repository: RatingsRepository) {}

  async getOfficialBreakdown(officialId: number): Promise<RatingBreakdown> {
    const reviews = await this.repository.getApprovedRatingReviews(officialId);
    return RatingsService.calculateBreakdown(reviews);
  }

  async recalculateOfficial(officialId: number): Promise<RatingBreakdown> {
    const breakdown = await this.getOfficialBreakdown(officialId);

    await this.repository.persistOfficialRating(officialId, {
      averageRating: breakdown.overall,
      totalReviews: breakdown.approvedReviewCount,
    });

    return breakdown;
  }

  static calculateBreakdown(reviews: RatingReview[]): RatingBreakdown {
    if (reviews.length === 0) {
      return { ...EMPTY_BREAKDOWN };
    }

    const sums = reviews.reduce(
      (total, review) => ({
        mechanics: total.mechanics + review.mechanics,
        professionalism: total.professionalism + review.professionalism,
        positioning: total.positioning + review.positioning,
        stalling: total.stalling + review.stalling,
        consistency: total.consistency + review.consistency,
        appearance: total.appearance + review.appearance,
      }),
      {
        mechanics: 0,
        professionalism: 0,
        positioning: 0,
        stalling: 0,
        consistency: 0,
        appearance: 0,
      },
    );

    const count = reviews.length;
    const raw = {
      mechanics: sums.mechanics / count,
      professionalism: sums.professionalism / count,
      positioning: sums.positioning / count,
      stalling: sums.stalling / count,
      consistency: sums.consistency / count,
      appearance: sums.appearance / count,
    };

    const overall =
      (raw.mechanics +
        raw.professionalism +
        raw.positioning +
        raw.stalling +
        raw.consistency +
        raw.appearance) /
      6;

    return {
      mechanics: roundToTenth(raw.mechanics),
      professionalism: roundToTenth(raw.professionalism),
      positioning: roundToTenth(raw.positioning),
      stalling: roundToTenth(raw.stalling),
      consistency: roundToTenth(raw.consistency),
      appearance: roundToTenth(raw.appearance),
      overall: roundToTenth(overall),
      approvedReviewCount: count,
    };
  }
}