/**
 * Folio recommendation engine — public API. Pure, deterministic (clock injected), no I/O.
 * CONTRACT: signatures here are fixed; UI code depends on them.
 */
export { recommend } from './recommend';
export { similarMaterials } from './similar';
export { initialReviewCard, isReviewDue, scheduleReview } from './review';
export { prerequisiteStatus, type PrerequisiteStatus, wouldCreateCycle } from './prerequisites';
export { RECOMMENDATION_WEIGHTS } from './scoring';
