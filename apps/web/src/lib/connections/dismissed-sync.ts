// The cookie that keeps, per account, the failed sync whose notice the user
// closed, so the page renders without it until another sync fails.
export const dismissedSyncCookie = (accountId: string) =>
  `plant_sync_dismissed_${accountId}`;

export const DISMISSED_SYNC_MAX_AGE = 60 * 60 * 24 * 365;
