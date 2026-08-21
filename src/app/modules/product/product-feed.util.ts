export const buildProductFeedViewerFilter = (viewerId?: string) =>
  viewerId ? { $and: [{ seller: { $ne: viewerId } }] } : {};

export const buildProductFeedCacheDiscriminator = (
  query: Record<string, unknown>,
  viewerId?: string,
) => JSON.stringify({ viewerId: viewerId ?? null, query });
