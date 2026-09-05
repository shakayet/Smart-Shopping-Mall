export const buildProductFeedViewerFilter = (viewerId?: string) =>
  viewerId ? { $and: [{ seller: { $ne: viewerId } }] } : {};

const sortForStableSerialization = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortForStableSerialization);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortForStableSerialization(
        (value as Record<string, unknown>)[key],
      );
      return result;
    }, {});
};

export const buildProductFeedCacheDiscriminator = (
  query: Record<string, unknown>,
  viewerId?: string,
) =>
  JSON.stringify(
    sortForStableSerialization({ viewerId: viewerId ?? null, query }),
  );
